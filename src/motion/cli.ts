// npm run motion -- <motion/<id>.json> [--render | --yes] [--music <file|default> | --no-music] [--quality draft|standard|high] [--force]
//   Builds the film and writes its storyboard (out/<id>/storyboard.md + a still per scene),
//   then stops for review. --render renders it once the storyboard of this exact spec exists;
//   --yes does both in one go.
import { analyzeMusic, Grid } from "../beats.ts";
import { mediaFlags, resolveMusic } from "../media.ts";
import { check, render } from "../render.ts";
import { stills } from "../social/boards.ts";
import { type BoardRow, fingerprint, requireBoard, writeBoard } from "../storyboard.ts";
import { ROOT, round } from "../util.ts";
import { composeMotion, frameOf, motionSlots, prepareMotionAssets } from "./compose.ts";
import { loadMotion, type MotionScene } from "./spec.ts";

const [target, ...flags] = process.argv.slice(2);
const flag = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
if (!target) {
  console.error("usage: npm run motion -- <motion/<id>.json> [--render | --yes] [--music <file|default> | --no-music] [--quality draft|standard|high]");
  process.exit(1);
}
const yes = flags.includes("--yes");
const build = yes || flags.includes("--render");

const { spec, specDir } = loadMotion(target);
const media = mediaFlags(flags);
if (media.music !== undefined) spec.music = media.music;
const music = resolveMusic(spec.music, specDir);
const grid = new Grid(music ? analyzeMusic(music) : null, 600, music ? spec.musicOffset : undefined);
const print = fingerprint(spec, music);
const opts = media.music === false ? " --no-music" : media.music ? ` --music ${media.music}` : "";
const cmd = `npm run motion -- ${target.startsWith(ROOT) ? target.slice(ROOT.length + 1) : target}${opts}`;

if (build && !yes) requireBoard(spec.id, print, false, cmd);
await prepareMotionAssets(spec, specDir, { force: flags.includes("--force") });
const { slots } = composeMotion(spec, music, grid);
check(spec.id);

if (!build || yes) {
  const describe = (s: MotionScene): Pick<BoardRow, "onScreen" | "motion" | "sound"> => {
    switch (s.kind) {
      case "lines": return { onScreen: s.lines.map((l) => `"${l}"`).join(" / "), motion: "one line per beat, each replacing the last", sound: "a soft pop per line" };
      case "logo": return { onScreen: `logo${s.tagline ? ` / "${s.tagline}"` : ""}`, motion: "logo sharpens in on the downbeat, tagline on the next beat", sound: "sparkle" };
      case "search": return { onScreen: `"${s.headline}" + search bar typing "${s.query}" + cards: ${s.cards.map((c) => `${c.place} ${c.price}`).join(", ")}`, motion: "types from beat 2, enter on the next beat, one card drops per beat", sound: "typing, click, a pop per card" };
      case "value": return { onScreen: `"${s.headline}" + number rolling ${s.estimate.toLocaleString("en-US")} → ${s.price.toLocaleString("en-US")} + bar: ${s.estimateLabel} vs ${s.priceLabel} + badge "${s.badge}"`, motion: "cursor drags the bar from beat 2 to beat 4, badge stamps on beat 4", sound: "click on the grab, impact on the badge" };
      case "bid": return { onScreen: `"${s.headline}" + ${s.label} ${s.from.toLocaleString("en-US")} + countdown + button "${s.button}" + toast "${s.toast}"`, motion: `cursor presses on beat 5, bid rolls to ${s.to.toLocaleString("en-US")}, toast on beat 7`, sound: "click on the press, pop on the toast" };
      case "hop": return { onScreen: `${s.headlines.map((h) => `"${h.text}"`).join(" → ")} + cards: ${s.cards.map((c) => `${c.place} ${c.price}`).join(", ")}`, motion: `a ball hops card to card on beats ${s.hops.map((h) => h.beat + 1).join(", ")} (the track's hop sounds); squash on landing, ripple, the landed card dips and lights up, the others dim; the last one is picked`, sound: "the track's whoops carry each hop" };
      case "checks": return { onScreen: `"${s.headline}" + ${s.items.map((i) => `✓ ${i}`).join(", ")}`, motion: "one row per beat", sound: "a pop per row" };
      case "flood": return { onScreen: `white on full accent: ${s.words.map((w) => `"${w}"`).join(" / ")}`, motion: "words punch in on beats", sound: "impact per word" };
      case "end": return { onScreen: `logo / "${s.headline}" / ${s.url}${s.sub ? ` / ${s.sub}` : ""}`, motion: "headline, URL and small print in on successive beats, held to the end", sound: "sparkle, music fades out" };
    }
  };
  writeBoard(
    {
      id: spec.id,
      kind: "Motion video",
      format: `${frameOf(spec.format)}, 30 fps`,
      music,
      bpm: music ? round(grid.bpm, 1) : undefined,
      narration: false,
      rows: slots.map((sl, i) => ({
        scene: `${sl.scene.kind} (${sl.scene.bars} bar${sl.scene.bars > 1 ? "s" : ""})`,
        start: sl.start,
        end: round(sl.start + sl.duration),
        ...describe(sl.scene),
        motion: `${i ? "opens out of the accent flood on the bar line; " : ""}${describe(sl.scene).motion}${i < slots.length - 1 ? "; accent dot appears a beat before the cut and floods the frame" : ""}`,
      })),
      notes: [
        "Every scene is a whole number of bars, so every cut is on a bar line; entrances, presses, drops and counters land on beats.",
        "The UI is redrawn (search bar, cards, value bar, bid button), not screen-recorded. Listing photos, places and prices are real.",
      ],
      stills: stills(spec.id, slots.map((s) => s.start + s.duration * 0.7)),
    },
    print,
  );
}
if (!build) {
  console.log(`\nReview the storyboard above. Once it's approved, build it with:\n  ${cmd} --render\n`);
  process.exit(0);
}
render(spec.id, { quality: flag("--quality") ?? "standard" });
