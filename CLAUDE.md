# site-video-generate

Local, zero-cost demo videos of websites. The only paid part is the coding agent.

- Pipeline: `src/` (TypeScript, run with `tsx`). Order: `scout <url>` → `storyboard` → (user approves) → `voice` → `record` → `compose` → `check` → `render`. See `.claude/skills/demo-video/SKILL.md`.
- Storyboard first, for every video and carousel: show the user `out/<id>/storyboard.md` (and the stills for reels) and wait for approval before building. The build commands refuse to run without a storyboard for the current spec (`src/storyboard.ts`); `--yes` skips the review, but only when the user says so.
- Beat sync: `src/beats.ts` + `py/beats.py` beat-track the music. Scene ends go through `grid.cutAfter()` and accents through `snapper()`. Music is on by default (`"default"`), or your own file, or `false`. Narration can be turned off (`"narration": false` / `--no-voice`).
- Code that runs inside the page (`page.evaluate`) is passed as a string, because tsx injects a `__name` helper the page doesn't have. Inside those template strings, regex escapes need a double backslash (`\\s`).
- Specs live in `demos/` (yours) and `examples/` (reference). Output goes to `out/<id>/`, which is git-ignored.
- Listing reels (1080×1920): `npm run social -- reel <listing-url | reels/<slug>.json>`, code in `src/social/`, specs in `reels/`. See `.claude/skills/listing-reel/SKILL.md`.
- Carousels (1080×1350 PNG + PDF): `npm run social -- carousel <deals | carousels/<id>.json>`, specs in `carousels/`. See `.claude/skills/social-carousel/SKILL.md`. Slides are HTML screenshotted with Playwright, fonts from `@fontsource-variable/*`. `fetchAuctions()` reads every live listing from vihara.ai/auctions. Shared SFX placement and escaping live in `src/media.ts`; TTS, the speech normaliser and Whisper word timing in `src/voice.ts`.
- `audio/sfx/` holds free sound effects (Pixabay licence, see CREDITS.md). Files named `click*`, `whoosh*`, `typing*`, `pop*`, `impact*` and `sparkle*` are picked up automatically. Put music in `audio/music/`.
- Never use paid or account-bound paths: HeyGen voices/music/cloud, `hyperframes auth`, `publish`, `cloud`, `lambda`, `cloudrun`, `audio --quality best`, or `capture` without `--skip-vision`.
- `npm run setup` (`src/setup.ts`) installs browsers, `py/.venv` (Kokoro TTS, from `py/requirements.txt`) and the Kokoro/Whisper models into `~/.cache/hyperframes`, which are never committed. `src/util.ts` points `HYPERFRAMES_PYTHON` at the venv. `--engine say --voice Samantha` skips Kokoro.
- `npm run typecheck` after editing `src/`.
