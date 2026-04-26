# Pulse

Pulse is a React + Vite application with an Express development server, Firebase-backed app data, and Supabase-backed Brain vector memory.

## Stack

- React 19 + Vite
- TypeScript
- Tailwind CSS
- Firebase Authentication + Firestore
- Supabase pgvector for Brain memory
- Gemini for Brain chat and embeddings

## Local Development

1. Install dependencies:
   - `npm install`
2. Create `.env.local` with the required keys:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL`
   - `GEMINI_EMBEDDING_MODEL`
   - `GEMINI_EMBEDDING_DIM`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Start the app:
   - `npm run dev`

The local app runs at `http://localhost:3000/`.

## Scripts

- `npm run dev` — start the Express + Vite development server
- `npm run build` — create the production Vite build
- `npm run preview` — preview the built frontend
- `npm run typecheck` — run TypeScript checks
- `npm run lint` — alias for `npm run typecheck`
- `npm run check` — run typecheck and build together
- `npm run clean` — clear local build and Vite cache artifacts

## Project Structure

```text
.
├── PRD.md
├── server.mjs
├── src
│   ├── components
│   ├── features
│   │   └── brain
│   ├── lib
│   └── pages
├── supabase
│   ├── brain_memory.sql
│   └── migrations
└── vite.config.ts
```

### Important Areas

- `server.mjs` — local API endpoints for Brain indexing, delete, and chat
- `src/features/brain` — Brain-specific UI constants and pure helper modules
- `src/lib/db.ts` — Firestore access layer
- `src/lib/brainApi.ts` — browser API client for Brain endpoints
- `supabase/migrations/20260422094500_brain_memory.sql` — Brain memory schema migration

## Brain Memory

Brain uses:

- Firestore for saved Brain cards and saved chats
- Supabase `public.brain_chunks` for vectorized retrieval

If the Brain memory schema is missing in Supabase, apply:

- `supabase/migrations/20260422094500_brain_memory.sql`

## Notes

- The Express dev server reads `.env.local` first.
- The Brain UI intentionally falls back to grounded local note matching when remote AI is unavailable in `work` mode.
