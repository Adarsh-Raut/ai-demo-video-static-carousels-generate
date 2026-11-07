// Storyboards for reels and carousels, written before anything is rendered.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Grid } from "../beats.ts";
import { type BoardRow, writeBoard } from "../storyboard.ts";
import { HF, round, run, workDir } from "../util.ts";
import type { CarouselSpec, Slide } from "./carousel-spec.ts";
import { reelSlots } from "./reel.ts";
import type { ReelScene, ReelSpec } from "./reel-spec.ts";

type VoiceMap = Parameters<typeof reelSlots>[1];

function reelRow(s: ReelScene, D: number, grid: Grid): Pick<BoardRow, "onScreen" | "motion" | "sound"> {
  const perBeat = `${round(grid.beat, 2)} s beats`;
  switch (s.kind) {
    case "hook":
      return {
        onScreen: `photo ${s.photo} in a card; ${s.kicker ? `"${s.kicker}" / ` : ""}"${s.headline}" / ${s.priceLabel} ${s.price}`,
        motion: "card is up from frame 0 (the thumbnail), headline settles, price punches on a beat",
        sound: "impact on the price",
      };
    case "value":
      return {
        onScreen: `photo ${s.photo}; panel: estimate ${s.estimate.toLocaleString("en-US")} struck through, counting down to ${s.price.toLocaleString("en-US")}; badge "${s.badge}"`,
        motion: "card rises in on the cut, strike on a beat, badge stamps on a beat",
        sound: "pop on the strike, impact on the badge",
      };
    case "tour":
      return {
        onScreen: `photos ${s.photos.join(", ")}; chips ${s.chips.map((c) => `"${c}"`).join(", ")}`,
        motion: `photos change on beats (about ${round(D / s.photos.length, 1)} s each); one chip per beat (${perBeat})`,
        sound: "whoosh on each photo change, pop on each chip",
      };
    case "auction":
      return {
        onScreen: `photo ${s.photo}; tile "${s.label}" / ${s.date}${s.time ? ` / ${s.time}` : ""}`,
        motion: "tile grows from the top, date lands on a beat, live dot pulses",
        sound: "pop on the date",
      };
    case "cta":
      return {
        onScreen: `logo / "${s.headline}" / button "${s.button}"${s.sub ? ` / "${s.sub}"` : ""}`,
        motion: "logo and headline rise in on beats, button pops on a beat, light sweep",
        sound: "sparkle, pop on the button, music fades out",
      };
  }
}

// Stills of the composed (not yet rendered) reel: one per scene, at its middle.
export function stills(id: string, times: number[]) {
  const { project, dir } = workDir(id);
  const out = join(dir, "storyboard");
  try {
    run(HF, ["snapshot", "--at", times.map((t) => round(t, 2)).join(","), "--no-end", "-o", out], { cwd: project, quiet: true });
  } catch (e) {
    console.warn(`  ! storyboard stills failed (${(e as Error).message.split("\n")[0]})`);
    return undefined;
  }
  return ["contact-sheet.jpg", "contact-sheet-1.jpg"].map((f) => join("storyboard", f)).find((f) => existsSync(join(dir, f)));
}

export function reelBoard(spec: ReelSpec, vo: VoiceMap, grid: Grid, music: string | null, print: string) {
  const slots = reelSlots(spec, vo, grid);
  const rows: BoardRow[] = slots.map((sl, i) => ({
    scene: `${sl.scene.kind}${sl.scene.id !== sl.scene.kind ? ` (${sl.scene.id})` : ""}`,
    start: sl.start,
    end: round(sl.start + sl.duration),
    ...reelRow(sl.scene, sl.duration, grid),
    sound: `${i ? "whoosh on the cut; " : ""}${reelRow(sl.scene, sl.duration, grid).sound}`,
    narration: spec.narration ? sl.scene.narration : undefined,
  }));
  return writeBoard(
    {
      id: spec.id,
      kind: "Listing reel",
      format: "1080×1920, 30 fps",
      music,
      bpm: music ? grid.bpm : undefined,
      narration: spec.narration,
      rows,
      notes: [
        `Listing: ${spec.listing}`,
        spec.narration && spec.captions ? "Captions: word by word, the spoken word highlighted" : "Captions: none",
        "Each scene's cards leave in the last 0.3 s before its cut, so the next scene arrives on the beat over a clean frame.",
      ],
      stills: stills(spec.id, slots.map((s) => s.start + s.duration / 2)),
    },
    print,
  );
}

function slideRow(s: Slide): Pick<BoardRow, "scene" | "onScreen" | "motion"> {
  switch (s.kind) {
    case "cover": return { scene: "cover", onScreen: `${s.kicker ? `"${s.kicker}" / ` : ""}"${s.title}"${s.sub ? ` / "${s.sub}"` : ""}`, motion: s.photo ? "photo behind" : "" };
    case "listing": return { scene: "listing", onScreen: `${s.place}, ${s.address}: ${s.priceLabel} ${s.price}${s.badge ? `, "${s.badge}"` : ""}; ${s.facts.join(" · ")}`, motion: [s.estimate && `estimate ${s.estimate}`, s.when].filter(Boolean).join("; ") };
    case "term": return { scene: "term", onScreen: `"${s.word}" (${s.pos ?? ""}): ${s.definitions.join(" ")}`, motion: s.example ?? "" };
    case "tip": return { scene: `tip${s.n ? ` ${s.n}` : ""}`, onScreen: `"${s.title}": ${s.body}`, motion: "" };
    case "stat": return { scene: "stat", onScreen: `${s.value}: ${s.label}`, motion: s.body ?? "" };
    case "cta": return { scene: "cta", onScreen: `"${s.title}" / button "${s.button}"`, motion: s.sub ?? "" };
  }
}

export function carouselBoard(spec: CarouselSpec, print: string) {
  return writeBoard(
    {
      id: spec.id,
      kind: "Carousel",
      format: "1080×1350 PNG slides + PDF",
      music: null,
      narration: false,
      timed: false,
      rows: spec.slides.map((s) => ({ ...slideRow(s), start: 0, end: 0, sound: "" })),
      notes: ["Static slides: no music or narration."],
    },
    print,
  );
}
