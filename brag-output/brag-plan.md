# /brag-slim: vihara.ai

**Input:** website, https://www.vihara.ai/ (inspected live on 2026-11-07)
**Format:** landscape 1920×1080, 30 fps, 22 s
**Tone:** `default`, leaning polished. Punchy and clean, never jokey: people are bidding real money on real homes.

## Rubric

- **What it is:** an online marketplace where anyone can find, research and bid on bank-owned and distressed property auctions, with AI help.
- **Who it's for:** home buyers and investors who want auction deals without the paperwork, the courthouse steps or the guesswork.
- **What sets it apart:**
  - You describe the home you want in plain words.
  - Every listing shows an estimated value and every buyer fee upfront.
  - You bid remotely, in real time.
- **Most impressive claim:** the site's own key results: 92% of bidders gain clarity on property risk before bidding; 3x more likely to bid on high-ROI deals; 30 min to onboard.
- **Visual hook:** the hero's live 3D city, with a "LIVE AUCTION" price ticking up from $142,500 to $150,000 while the headline slams in word by word.
- **Real UI to show:**
  - the hero headline and city
  - the "Describe your ideal home" search bar
  - real listing cards (photo, city, beds · baths · sq ft, est. value)
  - the auction-floor card ring
  - the key results
  - the blue closing panel
- **Share caption:** "Bank-owned homes, live auctions, every fee upfront. Bid from your couch on vihara.ai."

## Angle

The angle is "Bid. List. Sell. All with AI.", taken literally. The site's own four-beat headline is the hook. It lands on the first four beats of the track, and then the video proves it:

1. You describe what you want.
2. You step onto the auction floor.
3. You see the numbers.
4. One bid away.

## Visual identity (from the site's CSS)

- **Ground:** `#f7f8fa`, with a faint 64 px grid like the hero.
- **Ink:** `#111827`, muted `#6b7280`.
- **Brand blue:** `#0c4bea`, used for the closing panel and the accent words.
- **Type:** Inter 600 for headlines (tight −0.03em tracking, as on the site) and Inter 400/500 for UI.
- **Cards:** 16 px radius, soft shadow, photo with a dark gradient footer. The text is the site's own: city, facts, "$X est. value".
- **Real assets:**
  - 12 listing photos from the live auction floor
  - the Vihara logo
  - a 6 s capture of the hero's animated 3D canvas

  The search bar, cards and ring are rebuilt in HTML from the site's markup and styles; no live URLs.

## Music

- **Tempo and grid:** 120 BPM; one beat is 0.5 s, one bar is 2 s, counted from frame 0.
- **Key and chords:** C major, one chord per bar, cycling C → G → Am → F.
- **Instruments:** synthesised locally (numpy): kick, hats, clap, sub bass, warm pad, and plucks in key.
- **Effects in key:**
  - each hook word gets a pluck on a chord tone (C, E, G, then a full C chord for "All with AI.")
  - card pops are plucks on the current chord
  - the spin and scene changes get soft filtered-noise swells that peak on the downbeat
  - typing gets quiet ticks on 16ths
- **Ending:** the closing chord lands at 20.0 s and rings out to 22 s.

## Storyboard

| # | Time | Scene | On screen | Motion / cut | Sound |
|---|---|---|---|---|---|
| 1 | 0.0–4.0 | **Hook** | "Bid." "List." "Sell." then "All with AI." in blue, left. The live 3D city video on the right, price ticking. | Words punch in on beats 0, 0.5, 1.0 and 1.5 (y 40→0, blur→sharp). The city rises in at 1.8; the whole frame drifts 2%. Fully in by 2.0 s, holds 2 s. | Kick from frame 0; plucks C-E-G; C chord stab at 1.5. |
| 2 | 4.0–8.0 | **Ask** | Kicker "Ask Vihara AI". The site's search bar types "Auction homes in New Orleans". Three real New Orleans cards pop in below. | Bar scales in at 4.0, types 4.4–5.9, enter at 6.0. Cards pop at 6.0, 6.25 and 6.5, then hold. | Hats only, typing ticks, clap at 6.0, plucks on G. |
| 3 | 8.0–12.0 | **Auction floor** | "Step onto the *auction floor*". A 3D ring of 7 real cards, with the front card's city, facts and est. value. | Heading in by 8.4. The ring rotates one card on 9.0, 10.0 and 11.0 (back.out ease). | Full groove; swell into each spin. |
| 4 | 12.0–17.0 | **Results** | "Win smarter, with less guesswork". 92% / 3x / 30 min count up, each with its site label. | Stats land at 12.4, 12.9 and 13.4; the counters run 0.6 s. Holds to 17. | Plucks on each stat; melody arp. |
| 5 | 17.0–22.0 | **One bid away** | Blue `#0c4bea` panel. "Your next property is one bid away." "Every buyer fee is shown upfront on each listing." White logo and a "vihara.ai" pill. | Panel wipes up from the bottom (old content out first). Headline in by 17.6, sub at 18.2, pill at 18.6. Holds 3 s. | Impact and swell at 17.0, pad and arps; final C chord at 20.0 rings out. |

The scenes add up to 4 + 4 + 4 + 5 + 5 = 22 s.

## Privacy

Nothing private is shown: public listing photos, public cities and facts, public site copy. Street addresses are left off the cards, matching the site's own ring.
