---
name: listing-reel
description: Make a vertical (1080×1920) Instagram/TikTok reel of a vihara.ai property listing, from its listing URL, fully on this machine with no paid services. Use when asked for a listing reel, property video, deal-of-the-day short or social clip of a listing.
---

# Listing reel from a vihara.ai listing

The pipeline is in `src/social/` and runs locally: listing data (scraped from the page) → photos + blurred backdrops (FFmpeg) → Kokoro voice → Whisper word timings → HyperFrames composition → render → FFmpeg loudness pass. Same no-paid-paths rules as the demo pipeline.

## 1. Write the starter spec

```bash
npm run social -- reel https://www.vihara.ai/listing/<slug> --new
```

This writes `reels/<slug>.json` with copy built from the listing: hook (beds + price), value (Vihara estimate vs starting bid, only if the discount is at least 10%), tour (photo cuts + fact chips), auction date, and the end card.

## 2. Make the copy good (this is the step that matters)

- **Look at the photos.** Download small versions and read them: `photos` in the spec is the full list, and each scene picks an index. Use the best exterior for the hook, and skip bad or duplicate shots. Listing photos are ~1024 px, so the layout shows them in a card, never full-bleed.
- **Hook:** something a local would say: "3-BED NEAR D.C.", not "3-BED HOME IN CAPITOL HEIGHTS". Keep the headline to ~15 characters and the price as `$126K`.
- **Be honest about condition.** A gutted house is "stripped to the studs, ready for your plans", not "move-in ready". Never invent features. Use only facts in the listing.
- **Narration:** one short sentence per scene, about 2.5 words a second. Write prices as `$126K` or `$155,118`, and write `sq ft`, `1.5 baths` and `D.C.` as you normally would: `forSpeech()` in `src/voice.ts` turns them into words for the voice, while the captions keep the written form.
- Scene kinds and fields are defined in `src/social/reel-spec.ts`. Remove a scene by deleting it, and reorder freely.

## Storyboard first: nothing is made until the user approves it

Every video starts with a storyboard. The build refuses to record or render until a storyboard exists for that exact spec and these media options (`--yes` skips this only when the user explicitly says not to review).

1. Make it (command below). It writes `out/<id>/storyboard.md`: a table with each scene's time, what's on screen, the motion, the sound and the narration. It also gives the music's tempo and confirms that cuts land on bar lines.
2. Show it to the user: paste the table into your reply, and read `out/<slug>/storyboard/contact-sheet.jpg` (one still per scene) and describe or attach it. Mention the media options they can change: music (the default track, their own file, or none) and narration (on or off).
3. Wait for their approval. If they ask for changes, edit the spec, make the storyboard again and show it again. Build only after a clear yes.

**Media options**, on any command:
- `--music <file>` uses their own track; `--music default` uses the bundled bed.
- `--no-music` means no music.
- `--no-voice` means no narration and no captions, and the music comes up to carry the film.
- Or set `"music"` (`"default"`, a path relative to the spec, or `false`) and `"narration"` (`true`/`false`) in the spec.

The music is beat-tracked locally (`py/beats.py`) and the film starts on its first downbeat. Scene cuts land on bar lines (or the next beat when a bar is far off), and key entrances and sound accents land on beats. The old scene leaves in the last ~0.3 s before each cut and the new one arrives on the beat.

## 3. Storyboard, approval, render

```bash
npm run social -- reel reels/<slug>.json [--no-voice] [--music <file> | --no-music]   # assets, voice, compose, check, storyboard; stops here
npm run social -- reel reels/<slug>.json --render                                   # after approval, same flags → out/<slug>/<slug>.mp4
```

A line is only re-spoken when its text changes. Check that:
- frame 0 reads as a thumbnail
- no caption sits on a white panel
- the photo crop keeps the house in frame
- the check passes with no errors

Text stays inside 168–1330 px and clear of the right-hand action rail. The empty lower part of the frame is deliberate: Instagram's caption and buttons go there.

## Music credit

The default music is `audio/music/wallpaper.mp3` (CC BY). With it, the post caption must include: `Music: "Wallpaper" by Kevin MacLeod (incompetech.com), CC BY 4.0`.
