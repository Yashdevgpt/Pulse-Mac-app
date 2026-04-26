# Product Requirements Document (PRD): Pulse

## 1. Product Overview
**Name:** Pulse
**Description:** A secure, invite-only platform featuring a neo-brutalist design system. It manages user access through a waitlist and approval system, allowing authorized personnel to manage "DSPs" and view system logs.
**Distribution:** Pulse ships as a native macOS desktop application packaged with Electron. The app bundles the React frontend, the Express server (`server.mjs`), and a custom yellow "P" Dock icon into a single `.dmg` produced by `electron-builder`. There is no public web deployment — every user runs Pulse locally on their Mac, against their own Firebase + Supabase project. AI provider keys (Gemini, OpenRouter) are entered inside the app and stored only in the browser's `localStorage`; they are never persisted to any backend.

## 2. Target Audience
- **Administrators:** Users who manage access, approve/reject waitlist users, and have global visibility over all data.
- **Standard Users:** Authorized personnel who can manage their own DSPs and logs.

## 3. Core Features & Functionality

### 3.1 Authentication & Access Control
- **Auto-Waitlist System:** Users attempting to log in without an existing account are automatically registered in the background and placed on a "pending" waitlist. They are immediately shown a waitlist confirmation screen.
- **Role-Based Access Control (RBAC):**
  - `pending`: Can only see the waitlist screen.
  - `rejected`: Can only see the access denied screen.
  - `approved`: Can access the main application but only see their own data.
  - `admin`: Can access the Admin Panel, manage users, and see all data across the platform.
- **Bootstrap Admin:** The bootstrap admin email is environment-driven (`VITE_BOOTSTRAP_ADMIN_EMAIL`) with a fallback for backwards compatibility. To self-elevate to `admin` on first sign-in, the bootstrap account must have `email_verified = true` on its Firebase Auth token. Email matching is case-insensitive.
- **Server-Side Authorization:** All access checks are enforced by Firestore Security Rules (committed at `firestore.rules`). The Admin panel UI only succeeds because the rules engine recognises the requester as admin; modifying the client cannot bypass authorization.
- **Waitlist Bypass Protection:** The `/users/{uid}/**` document tree is gated behind `(isOwner(uid) && isApprovedStatus(uid)) || isAdmin()`, so pending and rejected users cannot bypass the UI by writing directly via the Firebase SDK.

### 3.2 Admin Panel (`/admin`)
- View all registered users.
- Edit user full names.
- Change user statuses (Approve, Reject, Make Admin, Remove Admin).
- **Cascading User Deletion:** Admins can permanently delete a user request. This action triggers a cascading delete in the database, completely wiping the user's profile, DSPs, logs, and custom tags from Firestore.
- **Self-Delete Protection:** Admins cannot delete their own `app_users` profile. Enforced both in the UI and in `firestore.rules` (`allow delete: if isAdmin() && uid != request.auth.uid`).
- **AI Keys panel:** Top section above the user list lets the operator paste a Gemini API key and an OpenRouter API key. Inputs are password-masked with a per-field show/hide toggle, a "Saved (N chars, ends XXXX)" hint underneath, and Save / Clear buttons. Keys live only in `localStorage` on this Mac (`pulse:ai-keys:v1`); they are never sent to Firestore, the bundled Express server's process env, or any cloud service. The client attaches them as `x-gemini-key` / `x-openrouter-key` headers on every Brain API call, and the server consumes them per-request without persisting.

### 3.3 Main Application Modules

#### Bridge (`/`)
- Dashboard and overview.
- Greeting line is randomly selected from a pool of 102 static greetings plus 8 generated per currently-starred DSP. The pool is rebuilt every time Bridge loads, so unstarring a DSP cleanly removes its greetings on the next visit.

#### Fleet (`/fleet`)
- Management interface for DSPs. Standard users see only their own; admins see all.
- DSP logbook permalinks use a letters-only slug derived from the DSP name, excluding numbers and symbols. Existing ID-based URLs continue to resolve.
- **Starred DSPs:** Each DSP card has a star toggle. Starred DSPs render first in the list (then by `updatedAt` desc within each group). Toggle is optimistic with rollback on Firestore failure.
- **Cascading Brain memory cleanup:** Deleting a DSP also removes the DSP record and every child log from Brain memory before the Firestore cascade.

#### Logbook (`/logbook/{dsp-slug}`)
- Per-DSP log view, accessible from a DSP card or via the slug URL.
- Deleting a log removes its entry from Brain memory before Firestore deletion, so chat sources cannot continue to cite a deleted record.

#### Watchtower (`/watchtower`)
- System and ongoing-task monitoring. Standard users see their own; admins see all.
- **Tag Filtering:** A controlled, portaled popover (rendered to `document.body`) presents the user's tags as toggleable rows with `Select All` / `Clear All`. Selection is persisted to Firestore via Watchtower preferences.
- **Tag CRUD:** Inline "+ New Tag" form (name + 8-color palette) creates tags and adds them to the visible set. Per-tag trash icon deletes the tag from Firestore and from Brain memory (`tag_record`).

#### Brain (`/brain`)
- Captures user-authored knowledge as Brain Cards, supports saved chats with the AI, and chats across centralised Pulse memory.
- **Chat panel layout:** Fixed-height card (`h-[680px]` mobile, `lg:h-[720px]` when chat sits below the editor, `xl:h-[calc(100vh-7rem)]` with a hard cap of 900 px when chat moves to the right column) that scrolls messages internally and keeps the input pinned at the bottom. On `xl` and above (≥1280 px) the panel is sticky to the viewport so it never scrolls out of view.
- **Sources rendering:** Brain answers carry an optional `sources` (private) and `webSources` (web grounding) payload. The UI renders web sources as clickable `<a target="_blank">` links and private sources as labelled pills. The system prompt suppresses the model from emitting a redundant inline "Sources:" line.
- **Auto-Index on Save:** Saving a Brain card or saving a Brain chat triggers a fire-and-forget call to `/api/brain/index` for that single source. Failures emit a soft toast directing the user to "Rebuild Memory" as the manual recovery path.
- **Summarize Older History:** A scissors-icon button appears in the chat header once there are ≥15 real messages. It compresses everything older than the most recent 10 into a single synthetic summary message via `/api/brain/summarize-history`, preserving facts, decisions, open questions, and topic order.
- **Reset Memory:** An eraser-icon button next to "Rebuild Memory" wipes every `brain_chunks` row owned by the requesting user (via `/api/brain/reset-memory`) and immediately re-indexes from current Firestore state. Used to reconcile the vector store after deletes.

## 4. Technical Architecture
- **Frontend Framework:** React 19 with Vite.
- **Routing:** React Router DOM v7.
- **Styling:** Tailwind CSS with a custom Neo-Brutalist design system (thick borders, hard shadows, vibrant colors like neo-yellow, neo-pink, neo-green, neo-cyan).
- **Backend / API:** Node.js + Express (`server.mjs`) serving Brain endpoints (`/api/brain/index`, `/api/brain/delete-source`, `/api/brain/chat`, `/api/brain/summarize-history`, `/api/brain/reset-memory`). The server has two run modes:
  - **Dev (`PULSE_MODE` unset):** loads Vite middleware via dynamic `import('vite')` so Tailwind, the React plugin, and HMR work for `npm run electron:dev` and `npm run dev`.
  - **Production (`PULSE_MODE=production`):** skips the Vite import entirely, serves the static `dist/` build, and reads its `.env` from `process.env.PULSE_ENV_PATH` (Electron passes the user-writable `~/Library/Application Support/Pulse/.env` path). The server always binds to `127.0.0.1` so no LAN port is exposed.
- **Desktop Shell (Electron):** `electron/main.cjs` is the Electron main process. On launch it (1) verifies a `.env` exists in Electron's `app.getPath('userData')` directory — seeding it from the bundled `.env.example` template and showing a "Reveal in Finder & Quit" dialog if missing; (2) finds a free `127.0.0.1` port via `net.createServer().listen(0)`; (3) spawns `server.mjs` as a Node child by re-launching `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, passing `PORT`, `PULSE_MODE=production`, and `PULSE_ENV_PATH`; (4) waits for the server's "Pulse running" stdout marker (30 s timeout) before opening a `BrowserWindow` (`titleBarStyle: 'hiddenInset'`, `sandbox: true`, `contextIsolation: true`, no preload, no node integration); (5) routes external links through `shell.openExternal`. On `before-quit` the child server is killed with `SIGTERM`.
- **Packaging:** `electron-builder` config in `package.json` produces `dist-electron/Pulse-<version>-arm64.dmg` (`asar: false`, unsigned, `identity: null`, `hardenedRuntime: false`, `gatekeeperAssess: false`, custom icon at `build/icon.icns`). The `files` glob ships the production runtime (`electron/`, `server.mjs`, `dist/`, `supabase/`, `.env.example`, `node_modules/**`) and explicitly excludes dev-only build tooling (`vite`, `@vitejs/*`, `@tailwindcss/vite`, `typescript`, `tsx`) and source maps from the bundle.
- **Database (App Data):** Firebase Firestore.
- **Database (Vector Memory):** Supabase Postgres with pgvector. Schema lives at `supabase/migrations/20260422094500_brain_memory.sql` and `supabase/migrations/20260424080000_expand_brain_memory_source_types.sql`.
- **Authentication:** Firebase Auth (email/password).
- **AI:** Google Gemini (`gemini-2.5-flash` for chat, `gemini-embedding-001` at 768 dimensions for embeddings) with an OpenRouter (`openai/gpt-5-nano`) fallback for chat completions.
  - **Per-request keys:** Gemini and OpenRouter keys are read from `x-gemini-key` and `x-openrouter-key` request headers — never from `process.env`. Helpers `getAiKeysFromReq(req)` and `requireGeminiKey(req)` propagate the key into `embedText`, `searchMemory`, `indexSources`, and `runChatWithFallback`. Endpoints return HTTP 412 with a "No AI keys configured" message if both keys are missing.
  - **Provider fallback:** `runChatWithFallback(req, res, prompt, geminiConfig)` tries Gemini first; on errors classified by `isGeminiFallbackError(error)` (HTTP 401 / 403 / 429, or messages containing `rate limit`, `quota`, `RESOURCE_EXHAUSTED`, `exceeded`, `api key not valid`, `invalid api key`) it transparently retries against OpenRouter's OpenAI-compatible endpoint (`https://openrouter.ai/api/v1/chat/completions`) with `model: openai/gpt-5-nano`. The provider used is exposed via the `X-Provider-Used: gemini|openrouter` response header and the `provider` field in `/api/brain/chat`. The client throttles a single "Switched to OpenRouter" toast per calendar day via `consumeFallbackToastSlot()` (`pulse:ai-keys:fallback-toast-date`).
  - **Embeddings stay Gemini-only.** OpenRouter embeddings are not used because the `brain_chunks` vector column dimension is fixed at 768. If only an OpenRouter key is configured, private memory search is skipped for that request and the chat falls back to client sources / web grounding.
- **Configuration:**
  - **AI keys → in-app `localStorage` only** (`pulse:ai-keys:v1`). Edited via Admin → AI Keys. No env var path. `clearAiKeys()` and a `pulse:ai-keys:changed` `CustomEvent` keep the panel in sync after edits.
  - **Supabase + Firebase + bootstrap admin → `.env`.** In dev, `.env.local` in the project root. In packaged Electron, the user-writable `~/Library/Application Support/Pulse/.env` (seeded from `.env.example` on first launch and read via `PULSE_ENV_PATH`). Firebase web config in `src/lib/firebase.ts` and the Firebase REST API key in `server.mjs` keep their hardcoded fallbacks for the dev experience; Firebase web `apiKey` is non-secret by design.
- **Security:**
  - Firestore Security Rules at `firestore.rules` enforce role-based isolation, waitlist gating, admin-only mutations, bootstrap admin self-elevation requiring `email_verified=true`, admin self-delete prevention, and default-deny on every other path.
  - Express rate limiting on `/api/brain/*`: a 60/min per-IP shield (pre-auth) plus a tiered per-user limit post-auth (300/min for the bootstrap admin email, 30/min for other authenticated users). Limits are reported via `X-RateLimit-*` and `X-User-RateLimit-*` headers.
  - Strict input validation on every Brain endpoint: source-type allowlist, required `sourceId` for delete, mode allowlist for chat, payload caps aligned with the Firestore document size limit (1 MB) so the user's memory is never silently truncated.
  - Brain memory is cleaned up automatically on log/DSP/tag/card/chat deletion to prevent vector orphans.
  - AI keys never reach the disk on the server side. They are in-memory only for the duration of a single HTTP request, are not logged, and are not persisted in any Firestore document.

## 5. Design System (Neo-Brutalist)
- **Borders:** Thick black borders (`border-3`, `border-4`).
- **Shadows:** Hard, solid black shadows (`shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`).
- **Typography:** Bold, uppercase headings, high contrast.
- **Interactive Elements:** Buttons and inputs feature translate effects on hover/active states to simulate physical pressing.
- **Naming:** Navbar items and page headings use single-word names (`Bridge`, `Fleet`, `Brain`, `Watchtower`, `Admin`). The "The" prefix that previously appeared in nav labels and page H1s has been dropped to keep the brand crisper.

## 6. Future Enhancements
- Email notifications for waitlist approvals.
- Advanced filtering and search in Fleet and Watchtower.
- User profile settings page.
- Auto-send Firebase email verification on first signup so bootstrap admins can elevate without console intervention.
- Auto-index Fleet and Logbook writes (DSPs, logs, tags) the way Brain cards and saved chats currently are, so manual "Rebuild Memory" becomes optional in all flows.

## 7. Approved Change Log

### 2026-04-17 - Local App Display Enablement
- **Approval:** User requested the app be displayed locally.
- **Reason:** The cloned app could not compile because several imported local UI primitives were missing, and TypeScript found incompatible `docx` image options.
- **Changes:**
  - Added local UI primitives: `button`, `input`, `textarea`, `badge`, `card`, and `popover`.
  - Fixed React type imports in toaster/watchtower code.
  - Fixed Word export image typing by detecting supported image formats before passing images to `docx`.
- **Logs:**
  - `npm install` completed with 445 packages changed and 1 moderate vulnerability reported by npm.
  - `npm run lint` passed after fixes.
  - Vite dev server started on `http://localhost:3000/`.
- **Timeline:**
  - Around 03:52 IST: Vite hot module reload confirmed UI/display fixes.

### 2026-04-17 - Bootstrap Admin Login Hardening
- **Approval:** User confirmed `sagargpt23@gmail.com` is the main admin email and wanted email/password auth only.
- **Reason:** Admin login was failing before Firestore access, and the app attempted to auto-create the bootstrap admin after invalid credentials.
- **Changes:**
  - Centralized bootstrap admin email as `sagargpt23@gmail.com`.
  - Normalized email input by trimming and lowercasing before sign-in and password reset.
  - Ensured the bootstrap admin is returned as `admin` even if an existing `app_users` record has another status.
  - Prevented bootstrap admin login failures from falling into automatic account creation.
  - Added clearer password-policy messaging for new accounts.
- **Logs:**
  - `npm run lint` passed after auth changes.
  - User later confirmed login was working.
- **Timeline:**
  - 03:52 IST: Auth bootstrap hardening hot-reloaded.
  - 03:53 IST: Admin failed-login messaging hot-reloaded.

### 2026-04-17 - DSP Name-Based Permalinks
- **Approval:** User requested DSP logbook URLs use the DSP name and remove numbers, even when numbers are entered in the name.
- **Reason:** Fleet logbook links used generated IDs such as `/logbook/dsp_1776049860351`, which were not human-readable.
- **Changes:**
  - Added shared DSP slug helpers.
  - New DSP records now use a letters-only slug derived from the DSP name as their ID.
  - Fleet links now route to `/logbook/{dsp-name-slug}`.
  - Existing old ID-based URLs still resolve, preserving old links.
  - Duplicate DSP permalink slugs are blocked during DSP creation.
- **Logs:**
  - `npm run lint` passed after permalink changes.
  - Vite hot module reload confirmed updates for Bridge, Fleet, and Logbook.
- **Timeline:**
  - 04:04 IST: Permalink change hot-reloaded.

### 2026-04-22 - Brain Memory P1 Hardening and Optimization
- **Approval:** User approved the Brain memory P1 fixes and explicitly approved updating the PRD.
- **Reason:** Brain vector memory was not live because the Supabase schema had not been deployed, and source reindexing could leave stale embeddings behind after content was shortened or edited.
- **Changes:**
  - Added a deployable Supabase migration at `supabase/migrations/20260422094500_brain_memory.sql`.
  - Kept the legacy SQL entrypoint at `supabase/brain_memory.sql` aligned with the migration path for manual application.
  - Added schema-aware Supabase error normalization in `server.mjs` so missing `public.brain_chunks` / `public.match_brain_chunks(...)` failures return a precise deployment instruction.
  - Added cached schema readiness probing at server startup and request time so Brain automatically re-checks readiness after the schema is deployed.
  - Updated Brain source indexing so surplus chunk rows are deleted when a source becomes shorter, preventing stale embeddings from remaining searchable.
  - Optimized Brain source indexing so unchanged chunks reuse existing embeddings and only changed chunks are re-embedded.
- **Logs:**
  - `node --check server.mjs` passed after the server-side optimization work.
  - `npm run lint` passed after the Brain memory fixes and optimizations.
  - `npm run build` passed after the Brain memory fixes and optimizations.
  - Startup/runtime errors now instruct operators to apply `supabase/migrations/20260422094500_brain_memory.sql` when the Supabase Brain schema is missing.
- **Timeline:**
  - 2026-04-22, before 10:13 IST: Added the deployable Brain memory migration and missing-schema detection path.
  - 2026-04-22, before 10:13 IST: Added stale-chunk cleanup and incremental re-embedding reuse during reindexing.
  - 10:13 IST: Validation completed with `node --check server.mjs`, `npm run lint`, and `npm run build`.
  - 10:14 IST: PRD updated after user approval.

### 2026-04-24 - Brain Delete Consistency Hardening
- **Approval:** User approved the Brain delete-path fix and approved updating the PRD.
- **Reason:** Brain card and saved-chat deletion could report success even when the Supabase memory delete failed, leaving stale vector memory behind while the Firestore record was gone.
- **Changes:**
  - Updated `src/pages/Brain.tsx` so Brain card deletion and saved-chat deletion no longer swallow `deleteBrainMemorySource(...)` failures.
  - Changed delete flow ordering so Supabase memory deletion succeeds before Firestore deletion is finalized.
  - Added rollback behavior that re-indexes the source into Brain memory if Firestore deletion fails after memory removal.
  - Restricted success toasts to the fully successful path so the UI no longer reports a completed delete when memory cleanup fails.
- **Logs:**
  - `npm run lint` passed after the Brain delete-path consistency fix.
- **Timeline:**
  - 2026-04-24, before 04:03 IST: Patched Brain delete flows to surface memory delete failures and added rollback restoration for partial failures.
  - 04:03 IST: Validation completed with `npm run lint`.
  - 04:04 IST: PRD updated after user approval.

### 2026-04-24 - Watchtower Filter Rebuild and Centralized Brain Refinement
- **Approval:** User approved updating the PRD and approved pushing the current changes to a new branch.
- **Reason:** Watchtower needed operator-controlled tag visibility instead of fixed examples, Brain needed centralized current-user memory on rebuild, and several dark-mode / chat-rendering issues were degrading usability.
- **Changes:**
  - Rebuilt `Watchtower` filtering around a persisted multi-select dropdown so operators can choose any tag set, use `Select all` / `Clear all`, and view ongoing items matching any selected tag.
  - Expanded Brain rebuild scope to current-user profile data, DSP records, tag records, fleet logs, Brain cards, saved chats, and supported attachment text while keeping indexing manual via `Rebuild Memory`.
  - Added server-side recency-aware Brain retrieval and widened Brain source typing so prompts such as `latest` / `recent` can rank recent private sources more reliably.
  - Added Markdown rendering for Brain answers and fixed low-contrast dark-mode copy in Brain mode descriptions and the sidebar account email.
  - Added the Supabase migration `supabase/migrations/20260424080000_expand_brain_memory_source_types.sql` and aligned `supabase/brain_memory.sql` with the broader source-type model.
- **Logs:**
  - `node --check server.mjs` passed after the centralized Brain retrieval changes.
  - `npm run lint` passed after the Watchtower, Brain, and dark-mode fixes.
  - `npm run build` passed after the Watchtower, Brain, and dark-mode fixes.
  - Live Supabase projects must apply `supabase/migrations/20260424080000_expand_brain_memory_source_types.sql` before centralized Brain rebuild can index the new source types successfully.
- **Timeline:**
  - 2026-04-24, before 07:27 IST: Rebuilt Watchtower tag selection around a persisted dropdown with any-tag filtering semantics.
  - 2026-04-24, before 07:27 IST: Centralized Brain rebuild around current-user profile, DSP, tag, log, card, and saved-chat sources and added recency-aware retrieval behavior.
  - 2026-04-24, before 07:27 IST: Fixed Brain markdown rendering and dark-mode text visibility regressions.
  - 07:27 IST: PRD updated after user approval to push the current changes to a new branch.

### 2026-04-26 - Security Hardening (HIGH-severity audit fixes)
- **Approval:** User asked for all HIGH-severity findings from a code/security audit to be fixed without breaking the running app.
- **Reason:** The audit identified a hardcoded Firebase web config, no committed Firestore rules, client-only admin authorization, a hardcoded bootstrap admin email, and unbounded payload + no rate limiting on Brain endpoints.
- **Changes:**
  - **Firebase config → env:** Moved Firebase web config in `src/lib/firebase.ts` to `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`. Existing values remain as fallbacks so the dev experience is preserved before the env file is populated. Added `src/vite-env.d.ts` with typed declarations for the new variables.
  - **Bootstrap admin email → env:** `BOOTSTRAP_ADMIN_EMAIL` is now read from `VITE_BOOTSTRAP_ADMIN_EMAIL` in `src/lib/db.ts` and `src/components/AuthWrapper.tsx`. The server (`server.mjs`) reads `BOOTSTRAP_ADMIN_EMAIL` (or `VITE_BOOTSTRAP_ADMIN_EMAIL`) for rate-limit tier detection. Existing email is kept as a fallback.
  - **Firestore rules:** Added `firestore.rules` with helpers for `isOwner`, `isBootstrapAdmin`, `requesterStatus`, `isAdmin`, gating reads/writes on `app_users/{uid}` and `users/{uid}/**`, allowing bootstrap admin self-elevation only on owner-update with `status='admin'`, allowing owner-only updates of non-privileged fields, and a default-deny match on every other path.
  - **Server-side admin authorization:** With committed rules, all `app_users` mutations and per-user data CRUD are enforced by the Firestore rules engine on Google's servers. Modifying the client cannot bypass authorization.
  - **Rate limiting + payload caps:** Added an in-memory token-bucket rate limiter to `server.mjs` covering all `/api/brain/*` endpoints. Added strict input validation: `sourceType` must be in the allowlist, `sourceId` is required for delete, `mode` is allowlist-validated, and per-source / per-history caps enforce a 1 MB ceiling matched to Firestore document size.
- **Operational notes:**
  - Production deployments should populate `.env.local` (or equivalent) with the new `VITE_FIREBASE_*`, `VITE_BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_EMAIL` values to enable rotation.
  - `firestore.rules` must be deployed via the Firebase console or `firebase deploy --only firestore:rules` for the rules to take effect; without that, only the client-side checks apply.
- **Logs:**
  - `node --check server.mjs` passed.
  - `npm run typecheck` passed.
  - `npm run build` passed.
- **Timeline:**
  - 2026-04-26: HIGH-severity items fixed end-to-end and PRD updated after user approval.

### 2026-04-26 - Firestore Rules Peer Review (anti-spoofing, waitlist bypass, self-delete)
- **Approval:** User accepted three peer-review findings on the new `firestore.rules` and asked for the regressions to be patched.
- **Reason:** Initial rules permitted (a) anyone with a Firebase Auth account using the bootstrap email — verified or not — to claim admin; (b) pending and rejected users to bypass the waitlist UI by writing directly to `/users/{uid}/**` via the Firebase SDK; (c) admins to delete their own profile, locking themselves out.
- **Changes:**
  - `isBootstrapAdmin()` now requires `request.auth.token.email_verified == true` and uses a case-insensitive regex (`(?i)^sagargpt23@gmail\\.com$`) so token-email capitalisation differences cannot bypass the check. The standalone `bootstrapEmail()` helper was inlined into the predicate.
  - Added `isApprovedStatus(uid)` and gated `/users/{uid}/{document=**}` behind `(isOwner(uid) && isApprovedStatus(uid)) || isAdmin()`.
  - Tightened `app_users/{uid}` delete: `allow delete: if isAdmin() && uid != request.auth.uid` so admins cannot delete themselves.
  - Documented in the rules file that the bootstrap email must match `VITE_BOOTSTRAP_ADMIN_EMAIL`.
- **Operational note:** The bootstrap admin's Firebase Auth account must show `Email verified = true` for self-elevation to succeed. Password signups arrive with `email_verified=false` until verified by clicking Firebase's verification email or flipping the flag in the Firebase console.
- **Logs:**
  - `npm run typecheck` and `npm run build` passed (rules are not part of TS compilation; client behavior was not regressed).
- **Timeline:**
  - 2026-04-26: Rules tightened per peer review.

### 2026-04-26 - Brain Capacity, UX, and Memory Hygiene
- **Approval:** User approved expanding chat history retention, removing per-source caps, fixing the chat panel UX, adding a Reset Memory action, and cleaning up orphan vectors created by pre-existing delete paths that never propagated to Supabase.
- **Reason:** Saved chats were truncated to the last 12 messages × 1200 chars before being sent to Gemini; per-source content was capped at 60 KB; the chat panel grew with content and pushed the entire page taller without internal scrolling; sources from deleted Firestore records still appeared in chat citations; the user lacked a one-click way to reconcile the vector store with Firestore.
- **Changes:**
  - **Full history retention:** Removed the `MAX_HISTORY_MESSAGES` slice on incoming requests and the `.slice(-12)` in `formatHistory()`. The entire saved conversation now reaches Gemini. Per-message length cap raised to 1 MB.
  - **No per-source content cap:** Raised `MAX_SOURCE_CONTENT_LENGTH` to 1 MB (matches Firestore document limit). `MAX_CHUNKS_PER_SOURCE` raised from 60 to 1000. `chunkText()` and `buildSourceRows()` updated to match.
  - **Tiered rate limits:** Reworked `/api/brain/*` rate limiting into a 60/min per-IP shield (pre-auth) plus a tiered per-user limit post-auth: 300/min for the bootstrap admin email, 30/min for everyone else. Headers (`X-RateLimit-*`, `X-User-RateLimit-*`) expose tier and remaining.
  - **Sources as clickable links:** `ChatMessage` and `BrainChatMessage` types now carry optional `sources` and `webSources`. The chat UI renders a "Sources" footer beneath assistant replies — web sources are deduped by URI and rendered as `<a target="_blank">`, private sources render as labelled type-pills. The system prompt suppresses the redundant inline "Sources:" line and instructs the model to format any inline URLs as proper markdown links.
  - **Summarize Older History:** Added `POST /api/brain/summarize-history` (auth + rate-limited) which compresses an arbitrary array of messages into a markdown summary that preserves decisions, facts, open questions, and topic order. Client helper `summarizeBrainHistory(messages)`. Scissors-icon button in the chat header appears once there are ≥15 real messages and replaces everything older than the most recent 10 with one synthetic `kind: 'summary'` message rendered with distinct styling (cyan tint, dashed border, sparkles header).
  - **Auto-index on save:** Added `indexBrainSource(source)` helper. `Brain.tsx#createCard` (when content is non-empty), `saveSelectedCard`, and `saveCurrentChat` now fire-and-forget index the affected source. Failures emit a soft toast pointing to "Rebuild Memory" as the manual recovery path.
  - **Chat panel layout (initial pass):** Replaced `min-h-[620px]` with a bounded height, added a sticky pattern on the largest breakpoint, and added `min-h-0` to the messages container so flex `overflow-y-auto` actually scrolls. Added `messagesScrollRef` with auto-scroll on `[messages, isThinking]`. Initial breakpoints used `2xl` for the 3-column / chat-on-the-right layout. *(Superseded by the 2026-04-26 layout breakpoint follow-up below.)*
  - **Reset Memory:** Added `POST /api/brain/reset-memory` (auth + rate-limit + schema-readiness probe) which deletes every `brain_chunks` row owned by the requesting user. Client helper `resetBrainMemory()`. Eraser-icon button in the chat panel that confirms, wipes Supabase, then immediately calls `rebuildMemory()` to re-index from current Firestore state.
  - **Cascading Brain cleanup on delete:** `Fleet.tsx#handleDeleteDsp` snapshots child logs and fires `deleteBrainMemorySource('dsp_record', ...)` and `deleteBrainMemorySource('fleet_log', ...)` for each via `Promise.allSettled` before the Firestore cascade. `Logbook.tsx#handleDelete` calls `deleteBrainMemorySource('fleet_log', logId)` before the Firestore delete. Watchtower tag delete (added the same day) calls `deleteBrainMemorySource('tag_record', tagId)`. Failures are logged but non-fatal — Reset Memory remains the safety net.
- **Operational note:** Fleet/Logbook auto-cleanup applies only to records deleted after this change. Records deleted before the auto-cleanup paths existed remain in Supabase as orphans — use Reset Memory to reconcile.
- **Logs:**
  - `node --check server.mjs` passed.
  - `npm run typecheck` passed.
  - `npm run build` passed.
- **Timeline:**
  - 2026-04-26: Capacity, auto-index, summarize, sources-as-links, reset endpoint, and orphan cleanup paths shipped.

### 2026-04-26 - Watchtower CRUD, Fleet starring, Bridge greetings, Navbar, Favicon
- **Approval:** User approved each polish item.
- **Reason:** Watchtower's third-party DropdownMenu trigger threw at runtime and unmounted the entire `/watchtower` route (no Error Boundary) producing a blank page that required a hard refresh; users could neither create nor delete tags from the UI; Fleet had no way to pin priority partners; the Bridge greeting pool was 6 lines; the project shipped without a favicon; and the user wanted nav labels stripped of the "The" prefix.
- **Changes:**
  - **Watchtower Filter Tags popover (blank-page fix):** Replaced the `@base-ui/react` DropdownMenu with a controlled component portaled to `document.body` (`createPortal`) using fixed-position coordinates derived from the trigger's `getBoundingClientRect()`, recomputed on `resize` and `scroll`. Click-outside detection covers both the trigger and the portaled panel. Escapes the parent `Card`'s `overflow-hidden` so the panel never clips at the bottom.
  - **Watchtower tag CRUD:** Added inline "+ New Tag" form (name + 8-color palette: blue, purple, green, red, orange, pink, cyan, yellow) inside the popover. New tags are saved to Firestore via `db.saveTag()` and immediately added to the visible-tag set. Per-tag trash icon (subtle until hover) confirms, removes the Brain memory chunks for `tag_record:tagId`, deletes the Firestore record, and rolls back the optimistic UI on failure.
  - **Fleet starring:** Added `starred?: boolean` to the `DSP` interface. Star toggle button on every Fleet card (filled yellow when starred, plain otherwise) with optimistic UI and rollback. Sort order is starred-first then `updatedAt` desc within each group.
  - **Bridge greeting pool:** Expanded to **102 static greetings** plus **8 generated per starred DSP**. The pool is built inside `loadData()` after Firestore returns, so unstarring a DSP cleanly removes its greetings on the next visit. Floor pool size is always ≥102.
  - **Favicon:** Added `public/favicon.svg` — a bold "P" letterform on Pulse-yellow `#ffc900` with a black neo-brutalist border and a small heartbeat trace at the bottom-left. Rendered from primitives so it doesn't depend on system fonts. Linked from `index.html` along with `theme-color="#f97316"` and a description meta tag.
  - **Navbar / page H1 cleanup:** Dropped the "The" prefix in `src/components/Layout.tsx` (`Bridge`, `Fleet`, `Brain`, `Watchtower`) and in the `<h1>` titles of `src/pages/Fleet.tsx`, `src/pages/Brain.tsx`, and `src/pages/Watchtower.tsx`. Bridge's empty-state copy in Fleet was updated to use lowercase article ("Create one from the Bridge"). Bridge greetings were left unchanged because the article reads naturally in prose.
- **Logs:**
  - `npm run typecheck` passed.
  - `npm run build` passed.
- **Timeline:**
  - 2026-04-26: All five polish items shipped after user approval.

### 2026-04-26 - Brain Chat Layout Breakpoint Fix
- **Approval:** User reported that on a wide laptop screen the chat panel was still rendering below the editor and growing the page as messages were added.
- **Reason:** The 3-column layout that places the chat in its own sticky right-hand column was gated behind `2xl` (≥1536 px). On screens between `xl` (1280 px) and `2xl`, the chat fell into the `xl:col-span-2` row-below position instead, so internal scrolling never engaged the way the user expected.
- **Changes:**
  - Lowered the 3-column grid breakpoint from `2xl` to `xl`. The grid is now `lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_380px] xl:items-start` — so users on standard wide laptops (≥1280 px) immediately get cards rail / editor / sticky chat side-by-side.
  - Updated the chat Card to `h-[680px] lg:col-span-2 lg:h-[720px] xl:col-span-1 xl:h-[calc(100vh-7rem)] xl:max-h-[900px] xl:sticky xl:top-4`. Sticky and viewport-relative height now activate at `xl` instead of `2xl`.
  - Lowered the chat-mode-tile vertical-stack breakpoint from `2xl:grid-cols-1` to `xl:grid-cols-1` so the three modes stack neatly inside the narrower right column at `xl`.
  - Updated PRD §3.3 and the prior layout changelog entry to reference the correct breakpoints.
- **Logs:**
  - `npm run typecheck` passed.
  - `npm run build` passed.
- **Timeline:**
  - 2026-04-26: Layout breakpoints corrected after user-reported regression.

### 2026-04-26 - App-Shell Containment Fix (root cause for runaway page scroll)
- **Approval:** User reported the page still grew with chat content even after multiple Brain.tsx layout passes, and asked for a real diagnosis before any further commits.
- **Reason:** `src/components/Layout.tsx` had `min-h-screen` on the outer shell. That made the body grow whenever inner content exceeded the viewport (cards row ~620 px + chat panel 720 px = ~1364 px > viewport at lg). The `<main>` element's `overflow-y-auto` never engaged because its ancestor was unbounded — so even though the chat Card itself was correctly bounded with `lg:h-[720px]` + `overflow-hidden` and internal message scrolling, the body itself scrolled, giving the appearance that the chat was unbounded. Earlier fixes inside Brain.tsx were necessary but couldn't be sufficient until the outer shell was constrained.
- **Changes:**
  - `src/components/Layout.tsx` outer container: added `lg:h-screen lg:min-h-0 lg:overflow-hidden` so at `lg+` the shell is exactly 100 vh and cannot grow with content. Mobile/sm/md keeps `min-h-screen` for the natural body-scroll experience.
  - With the outer shell now bounded at `lg+`, the existing `<main>` `overflow-y-auto` (line 147) finally engages, providing internal main-area scrolling. Chat's `lg:h-[720px]` and `xl:sticky xl:top-4` work as designed because they sit inside a true scroll container.
  - No changes needed in Brain.tsx — its bounded chat panel and sticky positioning were correct; they just needed a parent that respected its own height.
- **Verification path documented for the user:** hard-refresh and exercise three viewport sizes — wide screen (xl: chat sticky on right, no body scroll), wide screen with DevTools open (lg: chat below editor, body does not scroll, main scrolls, chat scrolls internally), mobile (unchanged).
- **Logs:**
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - Server route `/api/brain/reset-memory` verified registered after server restart (HTTP 401 with auth-required body, not 404).
- **Timeline:**
  - 2026-04-26: Containment bug diagnosed and patched at the root after multiple symptom-level passes failed.

### 2026-04-27 - macOS Desktop App + In-App AI Keys + OpenRouter Fallback
- **Approval:** User asked for a way to run Pulse directly on macOS without hosting it anywhere, plus a way to enter AI provider keys inside the app and a transparent fallback to a second provider once Gemini's free-tier daily request limit was hit (the user reported `21/20` RPD on `gemini-2.5-flash`). User explicitly approved: lock the fallback model to `openai/gpt-5-nano`, store keys per-machine in `localStorage`, surface a one-time daily toast on switch, and ship as an Electron `.app`/`.dmg`. User asked for the PRD to be updated and the change to be pushed to the dedicated `Pulse-Mac-app` GitHub repository.
- **Reason:** Free-tier Gemini caps were blocking daily Brain usage; the user wanted to swap or rotate provider keys monthly without redeploying or editing files; and the user wanted Pulse to feel like a real Mac application with a Dock icon and Launchpad entry rather than a `localhost:3000` browser tab.
- **Changes:**
  - **AI key store (`src/lib/aiKeys.ts`, new):** `getAiKeys()` / `setAiKeys()` / `clearAiKeys()` reading and writing `pulse:ai-keys:v1` in `localStorage` with a `pulse:ai-keys:changed` `CustomEvent` for in-app reactivity. `consumeFallbackToastSlot()` returns `true` at most once per UTC calendar day (`pulse:ai-keys:fallback-toast-date`) so the "Switched to OpenRouter" toast fires once per day rather than on every fallback call.
  - **Brain API client (`src/lib/brainApi.ts`):** `callBrainApi(...)` now reads `getAiKeys()` and attaches `x-gemini-key` / `x-openrouter-key` headers to every Brain request. HTTP 412 responses surface a "Open Admin → AI Keys to set them." hint. Responses with `x-provider-used: openrouter` trigger a single throttled `toast.message('Switched to OpenRouter', ...)`.
  - **Server refactor (`server.mjs`):**
    - Removed all `process.env.GEMINI_API_KEY` reads. Added `getAiKeysFromReq(req)` and `requireGeminiKey(req)`; `getGemini`, `embedText`, `searchMemory`, `indexSources`, `indexSingleSource`, and `enrichRowsWithEmbeddings` now thread `req` through so the per-request key is used.
    - New `runChatWithFallback(req, res, prompt, geminiConfig)` wraps both `/api/brain/chat` and `/api/brain/summarize-history`. Calls Gemini first; on `isGeminiFallbackError(error)` (HTTP 401/403/429 or message keywords) it falls back to OpenRouter `openai/gpt-5-nano` via raw `fetch` to `https://openrouter.ai/api/v1/chat/completions`. Sets `X-Provider-Used` response header on every chat call. Web grounding (`groundingMetadata.groundingChunks`) is only consumed when the Gemini path succeeded, since OpenRouter responses do not carry it.
    - `/api/brain/chat` returns HTTP 412 if both keys are missing. Memory search is skipped (Gemini-only embeddings) when only an OpenRouter key is set.
    - Production mode: `PULSE_MODE=production` serves `dist/` as static files with an SPA `*` fallback to `dist/index.html`. Vite middleware import is now `await import('vite')` only when not in production. The server reads `.env` from `process.env.PULSE_ENV_PATH` (set by Electron) and binds to `127.0.0.1`.
  - **Admin → AI Keys panel (`src/pages/Admin.tsx`):** New section above the user list. Two password-masked inputs (Gemini, OpenRouter) with per-field show/hide toggles, a "Saved (N chars, ends XXXX)" hint, Save / Clear buttons, and a "Saved at HH:MM:SS" stamp after save. Save calls `setAiKeys(...)` and toasts. Clear wipes `localStorage`. The OpenRouter caption notes the model is locked to `openai/gpt-5-nano`.
  - **Electron shell (`electron/main.cjs`, new):** Main process spawns `server.mjs` as a Node child via `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, finds a free `127.0.0.1` port via `net.createServer().listen(0)`, waits for the "Pulse running" stdout marker (30 s timeout) before opening a `BrowserWindow` (`titleBarStyle: 'hiddenInset'`, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`). On first packaged launch, `ensureUserEnv()` seeds `~/Library/Application Support/Pulse/.env` from the bundled `.env.example` and shows a "Reveal in Finder & Quit" dialog so the operator can populate Supabase + Firebase keys before the second launch. External links are routed through `shell.openExternal`. The custom application menu keeps standard `View` (reload, devtools, zoom, fullscreen), `Edit`, and `Window` items plus an `About` / `Quit` entry. The child server is killed with `SIGTERM` on `before-quit`.
  - **`package.json`:** Added `main: "electron/main.cjs"` and the scripts `electron:dev`, `electron:build`, `electron:build:universal`. Added devDeps `electron@^33.2.0` and `electron-builder@^25.1.8`. Full `build` block: `appId: com.local.pulse`, `productName: Pulse`, `asar: false`, `directories.output: dist-electron`, mac target `dmg` for `arm64`, `category: public.app-category.productivity`, `icon: build/icon.icns`, unsigned (`identity: null`, `hardenedRuntime: false`, `gatekeeperAssess: false`). The `files` glob ships `electron/`, `server.mjs`, `dist/`, `supabase/`, `.env.example`, and `node_modules/**` while excluding `vite`, `@vitejs/*`, `@tailwindcss/vite`, `typescript`, `tsx`, `*.map`, `*.ts`, `*.tsx`, and `src/` from the bundle.
  - **App icon (`build/icon.icns`):** Generated from `public/favicon.svg` (yellow neo-brutalist "P" with heartbeat accent) by rendering to a 1024 px PNG via `qlmanage` and emitting the standard `.iconset` rungs (16×16 through 512×512 plus `@2x`) with `sips`, then packed via `iconutil -c icns`.
  - **`.env.example`:** Removed `GEMINI_API_KEY` and replaced the Gemini section with a comment explaining that Gemini and OpenRouter keys are entered in-app and never read from this file. The model + dimension defaults remain.
  - **`.gitignore`:** Added `dist-electron/`, removed the catch-all `build/` entry, and added the more targeted `build/icon.iconset/` so the generated `.icns` ships with the repo while the intermediate iconset folder stays out.
- **Operational notes:**
  - Build flow: `npm install` → `npm run electron:build` → `dist-electron/Pulse-0.0.0-arm64.dmg`.
  - Install flow: drag `Pulse.app` to `/Applications`, then `xattr -cr /Applications/Pulse.app` to clear the macOS Gatekeeper quarantine bit (the `.dmg` is unsigned because Apple Developer ID enrollment is not part of the personal-use scope).
  - First launch creates `~/Library/Application Support/Pulse/.env` from the bundled `.env.example` and reveals it in Finder. The operator must populate `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (and optionally the `VITE_FIREBASE_*` overrides) before relaunching.
  - After login, AI keys are entered in Admin → AI Keys.
- **Repository topology:** The Mac-app variant of Pulse lives at `https://github.com/Yashdevgpt/Pulse-Mac-app` (remote `pulsemac`, push default for the local `main` branch). The original web-only repository at `https://github.com/Yashdevgpt/Pulse-Main` (remote `origin`) is kept frozen at the pre-Electron `Initial commit` as a backup. Plain `git push` from the working tree targets `pulsemac` so accidental pushes do not contaminate the web-only backup.
- **Logs:**
  - `node --check server.mjs` and `node --check electron/main.cjs` passed.
  - `npm run typecheck` passed.
  - `npm run build` produced the production Vite bundle (1.7 MB JS, 77 KB CSS).
  - Smoke test: `PULSE_MODE=production` server started on a free port, returned `HTTP 200` for `/` (static `dist/index.html`), `HTTP 412` with `"No AI keys configured. Add a Gemini and/or OpenRouter key in Admin → AI Keys."` for `POST /api/brain/chat` with no key headers, and `HTTP 401` once a bogus key passed the key check (auth ran next).
  - `electron-builder --mac --arm64` produced `dist-electron/Pulse-0.0.0-arm64.dmg`. The `.app` opens via `xattr -cr` + double-click, displays the custom Pulse icon in the Dock and Finder, and drives Brain chat against the user's Gemini key with transparent OpenRouter fallback when the Gemini daily limit is hit.
- **Timeline:**
  - 2026-04-27: AI key store, brain API header injection, server refactor with OpenRouter fallback, Admin AI Keys panel, Electron main process, electron-builder config, custom `.icns`, `.env.example` cleanup, and `.gitignore` adjustments shipped.
  - 2026-04-27: Branch `anthr/elated-perlman-cb6e44` merged into `main` via no-ff merge, custom Pulse icon rebuilt and shipped, repo topology split between `Pulse-Main` (web backup) and `Pulse-Mac-app` (active Mac project) with `remote.pushDefault = pulsemac` configured to prevent accidental cross-pushes.
