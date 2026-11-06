// npm run social -- reel <listing-url | reels/<id>.json> [--new] [--no-render] [--force] [--quality draft|standard|high] [--engine say --voice Samantha]
//   A listing URL writes reels/<id>.json from the listing data (if it doesn't exist yet) and builds it;
//   --new only writes the spec, so the copy can be edited first. A spec path rebuilds that spec.
//   --no-render stops after the check, for reviewing snapshots or editing in Studio first.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, render } from "../render.ts";
import { ROOT } from "../util.ts";
import { fetchListing } from "./listing.ts";
import { composeReel, prepareAssets, reelVoice } from "./reel.ts";
import { loadReel, starterReel } from "./reel-spec.ts";

const [kind, target, ...flags] = process.argv.slice(2);
const flag = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);

if (kind !== "reel" || !target) {
  console.error("usage: npm run social -- reel <listing-url | reels/<id>.json> [--new] [--force] [--quality draft|standard|high]");
  process.exit(1);
}

let specPath = target;
if (/^https?:/.test(target)) {
  const listing = await fetchListing(target);
  specPath = join(ROOT, "reels", `${listing.slug}.json`);
  if (existsSync(specPath)) console.log(`spec  ${specPath} exists, building it (delete it to start over)`);
  else {
    mkdirSync(join(ROOT, "reels"), { recursive: true });
    writeFileSync(specPath, `${JSON.stringify(starterReel(listing), null, 2)}\n`);
    console.log(`spec  → ${specPath}`);
  }
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
