# /brag experiment: vihara.ai launch video

This is a one-off test of the open-source [/brag](https://github.com/latent-spaces/brag) skill (MIT, commit `669ab92`, copied into `.claude/skills/brag` and `.claude/skills/brag-slim`) on https://www.vihara.ai/. It was made on 2026-11-07.

On Opus 5.5, `/brag` hands off to **`/brag-slim`**. In that mode the agent builds the whole video itself, soundtrack included, with the tools already on the machine. Here that meant Playwright, HyperFrames, FFmpeg and numpy, all local and free.

## The result

- 22 s, 1920×1080, 30 fps, `brag.mp4` (git-ignored; re-render as below), poster `brag.jpg`.
- Five scenes on a 120 BPM grid (cuts at 4, 8, 12, 17 s):
  1. **Hook:** "Bid. List. Sell. All with AI.", one word per beat, next to the site's live 3D city
  2. **Ask Vihara AI:** the search bar types "Auction homes in New Orleans" and three real listings pop in
  3. **The auction floor:** a 3D ring of seven real listing cards turns on the beat
  4. **Key results:** the site's 92% / 3x / 30 min figures count up
  5. **Close:** "Your next property is one bid away." on Vihara blue
- [brag-plan.md](brag-plan.md) is the storyboard and [share-copy.txt](share-copy.txt) the post caption.

## Files

| Path | What |
| --- | --- |
| `brag-plan.md` | the plan: angle, look, music, scene-by-scene storyboard |
| `composition/` | the HyperFrames project (`index.html`, `compositions/*.html`); its `assets/` are git-ignored |
| `scripts/capture.mjs` | loads vihara.ai (hiding the lead pop-up), saves section screenshots, copy, colours and image URLs |
| `scripts/assets.mjs` | downloads the 12 listing photos and the logo, and captures the hero's animated 3D canvas as frames |
| `scripts/music.py` | synthesises the 22 s soundtrack: 120 BPM, C major, with the sound effects written into the track |

## Rebuild it

```bash
cd brag-output && mkdir -p work/shots work/assets work/canvas composition/assets/photos
node scripts/capture.mjs work                        # site.json + screenshots
node scripts/assets.mjs work                         # photos, logo, canvas frames
../py/.venv/bin/python scripts/music.py work/music.wav
cp work/assets/*.jpg composition/assets/photos/
cp work/assets/logo.png composition/assets/
ffmpeg -i work/assets/logo.png -vf "format=rgba,lutrgb=r=255:g=255:b=255" composition/assets/logo-white.png
ffmpeg -framerate 10.09 -i work/canvas/f%03d.png -vf "fps=30,format=yuv420p" -c:v libx264 -crf 14 composition/assets/city.mp4
ffmpeg -i work/music.wav -af loudnorm=I=-14:TP=-1.5:LRA=7 -ar 48000 composition/assets/music.wav
cd composition && npx hyperframes check && npx hyperframes render -o ../brag.mp4 --quality high
```

The listings, prices and the live auction count change over time, so a rebuild today won't match the original frame for frame.

## What `main` took from it

- **Cuts on bar lines:** a beat grid where every cut lands on the music.
- **Clean transitions:** the old scene leaves just before the beat and the new one arrives on it.
- **Storyboard first:** nothing is built before you've seen the plan.
- **Redrawn real UI:** the product's UI instead of flat screenshots. This led to the `motion-video` branch.

## Credits

- **/brag skill:** MIT, by latent-spaces (`.claude/skills/brag/LICENSE`).
- **The skill's bundled music:** "Happy Beats / Business Moves" by Sascha Ende ([ende.app](https://ende.app/en), CC BY 4.0). The video itself doesn't use it; its soundtrack was synthesised by `scripts/music.py`.
- **The skill's sound effects:** [Kenney](https://kenney.nl/) (CC0).
