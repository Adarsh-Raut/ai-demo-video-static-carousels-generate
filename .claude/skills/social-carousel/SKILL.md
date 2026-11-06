---
name: social-carousel
description: Make an Instagram/LinkedIn carousel (1080×1350 PNG slides plus a PDF) for Vihara, either live auction deals pulled from vihara.ai or an editorial set (glossary terms, buyer tips, stats), fully on this machine. Use when asked for a carousel, slides for Instagram, a deals post, a glossary or tips post.
---

# Social carousel

Code is in `src/social/carousel*.ts`: plain HTML/CSS slides screenshotted with Playwright. Fonts come from npm (Inter, Playfair Display), so there's no network use apart from the photos. Output goes to `out/<id>/`:
- `01.png`… slides at 1080×1350 for Instagram
- `<id>.pdf` for LinkedIn document posts
- `overview.jpg` contact sheet for review

## Deals (automatic)

```bash
npm run social -- carousel deals [--count 5] [--under 200000] [--state CA] [--new]
```

This reads every live auction from vihara.ai/auctions, keeps those that haven't ended, ranks them by discount to the Vihara estimate, and writes `carousels/deals-<date>[-filters].json`:
- a cover
- one slide per listing: photo, price tag, "% below estimate" badge when ≥10%, facts, estimate, auction date and time in the listing's own timezone
- an end card

`--new` stops after writing the spec, so you can edit the cover copy (a sharper hook beats the default) or drop a listing first.

## Editorial (written by hand or by Claude)

Write `carousels/<id>.json` using the slide kinds in `src/social/carousel-spec.ts`: `cover`, `listing`, `term`, `tip`, `stat`, `cta`. See [carousels/auction-terms.json](../../../carousels/auction-terms.json) for an example. Then:

```bash
npm run social -- carousel carousels/<id>.json
```

- **Structure:** a hook cover ("4 words every first-time bidder should know"), 3–8 content slides with one idea each, and a cta last. Instagram allows up to 20 slides.
- **term** (dictionary card, serif on cream): split the word into syllables with `·` ("auc·tion"); `pos` is "noun"/"adjective", with an optional gloss ("noun, short for real estate owned"); 1–2 short definitions; an optional example in quotes.
- **tip:** `n`, a title of 3–8 words, and a body of no more than ~35 words.
- **stat:** a big `value` ("54%"), a `label`, and an optional `body`. Only use real numbers with a source.
- **Accuracy:** definitions must be correct and general. Don't promise anything about Vihara's fees, terms or process unless it's on vihara.ai.

## Review

Read `out/<id>/overview.jpg`, then at least one slide at full size. Check that:
- no text overflows its slide or overlaps the photo badge or price tag
- every heading reads as one thought on its line
- cover photos don't repeat the next slide's photo
