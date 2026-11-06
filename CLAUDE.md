# site-video-generate

Local, zero-cost demo videos of websites. The only paid part is the coding agent.

- Pipeline: `src/` (TypeScript, run with `tsx`). Order: `scout <url>` → `voice` → `record` → `compose` → `check` → `render`. See `.claude/skills/demo-video/SKILL.md`.
- Code that runs inside the page (`page.evaluate`) is passed as a string, because tsx injects a `__name` helper the page doesn't have. Inside those template strings, regex escapes need a double backslash (`\\s`).
- Specs live in `demos/` (yours) and `examples/` (reference). Output goes to `out/<id>/`, which is git-ignored.
- Listing reels (1080×1920): `npm run social -- reel <listing-url | reels/<slug>.json>`, code in `src/social/`, specs in `reels/`. See `.claude/skills/listing-reel/SKILL.md`. Shared SFX placement and escaping live in `src/media.ts`; TTS, the speech normaliser and Whisper word timing in `src/voice.ts`.
- `audio/sfx/` holds free sound effects (Pixabay licence, see CREDITS.md). Files named `click*`, `whoosh*`, `typing*`, `pop*`, `impact*` and `sparkle*` are picked up automatically. Put music in `audio/music/`.
- Never use paid or account-bound paths: HeyGen voices/music/cloud, `hyperframes auth`, `publish`, `cloud`, `lambda`, `cloudrun`, `audio --quality best`, or `capture` without `--skip-vision`.
- `py/.venv` (from `py/requirements.txt`) provides Kokoro TTS. `src/util.ts` points `HYPERFRAMES_PYTHON` at it. `--engine say --voice Samantha` skips it.
- `npm run typecheck` after editing `src/`.
