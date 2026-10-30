---
name: demo-video
description: Make a polished product demo video of any website (a public URL, ours, or a local dev server) from a script or a short brief, fully on this machine with no paid services. Use when asked for a demo, walkthrough, product tour, feature video or launch clip of a site.
---

# Demo video from a site

The pipeline is in `src/` and runs locally: scout → voice (Kokoro, or macOS `say`) → frame-perfect Playwright recording → HyperFrames composition → render → FFmpeg loudness pass. Nothing may call a paid API: never run `hyperframes auth login`, `publish`, `cloud`, `lambda`, `cloudrun` or `audio --quality best`, and never run `capture` without `--skip-vision`.

## 1. Scout the site

```bash
npm run demo -- scout https://example.com [--id name]
```

This writes `out/<id>/scout/site.json` (title, brand colours and font, sections, every clickable element and input, each with a working selector), `shot-*.jpg` screenshots down the page, and a rough starter spec at `demos/<id>.json`.

**Look at the screenshots** with the Read tool before writing anything. They show what is worth demoing. The starter spec is only a skeleton: rewrite it.

## 2. Write the spec (`demos/<id>.json`; schema in `src/spec.ts`)

- **Story:** a hook in the intro, one idea per scene, a call to action in the outro. The narration runs at ~2.2 words a second: about 19 words per scene and ≤155 words in total.
- **Brand:** check scout's guess against the screenshots. The accent is the colour the brand uses across the most roles, never link blue or a one-off badge colour. Keep `ground` dark. Set `chrome: "dark"` for dark sites.
- **Actions** show what the narration says, in order:
  - `hover` / `click` / `type` take `selector`, `zoom` (camera punch-in: click 1.45, type 1.5, hover 1.3; `1` = none), `callout` (a 2–5 word bubble pointing at the element) and `spotlight` (dims everything else; on by default for click and type, and whenever there's a callout).
  - `scrollTo {selector, offset}` scrolls with easing. `scroll {y}`, `wait {seconds}`, `goto {url}`.
- **Selectors:** use the ones in `site.json`. They were checked to resolve on the live page. Playwright selectors work (`:has-text()`, `:visible`, `section:has(h2:has-text("…"))`). Watch out: `:has-text` matches the element's textContent, so `<br>`-split headings join with no space ("Intakeand integrations"), exactly as scout writes them.
- **Clutter:** common cookie banners and chat widgets are hidden or declined automatically. List anything else under `hide`.
- Give each scene 1–2 beats with callouts. More reads as busy.

## 3. Build

```bash
npm run demo -- all demos/<id>.json --quality draft            # voice → record → compose → check → render
npm run demo -- all demos/<id>.json --engine say --voice Samantha --quality draft   # if the Kokoro model isn't downloaded
```

Or run one step at a time: `voice`, `record`, `compose`, `check`, `render`. Changing the narration changes scene lengths, so re-run `voice --force`, then `record` and `compose`.

Recording renders every frame as a 2× screenshot with the page clock frozen. Expect 1–3 minutes on heavy sites. A `! skipped …` line means a selector didn't resolve on the live page: fix it in the spec and re-record.

## 4. Review

`cd out/<id>/project && npx hyperframes snapshot --at <t,…>`, then read the contact sheet. Check every beat:

- Does the camera frame the element, and does the zoom stay inside the window?
- Does the cursor land on the target?
- Does the callout point at the right thing without covering what it describes?
- Does the spotlight ring sit on the element? It's placed from the element's box at action time, so it drifts if the page moves under it.
- Is anything sitting at the page's top when it should have scrolled?

Fix problems in the spec and rebuild. `npm run demo -- check` must pass with no warnings.

## 5. Polish (optional)

The project in `out/<id>/project` is plain HyperFrames HTML. Load `/hyperframes` before editing it. You can swap in registry pieces (`npx hyperframes catalog --tag transition --json`), or open Studio for manual edits (`npx hyperframes preview`). **Re-running `compose` overwrites hand edits**, so render with `npm run demo -- render` afterwards.

## 6. Deliver

```bash
npm run demo -- render demos/<id>.json --quality standard    # → out/<id>/<id>.mp4
```

Measure it with `npx hyperframes audio out/<id>/<id>.mp4 --json` (about −14 LUFS, no clipping), and say it was measured, not listened to. Without a music file the film has no music. Say so, and mention `"music": "../audio/music/<file>"`.
