// npm run social -- reel <listing-url | reels/<id>.json> [--render | --yes] [--new] [--force] [--quality draft|standard|high]
//   A listing URL writes reels/<id>.json from the listing data (if it doesn't exist yet).
//   Every run first builds the reel and writes its storyboard (out/<id>/storyboard.md plus a
//   still per scene) and stops there for review. --render renders it once the storyboard of
//   this exact spec has been made; --yes does storyboard and render in one go.
//   --new only writes the spec, so the copy can be edited first.
// npm run social -- carousel <deals | carousels/<id>.json> [--render | --yes] [--count 5] [--under 200000] [--state CA] [--new]
//   deals writes carousels/deals-<date>.json from live auctions (biggest discounts first);
//   a spec path uses that spec. The storyboard (slide outline) comes first, as for reels.
// Media options for reels: --music <file|default>, --no-music, --no-voice (no narration or
// captions), --engine say --voice Samantha.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeMusic, Grid } from "../beats.ts";
import { mediaFlags, resolveMusic } from "../media.ts";
import { check, render } from "../render.ts";
import { fingerprint, requireBoard } from "../storyboard.ts";
import { ROOT } from "../util.ts";
import { carouselBoard, reelBoard } from "./boards.ts";
import { renderCarousel } from "./carousel.ts";
import { dealsCarousel, loadCarousel } from "./carousel-spec.ts";
import { fetchAuctions, fetchListing } from "./listing.ts";
import { composeReel, prepareAssets, reelVoice } from "./reel.ts";
import { loadReel, starterReel } from "./reel-spec.ts";

const [kind, target, ...flags] = process.argv.slice(2);
const flag = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const yes = flags.includes("--yes");
const build = yes || flags.includes("--render");

if (!["reel", "carousel"].includes(kind) || !target) {
  console.error(`usage: npm run social -- reel <listing-url | reels/<id>.json> [--render | --yes] [--new] [--force] [--quality draft|standard|high]
                                [--music <file|default> | --no-music] [--no-voice] [--engine say --voice Samantha]
       npm run social -- carousel <deals | carousels/<id>.json> [--render | --yes] [--count 5] [--under 200000] [--state CA] [--new]`);
  process.exit(1);
}

// Writes a starter spec unless one exists (hand edits are never overwritten).
function writeStarter(path: string, spec: unknown) {
  if (existsSync(path)) {
    console.log(`spec  ${path} exists, using it (delete it to start over)`);
    return;
  }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`spec  → ${path}`);
}

const review = (cmd: string) =>
  console.log(`\nReview the storyboard above. Once it's approved, build it with:\n  ${cmd} --render\n`);

if (kind === "carousel") {
  let specPath = target;
  if (target === "deals") {
    const spec = dealsCarousel(await fetchAuctions(), {
      count: Number(flag("--count") ?? 5),
      under: flag("--under") ? Number(flag("--under")) : undefined,
      state: flag("--state"),
    });
    specPath = join(ROOT, "carousels", `${spec.id}.json`);
    writeStarter(specPath, spec);
    if (flags.includes("--new")) process.exit(0);
  }
  const { spec, specDir } = loadCarousel(specPath);
  const print = fingerprint(spec, null);
  const cmd = `npm run social -- carousel ${specPath.startsWith(ROOT) ? specPath.slice(ROOT.length + 1) : specPath}`;
  if (!build) {
    carouselBoard(spec, print);
    review(cmd);
    process.exit(0);
  }
  if (yes) carouselBoard(spec, print);
  requireBoard(spec.id, print, yes, cmd);
  await renderCarousel(spec, specDir);
  process.exit(0);
}

let specPath = target;
if (/^https?:/.test(target)) {
  const listing = await fetchListing(target);
  specPath = join(ROOT, "reels", `${listing.slug}.json`);
  writeStarter(specPath, starterReel(listing));
  if (flags.includes("--new")) process.exit(0);
}

const { spec, specDir } = loadReel(specPath);
if (flag("--engine")) spec.voice.engine = flag("--engine") as "kokoro" | "say";
if (flag("--voice")) spec.voice.voice = flag("--voice")!;
const media = mediaFlags(flags);
if (media.music !== undefined) spec.music = media.music;
if (media.narration !== undefined) spec.narration = media.narration;
const music = resolveMusic(spec.music, specDir);
const grid = new Grid(music ? analyzeMusic(music) : null);
const print = fingerprint(spec, music);
const force = flags.includes("--force");
const opts = [media.music === false ? " --no-music" : media.music ? ` --music ${media.music}` : "", media.narration === false ? " --no-voice" : ""].join("");
const cmd = `npm run social -- reel ${specPath.startsWith(ROOT) ? specPath.slice(ROOT.length + 1) : specPath}${opts}`;

if (build && !yes) requireBoard(spec.id, print, false, cmd);
await prepareAssets(spec, specDir, { force });
const vo = reelVoice(spec, { force });
composeReel(spec, specDir, vo, grid);
check(spec.id);
if (!build || yes) reelBoard(spec, vo, grid, music, print);
if (!build) {
  review(cmd);
  process.exit(0);
}
render(spec.id, { quality: flag("--quality") ?? "standard" });
