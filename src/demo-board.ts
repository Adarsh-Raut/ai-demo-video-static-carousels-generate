// The demo video's storyboard, made before recording: scene lengths are estimated from the
// narration and the actions at the recorder's own pacing, then put on the beat grid the
// same way the recorder will.
import type { Grid } from "./beats.ts";
import { seamsFor } from "./compose.ts";
import { estimateScene, introLength, outroLength } from "./record.ts";
import type { Action, Spec } from "./spec.ts";
import { type BoardRow, writeBoard } from "./storyboard.ts";
import { round } from "./util.ts";
import type { VoiceManifest } from "./voice.ts";

const SEAM_WORDS = { tilt: "swings in in 3D", whip: "whips in sideways", zoom: "zooms in", blur: "sharpens in" };
const SEAM_OUT = { tilt: "swings out", whip: "whips out", zoom: "pulls back and blurs out", blur: "blurs out" };

function describe(a: Action) {
  // A readable name for a selector: its text or aria-label when it has one.
  const where = (sel: string, fallback: string) => {
    const text = sel.match(/has-text\(["']([^"']+)["']\)/)?.[1] ?? sel.match(/aria-label\*?=["']?([^"'\]]+)/)?.[1];
    return text ? `"${text}"` : fallback;
  };
  switch (a.type) {
    case "click": return `clicks ${a.callout ? `"${a.callout}"` : where(a.selector, "a button")}`;
    case "type": return `types "${a.text}"${a.callout ? ` (callout "${a.callout}")` : ""}`;
    case "hover": return `points at ${a.callout ? `"${a.callout}"` : where(a.selector, "an element")}`;
    case "scroll": return `scrolls ${a.y > 0 ? "down" : "up"}`;
    case "scrollTo": return `scrolls to ${where(a.selector, "the next section")}`;
    case "goto": return `opens ${a.url.replace(/^https?:\/\//, "")}`;
    case "wait": return "";
  }
}

export function demoBoard(spec: Spec, vo: VoiceManifest, grid: Grid, music: string | null, print: string) {
  const rows: BoardRow[] = [];
  let t = introLength(vo, grid);
  rows.push({
    scene: "Intro",
    start: 0,
    end: t,
    onScreen: `"${spec.intro.headline}"${spec.intro.sub ? ` / ${spec.intro.sub}` : ""}`,
    motion: "headline lands one word per beat, slow push-in, blurs out before the cut",
    sound: music ? "music from its first downbeat" : "",
    narration: spec.narration ? spec.intro.narration : undefined,
  });
  spec.scenes.forEach((s, i) => {
    const est = estimateScene(s.actions, s.id, vo, grid.beat);
    const end = grid.cutAfter(t + est);
    const acts = s.actions.map(describe).filter(Boolean);
    const { enter, exit } = seamsFor(i, spec.scenes.length);
    const presses = s.actions.some((a) => a.type === "click" || a.type === "type");
    rows.push({
      scene: s.title ?? s.id,
      start: round(t),
      end,
      onScreen: `${s.title ? `label "${s.title}"; ` : ""}the live site ${acts.length ? acts.join(", then ") : "holds"}`,
      motion: `${SEAM_WORDS[enter]} on the cut${presses ? "; camera punches in on each press" : ""}; ${SEAM_OUT[exit]} before the next cut`,
      sound: `whoosh on the cut${presses ? ", clicks on the beat" : ""}${s.actions.some((a) => a.type === "type") ? ", typing" : ""}`,
      narration: spec.narration ? s.narration : undefined,
    });
    t = end;
  });
  const outro = outroLength(t, vo, grid);
  rows.push({
    scene: "Outro",
    start: round(t),
    end: round(t + outro),
    onScreen: `"${spec.outro.headline}"${spec.outro.cta ? ` + button "${spec.outro.cta}"` : ""} + site address`,
    motion: "headline in on the cut, button pops on the next beat, light sweep",
    sound: music ? "whoosh on the cut, music fades out on the last bar" : "whoosh on the cut",
    narration: spec.narration ? spec.outro.narration : undefined,
  });
  return writeBoard(
    {
      id: spec.id,
      kind: "Demo video",
      format: "1920×1080, 30 fps",
      music,
      bpm: music ? grid.bpm : undefined,
      narration: spec.narration,
      rows,
      notes: ["Times are estimates until the site is recorded: each scene is recorded live, then run on to the next bar line, so cuts stay on the beat.", `Site: ${spec.url}`],
    },
    print,
  );
}
