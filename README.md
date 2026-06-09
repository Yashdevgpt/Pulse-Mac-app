# Pulse (macOS App)

Pulse is a personal, invite-only desktop app for macOS. It bundles a React + Vite frontend, an Express server, Firebase Auth + Firestore for app data, and Supabase pgvector for Brain memory into a single Electron `.app`. AI provider keys (Google Gemini, OpenRouter) are entered inside the app and stored only in a private file on your Mac (`~/Library/Application Support/Pulse/ai-keys.json`) — they survive app restarts and are never persisted to a backend.

This repository ships the Mac variant. The web-only backup lives at [Pulse-Main](https://github.com/Yashdevgpt/Pulse-Main).

## Stack

- React 19 + Vite + TypeScript
- Tailwind CSS (Neo-Brutalist design system)
- Firebase Authentication + Firestore
- Supabase Postgres + pgvector for Brain vector memory
- Google Gemini (`gemini-2.5-flash` chat, `gemini-embedding-001` 768-dim embeddings)
- OpenRouter (`deepseek/deepseek-chat`, then `openai/gpt-oss-120b`) — automatic fallback chain when Gemini hits rate limits / auth errors
- Electron + electron-builder (arm64 unsigned `.dmg`)

## Quick Start (build the Mac app)

Prereqs: macOS on Apple Silicon (M-series), Node 20+, your own Firebase + Supabase project.

```bash
git clone https://github.com/Yashdevgpt/Pulse-Mac-app.git
cd Pulse-Mac-app
npm install
cp .env.example .env.local      # then edit with your Supabase keys (see below)
npm run electron:build
open dist-electron               # double-click Pulse-0.0.0-arm64.dmg
```

After dragging `Pulse.app` into `/Applications`:

```bash
xattr -cr /Applications/Pulse.app   # strip Gatekeeper quarantine (unsigned build)
```

Open Pulse → first launch creates `~/Library/Application Support/Pulse/.env` from the template and reveals it in Finder. Paste your Supabase + Firebase keys there, save, and reopen Pulse. Then sign in and add your Gemini + OpenRouter keys under **Admin → AI Keys**.

## Required Configuration

### `.env.local` (build time) and `~/Library/Application Support/Pulse/.env` (runtime)

Both files use the same schema. Required keys:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

Optional overrides (sensible fallbacks exist in source):

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_BOOTSTRAP_ADMIN_EMAIL=you@example.com
GEMINI_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIM=768
```

> **AI keys (Gemini, OpenRouter) do NOT go in `.env`.** They are entered inside the app under **Admin → AI Keys**. The local server persists them in `ai-keys.json` next to the runtime `.env` (production: `~/Library/Application Support/Pulse/ai-keys.json`; dev: `.ai-keys.local.json`, gitignored), so they survive app restarts. `localStorage` (`pulse:ai-keys:v1`) remains the in-session cache the client reads synchronously.
>
> Optional `.env` override: `OPENROUTER_MODELS` — comma-separated OpenRouter model ids tried in order on fallback (default `deepseek/deepseek-chat,openai/gpt-oss-120b`).

### Get the keys

- **Gemini:** https://aistudio.google.com/apikey
- **OpenRouter:** https://openrouter.ai/keys (one key covers every model in the fallback chain)
- **Supabase:** Project Settings → API → copy Project URL, `anon public` key, and `service_role` key
- **Firebase:** Project Settings → General → SDK setup → copy the web config object

## OpenRouter Fallback

`runChatWithFallback` in `server.mjs` calls Gemini first. On HTTP 401 / 403 / 429 or messages containing `rate limit`, `quota`, `RESOURCE_EXHAUSTED`, `exceeded`, `api key not valid`, or `invalid api key`, it transparently retries against OpenRouter's OpenAI-compatible endpoint, walking the model chain in order (`deepseek/deepseek-chat`, then `openai/gpt-oss-120b`; override via `OPENROUTER_MODELS`). The provider and model used surface in the `X-Provider-Used` / `X-Openrouter-Model` response headers and the client toasts "Switched to OpenRouter" once per UTC day.

Embeddings stay Gemini-only because `brain_chunks.embedding` is fixed at 768 dimensions in Supabase.

## Local Development (without packaging)

```bash
npm install
cp .env.example .env.local        # add Supabase keys
npm run electron:dev               # Electron + Express + Vite HMR
# OR
npm run dev                        # browser only at http://localhost:3000/
```

`npm run electron:dev` spawns `server.mjs` in dev mode (Vite middleware with HMR) and opens it in a `BrowserWindow`. Edits to React components hot-reload inside the Electron window.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Express + Vite dev server at `http://localhost:3000/` (browser, no Electron) |
| `npm run electron:dev` | Same dev server, opened inside an Electron window |
| `npm run build` | Production Vite build → `dist/` |
| `npm run electron:build` | `npm run build` + electron-builder → `dist-electron/Pulse-<version>-arm64.dmg` |
| `npm run electron:build:universal` | Same as above but universal (`arm64` + `x64`) binary |
| `npm run preview` | Preview the built frontend in a browser |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Alias for `typecheck` |
| `npm run check` | `typecheck` + `build` together |
| `npm run clean` | Remove `dist/`, `dist-electron/`, and Vite cache |

## Project Structure

```text
.
├── PRD.md                         # full product spec + change log
├── README.md
├── electron/
│   └── main.cjs                   # Electron main process (spawns server, opens BrowserWindow)
├── build/
│   └── icon.icns                  # macOS Dock icon (yellow "P" with heartbeat)
├── server.mjs                     # Express server (dev mode = Vite middleware; prod = static dist)
├── src/
│   ├── components/                # UI primitives + Layout + AuthWrapper
│   ├── features/
│   │   └── brain/                 # Brain UI constants and pure helpers
│   ├── lib/
│   │   ├── aiKeys.ts              # AI key store (on-disk via /api/ai-keys + localStorage cache)
│   │   ├── brainApi.ts            # Brain API client (injects x-gemini-key + x-openrouter-key)
│   │   ├── db.ts                  # Firestore access layer
│   │   └── firebase.ts
│   └── pages/
│       ├── Admin.tsx              # User mgmt + AI Keys panel
│       ├── Brain.tsx
│       ├── Bridge.tsx
│       ├── Fleet.tsx
│       ├── Logbook.tsx
│       └── Watchtower.tsx
└── supabase/
    ├── brain_memory.sql           # Current schema entrypoint
    └── migrations/                # Brain vector schema, source expansion, security hardening
```

### Key files

- `electron/main.cjs` — spawns `server.mjs` as a Node child via `ELECTRON_RUN_AS_NODE=1`, finds a free `127.0.0.1` port, opens `BrowserWindow`, seeds `userData/.env` from template on first run.
- `server.mjs` — Brain endpoints (`/api/brain/index`, `/api/brain/delete-source`, `/api/brain/chat`, `/api/brain/summarize-history`, `/api/brain/reset-memory`) plus AI-key persistence (`GET`/`POST /api/ai-keys`, backed by `ai-keys.json` beside the runtime `.env`). Brain calls read AI keys from `x-gemini-key` / `x-openrouter-key` headers per request — never from env. Two run modes: dev (Vite middleware) and `PULSE_MODE=production` (static `dist/`).
- `src/lib/aiKeys.ts` — `saveAiKeysEverywhere()` / `clearAiKeysEverywhere()` (disk-first via `/api/ai-keys`, then `localStorage` cache), `syncAiKeysFromServer()` (restores keys at sign-in), `getAiKeys()` for synchronous reads, plus `consumeFallbackToastSlot()` for once-per-day fallback toast throttling.
- `src/lib/brainApi.ts` — every Brain API call attaches the AI key headers and surfaces the OpenRouter fallback toast on `X-Provider-Used: openrouter`.
- `src/pages/Admin.tsx` — masked Gemini + OpenRouter inputs with show/hide toggles, Save / Clear, and a "Saved (N chars, ends XXXX)" hint.

## Brain Memory

Brain uses:

- Firestore for saved Brain cards and saved chats
- Supabase `public.brain_chunks` (768-dim pgvector) for retrieval

If the schema is missing in Supabase, apply:

- `supabase/migrations/20260422094500_brain_memory.sql`
- `supabase/migrations/20260424080000_expand_brain_memory_source_types.sql`
- `supabase/migrations/20260511000000_harden_brain_memory_security.sql`

`brain_chunks` intentionally keeps RLS enabled without client policies. That default-deny state prevents publishable/anon clients from reading vector memory while the local Pulse server uses the Supabase `service_role` key for indexing and retrieval. The hardening migration attempts to move `vector` into the `extensions` schema for hygiene, but safely leaves it in its current schema if Supabase rejects the move on an active project.

In `work` mode the Brain UI falls back to grounded local note matching when remote AI is unavailable.

## Why Unsigned?

Code signing requires Apple Developer Program enrollment ($99/year). For a single-machine personal app this is unnecessary — `xattr -cr /Applications/Pulse.app` clears the Gatekeeper quarantine bit once and the app opens normally forever after. Re-run `xattr -cr` only after copying the `.app` over the network (AirDrop / download), which re-applies the quarantine attribute.

## Repository Topology

| Repo | Purpose | Remote |
| --- | --- | --- |
| [Pulse-Mac-app](https://github.com/Yashdevgpt/Pulse-Mac-app) | Active Mac variant (this repo) | `pulsemac` (push default) |
| [Pulse-Main](https://github.com/Yashdevgpt/Pulse-Main) | Frozen web-only backup | `origin` |

`git push` from the local working tree targets `pulsemac/main` so the web backup never accidentally receives Mac-specific changes.

## Further Reading

- `PRD.md` — full product spec, security model, and chronological change log.
