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

## 3. Build and review

```bash
npm run social -- reel reels/<slug>.json --no-render     # assets, voice, compose, check
cd out/<slug>/project && npx hyperframes snapshot --at 1.5,<one per scene>
npm run social -- reel reels/<slug>.json                 # + render → out/<slug>/<slug>.mp4
```

A line is only re-spoken when its text changes. Check that:
- frame 0 reads as a thumbnail
- no caption sits on a white panel
- the photo crop keeps the house in frame
- the check passes with no errors

Text stays inside 168–1330 px and clear of the right-hand action rail. The empty lower part of the frame is deliberate: Instagram's caption and buttons go there.

## Music credit

The default music is `audio/music/wallpaper.mp3` (CC BY). The post caption must include: `Music: "Wallpaper" by Kevin MacLeod (incompetech.com), CC BY 4.0`.
