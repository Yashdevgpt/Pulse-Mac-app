# Pulse macOS App — Operations Guide

A plain-language reference for keeping Pulse running on your Mac. Covers updating, debugging, window dragging, and sharing the app with someone else.

> Project root: `/Users/yash/Downloads/Pulse-main`. Run every Terminal command from this folder unless noted.

---

## 1. Update or add a feature

The same loop every time, whether you're tweaking a button color, adding a page, or rewiring the AI fallback.

### Step 1. Edit code

Open the project in your editor (VS Code, Cursor, Claude Code). Make changes to:

- `src/` — React components, pages, hooks, lib code
- `server.mjs` — Express endpoints, AI calls, Brain memory
- `electron/main.cjs` — desktop shell, window setup, server spawn
- `package.json` — dependencies, scripts, electron-builder config

### Step 2. Live-test (no full build needed)

```bash
npm run electron:dev
```

This opens Pulse in a real Electron window backed by the Vite dev server. Edits to React files **hot-reload instantly** (Vite HMR). Edits to `server.mjs` or `electron/main.cjs` need a restart: ⌘Q the window, then re-run the command.

### Step 3. Build the new `.app`

When you're happy with the changes:

```bash
rm -rf dist-electron
npm run electron:build
```

Build takes ~2–4 min. Output: `dist-electron/Pulse-0.0.0-arm64.dmg`.

### Step 4. Install over the old version

```bash
open dist-electron
```

- Double-click the new `.dmg`
- Drag `Pulse.app` to `Applications`. macOS will ask "Replace existing?" → click **Replace**.
- Eject the disk image (right-click in Finder → Eject).

```bash
xattr -cr /Applications/Pulse.app
```

### Step 5. Reopen Pulse

Click Pulse in Dock or Launchpad.

> **Your `.env` and AI keys are NOT lost.** They live outside the `.app`:
> - `.env` is at `~/Library/Application Support/Pulse/.env`
> - AI keys are in Electron's localStorage (`~/Library/Application Support/Pulse/Local Storage/`)
>
> The new build inherits both automatically. No reconfig needed.

### Step 6. Commit + push

```bash
git add -A
git commit -m "describe what you changed"
git push
```

`git push` defaults to `pulsemac` (the `Pulse-Mac-app` repo). The `Pulse-Main` web backup is untouched.

### Want help from Claude?

Open a Claude Code session inside `/Users/yash/Downloads/Pulse-main` and describe the change. Claude can edit code, run tests, build, and commit in one go.

---

## 2. Debug when something breaks

### Symptom A — Pulse won't open at all

Run the binary from Terminal so you can see the live error stream:

```bash
/Applications/Pulse.app/Contents/MacOS/Pulse
```

Look for lines starting with `[server]`, errors mentioning `Pulse server did not start`, or stack traces. Send that output to Claude or read it yourself — it will tell you exactly what failed.

### Symptom B — Pulse opens, window is blank or "Pulse failed to start" dialog

This means the Express server inside Pulse died on launch. Two common causes:

1. **`.env` malformed or missing keys.** Open and verify:
   ```bash
   open ~/Library/Application\ Support/Pulse/.env
   ```
   Confirm `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are all present and not blank.

2. **Supabase schema not applied.** Apply both migrations in your Supabase project:
   - `supabase/migrations/20260422094500_brain_memory.sql`
   - `supabase/migrations/20260424080000_expand_brain_memory_source_types.sql`

### Symptom C — Pulse opens but Brain chat says "No AI keys configured"

Open **Admin → AI Keys** and verify the hint under each input shows `Saved (N chars, ends XXXX)`. If it shows `Not set`, paste your Gemini and OpenRouter keys and click **Save Keys**.

### Symptom D — "Switched to OpenRouter" toast every day

That's normal. Means Gemini hit the daily 20-RPD free-tier cap and Pulse silently fell over to `openai/gpt-5-nano`. Solutions:

- Upgrade to a paid Gemini tier
- Or: add credit to OpenRouter and let the fallback handle daily traffic

### Symptom E — Stuck Pulse process / app frozen

Force-quit any orphan server processes:

```bash
pkill -f "server.mjs"
```

Then quit Pulse (⌘Q), wait 5 sec, reopen.

### Symptom F — Want to roll back to last working version

```bash
cd /Users/yash/Downloads/Pulse-main
git log --oneline                  # find the last good commit hash
git reset --hard <commit-hash>     # WARNING: discards uncommitted edits
npm run electron:build
```

> **Warning:** `git reset --hard` permanently destroys uncommitted local changes. Only run if you know nothing important is unsaved. To preview changes that would be lost first: `git status` and `git diff`.

After rebuild, drag the new `.app` over the old + run `xattr -cr /Applications/Pulse.app`.

### Symptom G — Total reset (last resort)

Wipes the installed app and your config. You'll need to re-fill `.env` and re-add AI keys.

```bash
rm -rf /Applications/Pulse.app
rm -rf ~/Library/Application\ Support/Pulse
```

Then rebuild, install, reconfigure.

### When in doubt → ask Claude

Open a Claude Code session in the project root. Paste the error message or describe the symptom. Claude can grep the codebase and propose a fix.

---

## 3. Drag the Pulse window between monitors

The Pulse window uses macOS's frameless `hiddenInset` style — there's no visible title bar, so the drag handle isn't obvious.

### How to drag (after the 2026-04-27 fix)

The **yellow sidebar header** (the strip with the Pulse logo at top-left) is now a window drag handle. Click and hold anywhere in the yellow area (except on a button), then drag — the window follows.

On mobile-sized windows, the top header bar is also draggable.

### Alternative ways macOS lets you move the window

- **Hover over the green ⊕ button** (top-left traffic lights) → hold → menu shows **"Move to Other Display"** and tile options.
- **Window menu → Move Window to <Display Name>** at the top of the screen when Pulse is focused.
- **Mission Control** (F3 or 3-finger swipe up) → drag the Pulse thumbnail to a different desktop.

### If dragging still doesn't work

The change requires a fresh build + reinstall — see §1 (Update or add a feature). The drag CSS only applies in newly-built `.app` bundles.

---

## 4. Share Pulse with someone else

> **Critical:** Pulse is unsigned. Recipient WILL see "Pulse can't be opened, unidentified developer" on first launch. They MUST run `xattr -cr /Applications/Pulse.app` after installing or they'll think the app is broken.

### Things to tell the recipient before sharing

- They need their **own** Firebase project, **own** Supabase project, and **own** Gemini + OpenRouter API keys. Pulse stores user data in those services — your Pulse and their Pulse are separate, isolated instances.
- The default build is **arm64 only** (M1/M2/M3/M4 Macs). For an Intel Mac, you must build a universal binary (see below).
- They will need to walk through `.env` setup on first launch, the same way you did.

### Build a universal binary (Apple Silicon + Intel)

Only needed if you're sharing with someone on an Intel Mac.

```bash
cd /Users/yash/Downloads/Pulse-main
rm -rf dist-electron
npm run electron:build:universal
```

Output: `dist-electron/Pulse-0.0.0-universal.dmg` (larger, ~400 MB).

### Sharing options

#### Option A — AirDrop (in person)

In Finder, navigate to `dist-electron/`, right-click the `.dmg`, choose **Share → AirDrop**, pick the recipient.

#### Option B — Cloud upload (Google Drive, Dropbox, iCloud)

Drag the `.dmg` to your cloud-drive folder in Finder. Right-click → Get shareable link. Send the link.

#### Option C — GitHub Release (cleanest, versioned)

```bash
cd /Users/yash/Downloads/Pulse-main
gh release create v0.1.0 dist-electron/Pulse-0.0.0-arm64.dmg \
  --repo Yashdevgpt/Pulse-Mac-app \
  --title "Pulse v0.1.0" \
  --notes "First Mac release. Apple Silicon (arm64) only. After install, run: xattr -cr /Applications/Pulse.app"
```

Recipient downloads from `https://github.com/Yashdevgpt/Pulse-Mac-app/releases`.

> The `Pulse-Mac-app` repo is **private**. The recipient needs read access (invite them as a collaborator) OR you make the repo public. **Do not make the repo public** unless you're comfortable with the bundled Firebase web config (`pulseapp23` project) and bootstrap admin email being visible.

### Instructions to copy-paste to the recipient

```
1. Download Pulse-0.0.0-arm64.dmg
2. Double-click the .dmg → drag Pulse to Applications
3. Open Terminal (Cmd+Space → "Terminal") and paste:
     xattr -cr /Applications/Pulse.app
4. Open Pulse (Launchpad → Pulse). On first launch you'll see
   "Pulse needs configuration" — click "Reveal in Finder & Quit".
5. Edit the .env file that opens with YOUR Supabase + Firebase keys.
   (You need your own Firebase + Supabase projects — Pulse won't work
   with someone else's keys.)
6. Reopen Pulse → sign in with Google → click Admin tab.
7. Under "AI Keys", paste YOUR Gemini key and YOUR OpenRouter key,
   then click Save Keys.
8. Done. Use the Brain tab to ask questions.
```

### Want zero recipient friction?

Apple Developer Program ($99/year) signs + notarizes the build so macOS opens it without warnings. Out of scope for personal use, but worth knowing exists.

---

## Quick command cheat-sheet

| Goal | Command |
| --- | --- |
| Live-edit Pulse with hot reload | `npm run electron:dev` |
| Build new `.app`/`.dmg` | `rm -rf dist-electron && npm run electron:build` |
| Build universal (Intel + arm64) | `npm run electron:build:universal` |
| Install: open the dmg | `open dist-electron` |
| Strip Gatekeeper quarantine | `xattr -cr /Applications/Pulse.app` |
| See live server logs from Pulse | `/Applications/Pulse.app/Contents/MacOS/Pulse` |
| Edit runtime `.env` | `open ~/Library/Application\ Support/Pulse/.env` |
| Kill stuck server | `pkill -f "server.mjs"` |
| Push to Mac repo | `git push` (defaults to `pulsemac`) |
| Push to web backup repo | `git push origin main` (rare) |
| Roll back to a commit | `git log --oneline` then `git reset --hard <hash>` |
| Total nuke (start over) | `rm -rf /Applications/Pulse.app ~/Library/Application\ Support/Pulse` |
