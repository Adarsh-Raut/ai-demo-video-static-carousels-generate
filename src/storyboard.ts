// Storyboard: before anything is recorded or rendered, write out/<id>/storyboard.md, a
// scene-by-scene plan (time, beat, what's on screen, motion, sound, narration) for the
// user to approve. The build commands refuse to run until a storyboard exists for the exact
// spec being built (or --yes skips the review).
import { createHash } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readJson, round, workDir, writeJson } from "./util.ts";

export type BoardRow = {
  scene: string;
  start: number;
  end: number;
  onScreen: string;
  motion: string;
  sound: string;
  narration?: string;
};

export type Board = {
  id: string;
  kind: string; // "Demo video", "Listing reel", "Carousel"
  format: string; // "1920×1080, 30 fps"
  music: string | null; // track file, or null for none
  bpm?: number;
  narration: boolean;
  rows: BoardRow[];
  notes?: string[];
  stills?: string; // contact sheet path, relative to the storyboard
  timed?: boolean; // false for carousels (slides, not seconds)
};

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const cell = (s = "") => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

// A fingerprint of everything that shapes the output: the parsed spec (after CLI overrides)
// plus the music file itself.
export function fingerprint(spec: unknown, music: string | null) {
  const m = music && existsSync(music) ? `${basename(music)}:${statSync(music).size}` : "none";
  return createHash("sha1").update(JSON.stringify(spec)).update(m).digest("hex").slice(0, 12);
}

export function writeBoard(board: Board, print: string) {
  const { dir } = workDir(board.id);
  const timed = board.timed !== false;
  const vo = timed && board.narration;
  const total = board.rows.at(-1)?.end ?? 0;
  const lines = [
    `# Storyboard: ${board.id}`,
    "",
    `${board.kind} · ${board.format}${timed ? ` · ${round(total, 1)} s` : ` · ${board.rows.length} slides`}`,
    "",
    ...(timed ? [`- **Music:** ${board.music ? `${basename(board.music)}${board.bpm ? `, ${board.bpm} BPM: cuts land on bar lines, entrances and sound accents on beats` : ""}` : "none"}`,
    `- **Narration:** ${board.narration ? "on (Kokoro voiceover)" : "off (music and on-screen text only)"}`] : []),
    ...(board.notes ?? []).map((n) => `- ${n}`),
    "",
    timed ? `| # | Time | Scene | On screen | Motion | Sound |${vo ? " Narration |" : ""}` : "| # | Slide | On screen | Notes |",
    timed ? `|---|---|---|---|---|---|${vo ? "---|" : ""}` : "|---|---|---|---|",
    ...board.rows.map((r, i) =>
      timed
        ? `| ${i + 1} | ${clock(r.start)}–${clock(r.end)} | **${cell(r.scene)}** | ${cell(r.onScreen)} | ${cell(r.motion)} | ${cell(r.sound)} |${vo ? ` ${cell(r.narration ?? "")} |` : ""}`
        : `| ${i + 1} | **${cell(r.scene)}** | ${cell(r.onScreen)} | ${cell(r.motion)} |`,
    ),
    "",
    ...(board.stills ? [`![Stills, one per scene](${board.stills})`, ""] : []),
    "Approve this storyboard, or say what to change, before the video is made.",
    "",
  ];
  const md = join(dir, "storyboard.md");
  writeFileSync(md, lines.join("\n"));
  writeJson(join(dir, "storyboard.json"), { print, at: new Date().toISOString() });
  console.log(`storyboard  → ${md}`);
  return md;
}

// The build gate: a storyboard must exist for exactly this spec, unless --yes.
export function requireBoard(id: string, print: string, yes: boolean, how: string) {
  if (yes) return;
  const p = join(workDir(id).dir, "storyboard.json");
  const ok = existsSync(p) && readJson<{ print: string }>(p).print === print;
  if (ok) return;
  console.error(
    existsSync(p)
      ? `The spec changed since the storyboard was made. Make a new one and review it first:\n  ${how}\n(or pass --yes to build without one)`
      : `No storyboard yet. Make one and review it before building:\n  ${how}\n(or pass --yes to build without one)`,
  );
  process.exit(2);
}
