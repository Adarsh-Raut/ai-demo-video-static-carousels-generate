// npm run social -- reel <listing-url | reels/<id>.json> [--new] [--no-render] [--force] [--quality draft|standard|high] [--engine say --voice Samantha]
//   A listing URL writes reels/<id>.json from the listing data (if it doesn't exist yet) and builds it;
//   --new only writes the spec, so the copy can be edited first. A spec path rebuilds that spec.
//   --no-render stops after the check, for reviewing snapshots or editing in Studio first.
// npm run social -- carousel <deals | carousels/<id>.json> [--count 5] [--under 200000] [--state CA] [--new]
//   deals writes carousels/deals-<date>.json from live auctions (biggest discounts first) and renders it;
//   a spec path renders that spec (glossary, tips, stats: any mix of slide kinds).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, render } from "../render.ts";
import { ROOT } from "../util.ts";
import { renderCarousel } from "./carousel.ts";
import { dealsCarousel, loadCarousel } from "./carousel-spec.ts";
import { fetchAuctions, fetchListing } from "./listing.ts";
import { composeReel, prepareAssets, reelVoice } from "./reel.ts";
import { loadReel, starterReel } from "./reel-spec.ts";

const [kind, target, ...flags] = process.argv.slice(2);
const flag = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);

if (!["reel", "carousel"].includes(kind) || !target) {
  console.error(`usage: npm run social -- reel <listing-url | reels/<id>.json> [--new] [--no-render] [--force] [--quality draft|standard|high]
       npm run social -- carousel <deals | carousels/<id>.json> [--count 5] [--under 200000] [--state CA] [--new]`);
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
const force = flags.includes("--force");

await prepareAssets(spec, specDir, { force });
const vo = reelVoice(spec, { force });
composeReel(spec, specDir, vo);
check(spec.id);
if (!flags.includes("--no-render")) render(spec.id, { quality: flag("--quality") ?? "standard" });
