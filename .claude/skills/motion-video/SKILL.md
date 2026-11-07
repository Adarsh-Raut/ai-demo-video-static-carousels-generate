---
name: motion-video
description: Make a launch-style motion video (1920×1080) of a product from its redrawn UI, not a screen recording: one-word headlines, UI moments (search, cards, value bar, bid button, checklist), an accent-dot flood between scenes, every cut on a bar line. Fully local. Use when asked for a launch film, a hop-style video, a motion-graphics product video or a UI explainer.
---

# Motion video

The code is in `src/motion/` and the specs are in `motion/<id>.json` (schema in `src/motion/spec.ts`; example [motion/vihara.json](../../../motion/vihara.json)). The style comes from studying the hop launch video:
- **One idea per scene.** Each scene is a short headline ending in a period ("Ask." "Check." "Bid.") plus one UI moment.
- **Redrawn UI.** The product's UI is redrawn as clean HTML and animated: search bar, cards, a value bar dragged by a cursor, a button the cursor presses, a counter, a toast.
- **Everything on the beat.** Every scene is a whole number of bars, so every cut is on a bar line. Entrances, presses, drops and counters land on beats.
- **The flood.** An accent dot appears a beat before each cut and swells over the frame. On the bar line, a hole opens from the centre and the new scene sharpens in.
- **A strict look.** White ground, one accent, Inter 500 with tight tracking, motion blur on.

## Scene kinds

| Kind | What it shows |
| --- | --- |
| `lines` | Short lines, one per beat, each replacing the last. The first is the thumbnail. |
| `logo` | The logo lands on the downbeat, the tagline a beat later. |
| `search` | Headline, then a search bar types the query; Enter lands on a beat and the cards drop one per beat. |
| `value` | Headline plus a number rolling from the estimate to the starting bid. The cursor drags a bar; the labels and badge appear once it settles. |
| `bid` | Headline, current bid and countdown. The cursor presses the button on a beat, the bid rolls up, and a toast lands. |
| `checks` | Headline, then one checklist row per beat. |
| `flood` | White words on a full accent background. |
| `end` | Logo, headline and URL, held past the last bar line (`tail`). |

## Workflow

1. **Write the spec.** Use real data only: listing photos, places and prices from vihara.ai (`fetchAuctions()` in `src/social/listing.ts`), and site copy for claims. Generic UI text such as "Bid placed." is fine; invented results are not.
2. **Make the storyboard:** `npm run motion -- motion/<id>.json`. This builds the project and writes `out/<id>/storyboard.md` with a still per scene. Show both to the user and wait for approval.
3. **Render after approval:** `npm run motion -- motion/<id>.json --render`. Add `--music <file>` or `--no-music` to change the track. `musicOffset` starts the track at a chosen bar line. Keep the total bars within the track's length.

**Music licensing.** `motion/vihara.json` uses the soundtrack taken from the hop launch video (`out/.music/hop-launch.m4a`, git-ignored) for study only. Its licence is unknown, so don't post a video that uses it. Swap in a licensed track with `--music` before publishing.
