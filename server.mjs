import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.PULSE_MODE === 'production';

// Production (Electron) loads its .env from the user-writable userData
// directory so updates to the .app never blow away credentials. Main.cjs
// passes the resolved path via PULSE_ENV_PATH. In dev we keep the
// historical behavior of reading .env.local from the working directory.
if (isProduction) {
  const envPath = process.env.PULSE_ENV_PATH || path.join(__dirname, '.env');
  dotenv.config({ path: envPath });
} else {
  dotenv.config({ path: '.env.local' });
  dotenv.config();
}

const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const embeddingDimensions = Number(process.env.GEMINI_EMBEDDING_DIM || 768);
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_API_KEY;
const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyB3lr2P_StJyrJOlyQ56tV_mrbw874x64I';
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
const brainMemoryMigrationPath = 'supabase/migrations/20260422094500_brain_memory.sql';
const brainMemorySourceTypesMigrationPath = 'supabase/migrations/20260424080000_expand_brain_memory_source_types.sql';
const brainMemoryLegacySqlPath = 'supabase/brain_memory.sql';
const brainMemorySchemaTtlMs = 60_000;
const allBrainSourceTypes = ['user_profile', 'dsp_record', 'tag_record', 'brain_card', 'fleet_log', 'saved_chat'];
const brainMemorySchemaState = {
  checkedAt: 0,
  error: null,
  pending: null,
  ready: null,
};

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(express.json({ limit: '2mb' }));

// Trust proxy so req.ip resolves correctly behind reverse proxies (production).
app.set('trust proxy', 1);

const jsonError = (res, status, message, details) =>
  res.status(status).json({ error: message, details });

// ─── Rate limiting ────────────────────────────────────────────────────
// Two layers:
//   1. IP-level shield (pre-auth): coarse DDoS guard. Keeps unauthenticated
//      flood traffic off Firebase token verification.
//   2. Per-user shield (post-auth): tiered between admin and standard users.
//      Admins (bootstrap email, post token verification) get a much higher
//      allowance so the sole owner is never throttled during normal use.
// In-memory token buckets work for a single-node deploy. Swap to Redis if
// scaling horizontally.

const RATE_LIMIT_WINDOW_MS = 60_000;
const IP_RATE_LIMIT_MAX = 60;            // pre-auth, per IP
const USER_RATE_LIMIT_ADMIN_MAX = 300;   // post-auth, admin tier
const USER_RATE_LIMIT_STANDARD_MAX = 30; // post-auth, everyone else
const ipRateLimitBuckets = new Map();
const userRateLimitBuckets = new Map();

const bootstrapAdminEmail = (
  process.env.BOOTSTRAP_ADMIN_EMAIL ||
  process.env.VITE_BOOTSTRAP_ADMIN_EMAIL ||
  'sagargpt23@gmail.com'
).trim().toLowerCase();

const isBootstrapAdminEmail = (email) =>
  String(email || '').trim().toLowerCase() === bootstrapAdminEmail;

const getClientKey = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
};

const consumeBucket = (map, key, max, now) => {
  let bucket = map.get(key);
  if (!bucket || now > bucket.reset) {
    bucket = { count: 0, reset: now + RATE_LIMIT_WINDOW_MS };
  }
  bucket.count += 1;
  map.set(key, bucket);
  return {
    bucket,
    overLimit: bucket.count > max,
    remaining: Math.max(0, max - bucket.count),
  };
};

const rateLimit = (req, res, next) => {
  const key = getClientKey(req);
  const now = Date.now();
  const result = consumeBucket(ipRateLimitBuckets, key, IP_RATE_LIMIT_MAX, now);
  res.setHeader('X-RateLimit-Limit', String(IP_RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.bucket.reset / 1000)));
  if (result.overLimit) {
    res.setHeader('Retry-After', String(Math.ceil((result.bucket.reset - now) / 1000)));
    return jsonError(res, 429, 'Too many requests. Please slow down and try again shortly.');
  }
  next();
};

const enforceUserRateLimit = (user, res) => {
  const isAdmin = isBootstrapAdminEmail(user.email);
  const max = isAdmin ? USER_RATE_LIMIT_ADMIN_MAX : USER_RATE_LIMIT_STANDARD_MAX;
  const now = Date.now();
  const result = consumeBucket(userRateLimitBuckets, user.uid, max, now);
  res.setHeader('X-User-RateLimit-Limit', String(max));
  res.setHeader('X-User-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-User-RateLimit-Reset', String(Math.ceil(result.bucket.reset / 1000)));
  res.setHeader('X-User-RateLimit-Tier', isAdmin ? 'admin' : 'standard');
  if (result.overLimit) {
    res.setHeader('Retry-After', String(Math.ceil((result.bucket.reset - now) / 1000)));
    const error = new Error('Too many requests. Please slow down and try again shortly.');
    error.status = 429;
    throw error;
  }
};

// Periodic cleanup so the maps don't grow unbounded for transient keys.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of ipRateLimitBuckets) {
    if (now > bucket.reset) ipRateLimitBuckets.delete(key);
  }
  for (const [key, bucket] of userRateLimitBuckets) {
    if (now > bucket.reset) userRateLimitBuckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

// ─── Payload guards ───────────────────────────────────────────────────
// The express.json `limit` (set above) is the real backstop on total request
// body size. The constants below are in-flight sanity checks for individual
// fields — kept generous so the owner's memory is never silently truncated.
const MAX_SOURCES_PER_REQUEST = 80;
const MAX_QUESTION_LENGTH = 4000;
const MAX_CLIENT_SOURCES = 40;
const MAX_TITLE_LENGTH = 500;
// Per-source content + per-history-message ceilings sit at the Firestore
// document size limit (1 MB) so anything that fits in a Brain card / log /
// saved chat will also pass through the API unchanged.
const MAX_SOURCE_CONTENT_LENGTH = 1_000_000;
const MAX_CLIENT_SOURCE_CONTENT = 1_000_000;
const MAX_HISTORY_MESSAGE_LENGTH = 1_000_000;

const getBearerToken = (req) => {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

const verifyFirebaseUser = async (req) => {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Sign in again before using Brain AI.');
    error.status = 401;
    throw error;
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  const payload = await response.json().catch(() => ({}));
  const user = payload.users?.[0];

  if (!response.ok || !user?.localId) {
    const error = new Error('Your login token could not be verified.');
    error.status = 401;
    throw error;
  }

  return {
    uid: user.localId,
    email: String(user.email || '').toLowerCase(),
  };
};

const cleanText = (value, max = 8000) =>
  String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max);

const hashText = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

const SEARCH_STOP_WORDS = new Set([
  'a',
  'about',
  'all',
  'also',
  'an',
  'and',
  'any',
  'are',
  'can',
  'detail',
  'details',
  'do',
  'does',
  'for',
  'from',
  'give',
  'hey',
  'have',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'added',
  'latest',
  'last',
  'list',
  'me',
  'most',
  'my',
  'newest',
  'of',
  'on',
  'only',
  'please',
  'recent',
  'saved',
  'show',
  'tell',
  'that',
  'the',
  'this',
  'to',
  'updated',
  'what',
  'whats',
  'where',
  'which',
  'who',
  'why',
  'with',
  'you',
]);

const sourceTypeQueryHints = {
  user_profile: ['profile', 'account', 'email', 'name'],
  dsp_record: ['dsp', 'dsps', 'partner', 'partners', 'integration', 'integrations'],
  tag_record: ['tag', 'tags'],
  brain_card: ['card', 'cards', 'brain', 'note', 'notes'],
  fleet_log: ['log', 'logs', 'update', 'updates'],
  saved_chat: ['chat', 'chats', 'conversation', 'conversations'],
};

const normalizeForSearch = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getSearchTerms = (value) =>
  Array.from(new Set(normalizeForSearch(value).split(' ')))
    .filter((term) => term.length > 2 && !SEARCH_STOP_WORDS.has(term));

const expandSearchTerms = (terms) =>
  Array.from(new Set(terms.flatMap((term) => {
    if (term === 'ortb') return ['ortb', 'openrtb', 'rtb'];
    if (term === 'openrtb') return ['openrtb', 'ortb', 'rtb'];
    return [term];
  })));

const sourceTextForSearch = (source) =>
  normalizeForSearch([
    source.source_type || source.sourceType,
    source.title || source.cardTitle,
    source.heading,
    source.content || source.text,
  ].filter(Boolean).join(' '));

const sourceHasSearchTerm = (source, terms) => {
  if (terms.length === 0) return false;
  const haystack = ` ${sourceTextForSearch(source)} `;
  return terms.some((term) => haystack.includes(` ${term} `));
};

const sourceMatchesType = (source, sourceTypes) =>
  sourceTypes.includes(source.source_type || source.sourceType || 'brain_card');

const getNonTypeQuestionTerms = (terms, sourceTypes) => {
  const typeTerms = new Set(
    sourceTypes.flatMap((sourceType) => sourceTypeQueryHints[sourceType] || [])
  );
  return terms.filter((term) => !typeTerms.has(term));
};

const isRelevantPrivateSource = (source, questionProfile) => {
  const { hasExplicitSourceType, recentIntent, sourceTypes, terms } = questionProfile;
  const nonTypeTerms = getNonTypeQuestionTerms(terms, sourceTypes);

  if (sourceHasSearchTerm(source, nonTypeTerms.length > 0 ? nonTypeTerms : terms)) {
    return true;
  }

  if (!sourceMatchesType(source, sourceTypes)) {
    return false;
  }

  if (hasExplicitSourceType && nonTypeTerms.length === 0) {
    return true;
  }

  if (recentIntent && nonTypeTerms.length === 0) {
    return true;
  }

  return false;
};

const filterRelevantPrivateSources = (sources, questionProfile) =>
  sources.filter((source) => isRelevantPrivateSource(source, questionProfile));

const isInsufficientGroundingAnswer = (answer) =>
  normalizeForSearch(answer).startsWith('i do not have enough grounded information');

// Maximum chunks per source. With ~1200-char chunks this allows ~1.2 MB of
// text per source — comfortably above the Firestore 1 MB doc limit, so the
// chunker is no longer the bottleneck for indexing long Brain cards.
const MAX_CHUNKS_PER_SOURCE = 1000;

const chunkText = (content, size = 1200, overlap = 150) => {
  const text = cleanText(content, MAX_SOURCE_CONTENT_LENGTH);
  if (!text) return [];
  const chunks = [];
  let index = 0;

  while (index < text.length) {
    const end = Math.min(index + size, text.length);
    let chunk = text.slice(index, end);
    const lastBreak = chunk.lastIndexOf('\n\n');
    if (end < text.length && lastBreak > size * 0.55) {
      chunk = chunk.slice(0, lastBreak);
    }
    chunks.push(cleanText(chunk, size + overlap));
    index += Math.max(chunk.length - overlap, size - overlap);
  }

  return chunks.filter(Boolean).slice(0, MAX_CHUNKS_PER_SOURCE);
};

// AI keys arrive per-request in headers. We never read them from process.env
// so the user owns + rotates their keys via the in-app Admin → AI Keys panel.
const getAiKeysFromReq = (req) => ({
  geminiKey: String(req.headers['x-gemini-key'] || '').trim(),
  openrouterKey: String(req.headers['x-openrouter-key'] || '').trim(),
});

const requireGeminiKey = (req) => {
  const { geminiKey } = getAiKeysFromReq(req);
  if (!geminiKey) {
    const error = new Error('Gemini API key is required for Brain memory indexing because embeddings are Gemini-only.');
    error.status = 412;
    throw error;
  }
  return geminiKey;
};

const getGemini = (req) => new GoogleGenAI({ apiKey: requireGeminiKey(req) });

const embedText = async (req, text, taskType = 'RETRIEVAL_DOCUMENT') => {
  const ai = getGemini(req);
  const response = await ai.models.embedContent({
    model: embeddingModel,
    contents: [{ role: 'user', parts: [{ text: cleanText(text, 8000) }] }],
    config: {
      taskType,
      outputDimensionality: embeddingDimensions,
    },
  });

  const values = response.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini did not return an embedding.');
  }

  return values;
};

// Detects rate-limit / quota / auth errors from the Gemini SDK so we can
// transparently fall back to OpenRouter for chat completions. Embeddings
// stay Gemini-only because the vector dimension is fixed in Supabase.
const isGeminiFallbackError = (error) => {
  const status = Number(error?.status || error?.code || error?.response?.status || 0);
  if (status === 429 || status === 403 || status === 401) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('resource_exhausted') ||
    message.includes('exceeded') ||
    message.includes('api key not valid') ||
    message.includes('invalid api key')
  );
};

const OPENROUTER_MODEL = 'openai/gpt-5-nano';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// Calls OpenRouter's OpenAI-compatible chat completions endpoint with the
// caller-supplied API key. Returns the assistant text. We deliberately keep
// the SDK surface tiny (raw fetch) so there is no extra dep, and so the
// fallback path is easy to reason about.
const callOpenRouterChat = async (apiKey, prompt) => {
  if (!apiKey) {
    const error = new Error('OpenRouter API key is not set; cannot fall back from Gemini.');
    error.status = 412;
    throw error;
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://pulse.local',
      'X-Title': 'Pulse',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenRouter request failed with status ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('OpenRouter returned an empty response.');
  }
  return text;
};

// Runs the Gemini chat call first; on rate-limit / quota / auth failure
// retries the same prompt against OpenRouter. Sets `X-Provider-Used` so the
// client can show a one-time "switched to OpenRouter" toast.
const runChatWithFallback = async (req, res, prompt, geminiConfig = {}) => {
  const { geminiKey, openrouterKey } = getAiKeysFromReq(req);
  if (!geminiKey && !openrouterKey) {
    const error = new Error('No AI keys configured. Add a Gemini and/or OpenRouter key in Admin → AI Keys.');
    error.status = 412;
    throw error;
  }

  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: geminiConfig,
      });
      res.setHeader('X-Provider-Used', 'gemini');
      return { provider: 'gemini', response };
    } catch (error) {
      if (!isGeminiFallbackError(error) || !openrouterKey) throw error;
      console.warn('Gemini call failed, falling back to OpenRouter:', error?.message || error);
    }
  }

  const text = await callOpenRouterChat(openrouterKey, prompt);
  res.setHeader('X-Provider-Used', 'openrouter');
  return {
    provider: 'openrouter',
    response: { text, candidates: [] },
  };
};

const assertSupabase = () => {
  if (!supabase) {
    const error = new Error('Supabase memory is not configured. Add SUPABASE_SERVICE_ROLE_KEY locally, then restart the dev server.');
    error.status = 500;
    throw error;
  }
};

const normalizeTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return '';
};

const isBrainMemorySchemaError = (error) => {
  const code = String(error?.code || '').toUpperCase();
  const details = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return (
    ['PGRST202', 'PGRST205', '42P01', '42883'].includes(code) ||
    details.includes('brain_chunks') ||
    details.includes('match_brain_chunks') ||
    details.includes('schema cache')
  );
};

const isBrainMemorySourceTypeError = (error) => {
  const code = String(error?.code || '').toUpperCase();
  const details = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return code === '23514' && (
    details.includes('source_type') ||
    details.includes('brain_chunks_source_type_check') ||
    details.includes('violates check constraint')
  );
};

const isBrainMemoryNetworkError = (error) => {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const details = `${error?.message || ''} ${error?.cause?.message || ''}`.toLowerCase();
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    details.includes('fetch failed') ||
    details.includes('network')
  );
};

const normalizeBrainMemoryError = (error) => {
  if (!error) return error;
  if (error.code === 'BRAIN_MEMORY_SCHEMA_MISSING') return error;
  if (error.code === 'BRAIN_MEMORY_SOURCE_TYPES_OUTDATED') return error;
  if (error.code === 'BRAIN_MEMORY_UNREACHABLE') return error;
  if (isBrainMemoryNetworkError(error)) {
    const normalized = new Error(
      'Supabase Brain memory is unreachable. Check VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and network/DNS access, then restart Pulse.'
    );
    normalized.status = 500;
    normalized.code = 'BRAIN_MEMORY_UNREACHABLE';
    normalized.cause = error;
    return normalized;
  }
  if (isBrainMemorySourceTypeError(error)) {
    const normalized = new Error(
      `Brain memory source types are outdated in Supabase. Apply ${brainMemorySourceTypesMigrationPath}, then retry the request.`
    );
    normalized.status = 500;
    normalized.code = 'BRAIN_MEMORY_SOURCE_TYPES_OUTDATED';
    normalized.cause = error;
    return normalized;
  }
  if (!isBrainMemorySchemaError(error)) return error;

  const normalized = new Error(
    `Brain memory schema is not deployed in Supabase. Apply ${brainMemoryMigrationPath} (or ${brainMemoryLegacySqlPath}) to create public.brain_chunks and public.match_brain_chunks, then retry the request.`
  );
  normalized.status = 500;
  normalized.code = 'BRAIN_MEMORY_SCHEMA_MISSING';
  normalized.cause = error;
  return normalized;
};

const probeBrainMemorySchema = async () => {
  if (!supabase) return;

  const { error: tableError } = await supabase
    .from('brain_chunks')
    .select('id', { head: true, count: 'exact' })
    .limit(1);

  if (tableError) throw normalizeBrainMemoryError(tableError);

  const zeroVector = Array.from({ length: embeddingDimensions }, () => 0);
  const { error: rpcError } = await supabase.rpc('match_brain_chunks', {
    match_user_id: '__schema_probe__',
    query_embedding: zeroVector,
    match_count: 1,
    min_similarity: 1.1,
    source_types: null,
  });

  if (rpcError) throw normalizeBrainMemoryError(rpcError);
};

const ensureBrainMemorySchemaReady = async (force = false) => {
  assertSupabase();
  const now = Date.now();
  const isFresh = now - brainMemorySchemaState.checkedAt < brainMemorySchemaTtlMs;

  if (!force && brainMemorySchemaState.pending) {
    return brainMemorySchemaState.pending;
  }

  if (!force && isFresh) {
    if (brainMemorySchemaState.ready) return;
    if (brainMemorySchemaState.error) throw brainMemorySchemaState.error;
  }

  const pending = probeBrainMemorySchema()
    .then(() => {
      brainMemorySchemaState.ready = true;
      brainMemorySchemaState.error = null;
      brainMemorySchemaState.checkedAt = Date.now();
    })
    .catch((error) => {
      const normalized = normalizeBrainMemoryError(error);
      brainMemorySchemaState.ready = false;
      brainMemorySchemaState.error = normalized;
      brainMemorySchemaState.checkedAt = Date.now();
      throw normalized;
    })
    .finally(() => {
      brainMemorySchemaState.pending = null;
    });

  brainMemorySchemaState.pending = pending;
  return pending;
};

const getSourceHeading = (sourceHeading, title) =>
  cleanText(sourceHeading || title, 160);

const getSourceLabel = (title, heading, chunk) =>
  `${title}\n${heading}\n${chunk}`;

const getChunkContentHash = (sourceType, sourceId, chunkIndex, title, heading, chunk) =>
  hashText(`${sourceType}:${sourceId}:${chunkIndex}:${title}:${heading}:${chunk}`);

const buildSourceRows = async (uid, source) => {
  const sourceType = String(source.sourceType || '').trim();
  const sourceId = String(source.sourceId || '').trim();
  const title = cleanText(source.title || 'Untitled', 160);
  const heading = getSourceHeading(source.heading, title);
  const body = cleanText(source.content, MAX_SOURCE_CONTENT_LENGTH);
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const createdAt = normalizeTimestamp(metadata.createdAt) || normalizeTimestamp(metadata.updatedAt) || new Date(0).toISOString();
  const updatedAt = normalizeTimestamp(metadata.updatedAt) || normalizeTimestamp(metadata.createdAt) || new Date(0).toISOString();
  if (!sourceType || !sourceId) {
    return null;
  }

  const chunks = body ? chunkText(body) : [];
  const rows = chunks.map((chunk, chunkIndex) => ({
    chunkIndex,
    contentHash: getChunkContentHash(sourceType, sourceId, chunkIndex, title, heading, chunk),
    content: chunk,
    row: {
      user_id: uid,
      source_type: sourceType,
      source_id: sourceId,
      chunk_index: chunkIndex,
      title,
      heading,
      content: chunk,
      content_hash: getChunkContentHash(sourceType, sourceId, chunkIndex, title, heading, chunk),
      metadata,
      created_at: createdAt,
      updated_at: updatedAt,
    },
  }));

  return {
    sourceType,
    sourceId,
    chunkCount: rows.length,
    rows,
    title,
    heading,
  };
};

const loadExistingSourceChunks = async (uid, sourceType, sourceId) => {
  const { data, error } = await supabase
    .from('brain_chunks')
    .select('chunk_index, content_hash')
    .eq('user_id', uid)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);

  if (error) throw normalizeBrainMemoryError(error);

  return new Map(
    (Array.isArray(data) ? data : []).map((item) => [Number(item.chunk_index), String(item.content_hash || '')])
  );
};

const enrichRowsWithEmbeddings = async (req, rows, title, heading) => {
  const embeddedRows = [];

  for (const item of rows) {
    const embedding = await embedText(req, getSourceLabel(title, heading, item.content), 'RETRIEVAL_DOCUMENT');
    embeddedRows.push({
      ...item.row,
      embedding,
    });
  }

  return embeddedRows;
};

const upsertRows = async (rows) => {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from('brain_chunks')
    .upsert(rows, { onConflict: 'user_id,source_type,source_id,chunk_index' });

  if (error) throw normalizeBrainMemoryError(error);
};

const indexSingleSource = async (req, uid, source) => {
  const nextSource = await buildSourceRows(uid, source);
  if (!nextSource) {
    return { embedded: 0, indexed: 0, reused: 0 };
  }

  const existingChunks = await loadExistingSourceChunks(uid, nextSource.sourceType, nextSource.sourceId);
  const changedRows = nextSource.rows.filter((item) => existingChunks.get(item.chunkIndex) !== item.contentHash);
  const reused = nextSource.rows.length - changedRows.length;
  const embeddedRows = await enrichRowsWithEmbeddings(req, changedRows, nextSource.title, nextSource.heading);

  await upsertRows(embeddedRows);
  await deleteStaleChunks(uid, nextSource.sourceType, nextSource.sourceId, nextSource.chunkCount);

  return {
    embedded: embeddedRows.length,
    indexed: nextSource.rows.length,
    reused,
  };
};

const deleteStaleChunks = async (uid, sourceType, sourceId, chunkCount) => {
  let request = supabase
    .from('brain_chunks')
    .delete()
    .eq('user_id', uid)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);

  if (chunkCount > 0) {
    request = request.gte('chunk_index', chunkCount);
  }

  const { error } = await request;
  if (error) throw normalizeBrainMemoryError(error);
};

const indexSources = async (req, uid, sources) => {
  await ensureBrainMemorySchemaReady();
  let embedded = 0;
  let indexed = 0;
  let reused = 0;

  for (const source of sources.slice(0, 80)) {
    const result = await indexSingleSource(req, uid, source);
    embedded += result.embedded;
    indexed += result.indexed;
    reused += result.reused;
  }

  return { embedded, indexed, reused };
};

const deleteSource = async (uid, sourceType, sourceId) => {
  await ensureBrainMemorySchemaReady();
  let request = supabase
    .from('brain_chunks')
    .delete()
    .eq('user_id', uid)
    .eq('source_type', sourceType);

  if (sourceId) request = request.eq('source_id', sourceId);
  const { error } = await request;
  if (error) throw normalizeBrainMemoryError(error);
};

const isRecentQuestion = (question) =>
  /\b(latest|recent|newest|most recent|last added|last updated)\b/i.test(question);

const getQuestionSourceProfile = (question) => {
  const normalized = String(question || '').toLowerCase();
  const sourceTypes = new Set();

  if (/\b(log|logs|update|updates)\b/.test(normalized)) sourceTypes.add('fleet_log');
  if (/\b(dsp|dsps|partner|partners|integration|integrations)\b/.test(normalized)) sourceTypes.add('dsp_record');
  if (/\b(tag|tags)\b/.test(normalized)) sourceTypes.add('tag_record');
  if (/\b(card|cards|brain card|brain cards|note|notes)\b/.test(normalized)) sourceTypes.add('brain_card');
  if (/\b(chat|chats|conversation|conversations)\b/.test(normalized)) sourceTypes.add('saved_chat');
  if (/\b(profile|account|email|name|my info|who am i)\b/.test(normalized)) sourceTypes.add('user_profile');

  const hasExplicitSourceType = sourceTypes.size > 0;
  return {
    hasExplicitSourceType,
    recentIntent: isRecentQuestion(question),
    sourceTypes: hasExplicitSourceType ? Array.from(sourceTypes) : allBrainSourceTypes,
    terms: expandSearchTerms(getSearchTerms(question)),
  };
};

const getQuestionSourceTypes = (question) =>
  getQuestionSourceProfile(question).sourceTypes;

const getRecentMemorySources = async (uid, sourceTypes = allBrainSourceTypes, limit = 8) => {
  await ensureBrainMemorySchemaReady();

  let query = supabase
    .from('brain_chunks')
    .select('source_type, source_id, title, heading, content, metadata, created_at, updated_at, chunk_index')
    .eq('user_id', uid)
    .order('updated_at', { ascending: false })
    .order('chunk_index', { ascending: true })
    .limit(60);

  if (Array.isArray(sourceTypes) && sourceTypes.length > 0) {
    query = query.in('source_type', sourceTypes);
  }

  const { data, error } = await query;
  if (error) throw normalizeBrainMemoryError(error);

  const recentSources = [];
  const seen = new Set();

  for (const item of Array.isArray(data) ? data : []) {
    const key = `${item.source_type}:${item.source_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentSources.push(item);
    if (recentSources.length >= limit) break;
  }

  return recentSources;
};

const searchMemory = async (req, uid, question, sourceTypes = allBrainSourceTypes) => {
  await ensureBrainMemorySchemaReady();
  const embedding = await embedText(req, question, 'RETRIEVAL_QUERY');
  const { data, error } = await supabase.rpc('match_brain_chunks', {
    match_user_id: uid,
    query_embedding: embedding,
    match_count: 10,
    min_similarity: 0.35,
    source_types: sourceTypes,
  });

  if (error) throw normalizeBrainMemoryError(error);
  return Array.isArray(data) ? data : [];
};

const getSourceTimestampLines = (source) => {
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const createdAt = normalizeTimestamp(metadata.createdAt || source.created_at);
  const updatedAt = normalizeTimestamp(metadata.updatedAt || source.updated_at);
  const lines = [];

  if (createdAt && !createdAt.startsWith('1970-01-01')) {
    lines.push(`Created: ${createdAt}`);
  }

  if (updatedAt && !updatedAt.startsWith('1970-01-01')) {
    lines.push(`Updated: ${updatedAt}`);
  }

  return lines.length > 0 ? `\n${lines.join('\n')}` : '';
};

const formatSources = (sources) =>
  sources
    .slice(0, 10)
    .map((source, index) => {
      const title = cleanText(source.title || source.cardTitle || 'Untitled', 160);
      const heading = cleanText(source.heading || title, 160);
      const content = cleanText(source.content || source.text || '', 1800);
      const sourceType = source.source_type || source.sourceType || 'brain_card';
      const similarity = typeof source.similarity === 'number' ? `\nSimilarity: ${source.similarity.toFixed(3)}` : '';
      const timestamps = getSourceTimestampLines(source);
      return `SOURCE ${index + 1}\nType: ${sourceType}\nTitle: ${title}\nSection: ${heading}${timestamps}${similarity}\nText:\n${content}`;
    })
    .join('\n\n---\n\n');

const dedupePrivateSources = (sources) => {
  const seen = new Set();
  return sources.filter((source) => {
    const key = [
      source.source_type || source.sourceType || 'brain_card',
      source.source_id || source.sourceId || source.title || '',
      source.heading || '',
      cleanText(source.content || source.text || '', 240),
    ].join('::');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Send the entire saved conversation to Gemini. Per-message content is still
// passed through cleanText() to strip control characters and excessive blank
// lines, but no length truncation is applied — a saved chat carries every
// message from the start of the conversation.
const formatHistory = (history) =>
  (Array.isArray(history) ? history : [])
    .map(message => `${message.role === 'user' ? 'User' : 'Brain'}: ${cleanText(message.content, MAX_HISTORY_MESSAGE_LENGTH)}`)
    .join('\n');

const buildBrainPrompt = ({ mode, question, history, sources, recentIntent }) => {
  const sourceText = formatSources(sources);
  const chatHistory = formatHistory(history);
  const isWebOnly = mode === 'web';
  const allowsWeb = mode === 'work_web' || mode === 'web';

  return `You are Pulse Brain, a strict grounded assistant for daily work and learning.

Mode: ${mode}

Rules:
- Do not hallucinate.
- Answer the user's latest question directly.
- Use the conversation history only to understand follow-up wording. Do not treat chat history as factual source unless it is also listed in SOURCES.
- If using private work memory, answer only from SOURCES.
- If web search is enabled, use web grounding only for facts not supported by SOURCES or when the mode is Web Only.
- If the question asks for latest, recent, newest, or last added information, prioritize the newest relevant SOURCES using their Created and Updated timestamps.
- If the question clearly targets logs, DSPs, tags, chats, cards, or profile details, focus on those matching source types first.
- If there is not enough grounded evidence, say exactly: "I do not have enough grounded information to answer that accurately."
- Keep answers precise, practical, and easy to act on.
- Do NOT append a "Sources:" list at the end of your answer. The UI renders sources as clickable links separately. If you reference a specific URL inline, write it as a markdown link [Title](https://example.com) so it renders correctly.

${allowsWeb ? 'Web search may be used in this mode.' : 'Web search is disabled in this mode.'}
${isWebOnly ? 'Private Brain/Fleet/chat memory is disabled for this answer.' : ''}
Recent-intent query: ${recentIntent ? 'yes' : 'no'}

Conversation history:
${chatHistory || 'No previous messages.'}

SOURCES:
${sourceText || 'No private sources were found.'}

Latest question:
${question}`;
};

app.post('/api/brain/index', rateLimit, async (req, res) => {
  try {
    const user = await verifyFirebaseUser(req);
    enforceUserRateLimit(user, res);
    requireGeminiKey(req);
    const sources = Array.isArray(req.body?.sources) ? req.body.sources : [];
    if (sources.length === 0) {
      return jsonError(res, 400, 'sources is required and must be a non-empty array.');
    }
    if (sources.length > MAX_SOURCES_PER_REQUEST) {
      return jsonError(res, 413, `Too many sources in a single request (max ${MAX_SOURCES_PER_REQUEST}).`);
    }
    // Validate each source up-front so we never pay for embeddings on bad input.
    for (const source of sources) {
      if (!source || typeof source !== 'object') {
        return jsonError(res, 400, 'Each source must be an object.');
      }
      const sourceType = String(source.sourceType || '').trim();
      const sourceId = String(source.sourceId || '').trim();
      if (!allBrainSourceTypes.includes(sourceType)) {
        return jsonError(res, 400, `Invalid sourceType: ${sourceType || '(empty)'}`);
      }
      if (!sourceId) {
        return jsonError(res, 400, 'Each source requires a non-empty sourceId.');
      }
      if (typeof source.content === 'string' && source.content.length > MAX_SOURCE_CONTENT_LENGTH) {
        return jsonError(res, 413, `Source content exceeds ${MAX_SOURCE_CONTENT_LENGTH} characters.`);
      }
      if (typeof source.title === 'string' && source.title.length > MAX_TITLE_LENGTH) {
        return jsonError(res, 413, `Source title exceeds ${MAX_TITLE_LENGTH} characters.`);
      }
    }
    const result = await indexSources(req, user.uid, sources);
    res.json(result);
  } catch (error) {
    if (![401, 412].includes(error.status)) console.error('Brain index error:', error);
    jsonError(res, error.status || 500, error.message || 'Brain indexing failed.');
  }
});

app.post('/api/brain/delete-source', rateLimit, async (req, res) => {
  try {
    const user = await verifyFirebaseUser(req);
    enforceUserRateLimit(user, res);
    const sourceType = String(req.body?.sourceType || '').trim();
    const sourceId = String(req.body?.sourceId || '').trim();
    if (!allBrainSourceTypes.includes(sourceType)) {
      return jsonError(res, 400, `Invalid sourceType: ${sourceType || '(empty)'}`);
    }
    if (!sourceId) {
      // Refuse bulk wipes — every caller in the app passes a specific sourceId.
      return jsonError(res, 400, 'sourceId is required.');
    }
    await deleteSource(user.uid, sourceType, sourceId);
    res.json({ deleted: true });
  } catch (error) {
    if (error.status !== 401) console.error('Brain delete source error:', error);
    jsonError(res, error.status || 500, error.message || 'Brain source delete failed.');
  }
});

// Wipes every brain_chunks row owned by the authenticated user. Intended as a
// "start fresh" action when the user has deleted Firestore records and wants
// the vector store to match — pair it with a Rebuild Memory call on the client
// to repopulate from current Fleet / Brain card / saved chat state.
app.post('/api/brain/reset-memory', rateLimit, async (req, res) => {
  try {
    const user = await verifyFirebaseUser(req);
    enforceUserRateLimit(user, res);
    await ensureBrainMemorySchemaReady();

    const { error, count } = await supabase
      .from('brain_chunks')
      .delete({ count: 'exact' })
      .eq('user_id', user.uid);

    if (error) throw normalizeBrainMemoryError(error);
    res.json({ deleted: count ?? 0 });
  } catch (error) {
    if (error.status !== 401) console.error('Brain reset-memory error:', error);
    jsonError(res, error.status || 500, error.message || 'Could not reset Brain memory.');
  }
});

app.post('/api/brain/chat', rateLimit, async (req, res) => {
  let user;
  try {
    user = await verifyFirebaseUser(req);
    enforceUserRateLimit(user, res);
  } catch (error) {
    if (error.status !== 401) console.error('Brain chat error:', error);
    return jsonError(res, error.status || 500, error.message || 'Brain chat failed.');
  }

  const { geminiKey, openrouterKey } = getAiKeysFromReq(req);
  const question = String(req.body?.question || '').trim().slice(0, MAX_QUESTION_LENGTH);
  const mode = ['work', 'work_web', 'web'].includes(req.body?.mode) ? req.body.mode : 'work';
  // Preserve the full saved conversation. Each individual message still has
  // an upper bound (MAX_HISTORY_MESSAGE_LENGTH) but no messages are dropped.
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const history = rawHistory
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'brain',
      content: String(message.content || '').slice(0, MAX_HISTORY_MESSAGE_LENGTH),
    }));
  const rawClientSources = Array.isArray(req.body?.clientSources) ? req.body.clientSources : [];
  const clientSources = rawClientSources
    .slice(0, MAX_CLIENT_SOURCES)
    .filter((source) => source && typeof source === 'object')
    .map((source) => ({
      ...source,
      title: typeof source.title === 'string' ? source.title.slice(0, MAX_TITLE_LENGTH) : source.title,
      content: typeof source.content === 'string' ? source.content.slice(0, MAX_CLIENT_SOURCE_CONTENT) : source.content,
      text: typeof source.text === 'string' ? source.text.slice(0, MAX_CLIENT_SOURCE_CONTENT) : source.text,
    }));

  if (!geminiKey && !openrouterKey) {
    return res.status(412).json({ error: 'No AI keys configured. Add a Gemini and/or OpenRouter key in Admin → AI Keys.' });
  }

  if (!question) {
    return res.status(400).json({ error: 'Question is required.' });
  }

  try {
    let memorySources = [];
    let recentSources = [];
    const questionProfile = getQuestionSourceProfile(question);
    const { sourceTypes: questionSourceTypes, recentIntent } = questionProfile;

    // Memory search needs Gemini for query embedding. If only an OpenRouter
    // key is set we skip private memory and answer from clientSources / web.
    if (mode !== 'web' && geminiKey) {
      try {
        [memorySources, recentSources] = await Promise.all([
          searchMemory(req, user.uid, question, questionSourceTypes),
          recentIntent ? getRecentMemorySources(user.uid, questionSourceTypes) : Promise.resolve([]),
        ]);
      } catch (error) {
        if (error.code === 'BRAIN_MEMORY_SCHEMA_MISSING' && clientSources.length === 0) {
          throw error;
        }
        console.warn('Supabase memory search unavailable:', error?.message || error);
      }
    }

    const privateSources = filterRelevantPrivateSources(dedupePrivateSources([
      ...recentSources,
      ...memorySources,
      ...clientSources.map(source => ({
        source_type: source.sourceType || 'brain_card',
        title: source.title || source.cardTitle,
        heading: source.heading,
        content: source.content || source.text,
        similarity: source.score ? Math.min(Number(source.score) / 20, 1) : undefined,
      })),
    ]), questionProfile).filter(source => cleanText(source.content || source.text || '').length > 0);

    if (mode === 'work' && privateSources.length === 0) {
      return res.json({
        answer: 'I do not have enough grounded information to answer that accurately.',
        sources: [],
      });
    }

    const prompt = buildBrainPrompt({
      mode,
      question,
      history,
      sources: mode === 'web' ? [] : privateSources,
      recentIntent,
    });

    const config = mode === 'work'
      ? {}
      : { tools: [{ googleSearch: {} }] };

    const { provider, response } = await runChatWithFallback(req, res, prompt, config);

    // Gemini's googleSearch grounding only exists on Gemini responses; the
    // OpenRouter fallback simply has no web sources to surface.
    const groundingChunks = provider === 'gemini'
      ? response.candidates?.[0]?.groundingMetadata?.groundingChunks || []
      : [];
    const webSources = groundingChunks
      .map(chunk => chunk.web)
      .filter(Boolean)
      .map(web => ({
        title: web.title || web.uri,
        uri: web.uri,
      }));

    const answer = response.text || 'I could not generate an answer from the grounded sources.';
    const citedPrivateSources = isInsufficientGroundingAnswer(answer) ? [] : privateSources;

    res.json({
      answer,
      provider,
      sources: citedPrivateSources.slice(0, 8).map(source => ({
        title: source.title || 'Untitled',
        type: source.source_type || source.sourceType || 'brain_card',
      })),
      webSources,
    });
  } catch (error) {
    if (error.status !== 401) console.error('Gemini Brain error:', error);
    res.status(error.status || 500).json({ error: error?.message || 'Gemini request failed.' });
  }
});

// ─── Summarize older history ──────────────────────────────────────────
// Compresses an array of conversation messages into a faithful markdown
// summary so older history can be replaced with a single condensed message
// without losing the threads, decisions, and facts established earlier.
const buildHistorySummaryPrompt = (messages) => {
  const transcript = messages
    .map((message) =>
      `${message.role === 'user' ? 'User' : 'Brain'}: ${cleanText(message.content, MAX_HISTORY_MESSAGE_LENGTH)}`
    )
    .join('\n\n');

  return `You are condensing an ongoing conversation between a user and Pulse Brain.
Produce a faithful, dense summary that preserves:
- Decisions made and their reasoning
- Facts established (names, numbers, dates, links)
- Open questions or tasks the user has not resolved
- Topics discussed, in chronological order

Rules:
- Output markdown. Use compact bullet points, grouped by topic.
- Stay under 600 words.
- Do not invent details. Only summarize what is in the transcript.
- Keep the user's terminology and proper nouns intact.
- Do not include any preamble like "Here is the summary"; start directly with the bullets.

CONVERSATION TO SUMMARIZE:

${transcript}`;
};

app.post('/api/brain/summarize-history', rateLimit, async (req, res) => {
  try {
    const user = await verifyFirebaseUser(req);
    enforceUserRateLimit(user, res);

    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = rawMessages
      .filter((message) => message && typeof message === 'object')
      .map((message) => ({
        role: message.role === 'user' ? 'user' : 'brain',
        content: String(message.content || '').slice(0, MAX_HISTORY_MESSAGE_LENGTH),
      }))
      .filter((message) => message.content.trim().length > 0);

    if (messages.length < 2) {
      return jsonError(res, 400, 'Need at least two messages to summarize.');
    }

    const prompt = buildHistorySummaryPrompt(messages);
    const { response } = await runChatWithFallback(req, res, prompt, {});

    const summary = String(response.text || '').trim();
    if (!summary) {
      return jsonError(res, 502, 'AI provider did not return a summary.');
    }

    res.json({
      summary,
      compressedCount: messages.length,
    });
  } catch (error) {
    if (![401, 412].includes(error.status)) console.error('Brain summarize-history error:', error);
    jsonError(res, error.status || 500, error.message || 'Could not summarize chat history.');
  }
});

if (supabase) {
  ensureBrainMemorySchemaReady(true).catch((error) => {
    console.warn('Supabase brain memory is not ready:', error?.message || error);
  });
}

if (isProduction) {
  // Electron build: serve the static Vite output bundled alongside the
  // server. The dist directory is shipped via electron-builder's
  // extraResources next to server.mjs.
  const distDir = path.join(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  // Dev: Vite middleware with HMR. Imports are dynamic so the production
  // bundle (Electron) does not pull in vite/react plugins.
  const { createServer: createViteServer } = await import('vite');
  const reactPlugin = (await import('@vitejs/plugin-react')).default;
  const tailwindPlugin = (await import('@tailwindcss/vite')).default;
  const vite = await createViteServer({
    configFile: false,
    plugins: [reactPlugin(), tailwindPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
    },
    server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Pulse running at http://localhost:${port}/`);
});
