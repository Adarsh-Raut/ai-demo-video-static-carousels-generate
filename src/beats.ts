// The beat grid: cuts, entrances and sound accents land on the music's beats.
//
// analyzeMusic() finds the tempo, beats and downbeats of any track (py/beats.py, numpy only)
// and caches the result in out/.beats. The film starts on the track's first downbeat
// (`mediaStart` is that offset into the file), so film time 0 is a downbeat and every scene
// cut can be put on a bar line. Without music, a steady 120 BPM grid keeps the same rhythm.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { readJson, ROOT, round, run } from "./util.ts";

export type BeatMap = { bpm: number; confidence: number; beats: number[]; downbeats: number[] };

const PY = join(ROOT, "py", ".venv", "bin", "python");

export function analyzeMusic(file: string): BeatMap {
  const st = statSync(file);
  const key = createHash("sha1").update(`${basename(file)}:${st.size}:${st.mtimeMs}`).digest("hex").slice(0, 16);
  const dir = join(ROOT, "out", ".beats");
  const cache = join(dir, `${key}.json`);
  if (existsSync(cache)) return readJson<BeatMap>(cache);
  mkdirSync(dir, { recursive: true });
  const raw = join(dir, `${key}.f32`);
  run("ffmpeg", ["-y", "-v", "error", "-i", file, "-ac", "1", "-ar", "22050", "-f", "f32le", raw]);
  try {
    run(existsSync(PY) ? PY : "python3", [join(ROOT, "py", "beats.py"), raw, cache], { quiet: true });
  } finally {
    rmSync(raw, { force: true });
  }
  const map = readJson<BeatMap>(cache);
  console.log(`beats  ${basename(file)}: ${map.bpm} BPM, ${map.beats.length} beats`);
  return map;
}

// Beat and bar times in film seconds.
export class Grid {
  readonly beats: number[];
  readonly bars: number[];
  readonly beat: number; // seconds per beat
  readonly bpm: number;
  readonly mediaStart: number; // offset into the music file that plays at film time 0

  // `start`: play the track from this offset instead of its first detected downbeat (pick a
  // bar line, e.g. when the track has a quiet intro the film should keep). Beats before the
  // first detected one are continued backwards at the tempo.
  constructor(map: BeatMap | null, horizon = 600, start?: number) {
    if (map && start !== undefined && map.downbeats.length >= 2) {
      const beat = 60 / map.bpm;
      const back = (list: number[], step: number) => {
        const out = [...list];
        while (out[0] - step >= start - 0.02) out.unshift(out[0] - step);
        return out;
      };
      map = { ...map, beats: back(map.beats, beat), downbeats: back(map.downbeats, beat * 4) };
      map.downbeats = [start, ...map.downbeats.filter((t) => t > start + 0.05)];
    }
    if (!map || map.downbeats.length < 2) {
      this.bpm = 120;
      this.beat = 0.5;
      this.mediaStart = 0;
      this.beats = Array.from({ length: Math.ceil(horizon / 0.5) }, (_, i) => i * 0.5);
      this.bars = this.beats.filter((_, i) => i % 4 === 0);
      return;
    }
    this.bpm = map.bpm;
    this.beat = 60 / map.bpm;
    this.mediaStart = map.downbeats[0];
    const beats = map.beats.map((t) => t - this.mediaStart).filter((t) => t > -0.02).map((t) => Math.max(0, t));
    const bars = map.downbeats.map((t) => t - this.mediaStart);
    // Past the end of the track (it loops), continue at the tempo.
    while (beats.at(-1)! < horizon) beats.push(beats.at(-1)! + this.beat);
    while (bars.at(-1)! < horizon) bars.push(bars.at(-1)! + this.beat * 4);
    this.beats = beats.map((t) => round(t));
    this.bars = bars.map((t) => round(t));
  }

  get bar() {
    return this.beat * 4;
  }

  // First beat at or after t.
  beatAfter(t: number) {
    return this.beats.find((b) => b >= t - 0.005) ?? t;
  }

  // The beat nearest to t, if it is within `tolerance` seconds; otherwise t itself.
  near(t: number, tolerance = this.beat / 2) {
    let best = t;
    let d = Infinity;
    for (const b of this.beats) {
      if (Math.abs(b - t) < d) {
        d = Math.abs(b - t);
        best = b;
      }
      if (b > t + tolerance) break;
    }
    return d <= tolerance ? best : t;
  }

  // Where a scene that needs to run until t should cut: the next bar line, unless that is
  // more than `maxPad` (about a beat and a half) away, in which case the next beat. On slow
  // tracks waiting for every bar line would pad a reel by seconds.
  cutAfter(t: number, maxPad = Math.max(0.8, this.beat * 1.5)) {
    const bar = this.bars.find((b) => b >= t - 0.005);
    if (bar !== undefined && bar - t <= maxPad) return bar;
    return this.beatAfter(t);
  }

  // Beats inside [from, to), relative to `from` (for timing tweens inside a scene).
  within(from: number, to: number) {
    return this.beats.filter((b) => b >= from - 0.005 && b < to).map((b) => round(b - from));
  }
}

// One shared helper for scene code: snap a scene-local time onto a beat (film time is
// `start + t`), but only when the nearest beat is close, so designed timing is never
// dragged far.
export const snapper = (grid: Grid, start: number) => (t: number, tolerance = 0.3) => round(grid.near(start + t, tolerance) - start);
