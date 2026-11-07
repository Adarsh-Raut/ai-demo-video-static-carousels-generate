// Shared HyperFrames pieces: GSAP, escaping, the music bed and sound-effect placement from audio/sfx.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { probeDuration, ROOT, round } from "./util.ts";

export const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type SfxKind = "click" | "whoosh" | "typing" | "pop" | "impact" | "sparkle";
const SFX_KINDS: SfxKind[] = ["click", "whoosh", "typing", "pop", "impact", "sparkle"];
// Seconds from file start to the loudest sample, measured on the files in audio/sfx.
const PEAK: Record<SfxKind, number> = { click: 0.073, whoosh: 0.162, typing: 0, pop: 0.12, impact: 0.073, sparkle: 0.025 };
const LANE: Record<SfxKind, number> = { click: 12, whoosh: 13, pop: 14, typing: 15, impact: 16, sparkle: 17 };

type Take = { src: string; duration: number };

// Copies audio/sfx into the project and places effects so each one's peak lands one
// frame after its picture (light before sound). Takes rotate per kind so repeats differ.
export class Sfx {
  readonly tags: string[] = [];
  private takes: Record<SfxKind, Take[]> = { click: [], whoosh: [], typing: [], pop: [], impact: [], sparkle: [] };
  private used: Record<SfxKind, number> = { click: 0, whoosh: 0, typing: 0, pop: 0, impact: 0, sparkle: 0 };

  constructor(project: string) {
    const lib = join(ROOT, "audio", "sfx");
    if (!existsSync(lib)) return;
    mkdirSync(join(project, "assets", "sfx"), { recursive: true });
    for (const f of readdirSync(lib).sort()) {
      const kind = SFX_KINDS.find((k) => f.startsWith(k));
      if (!kind || !/\.(wav|mp3|ogg|flac)$/.test(f)) continue;
      copyFileSync(join(lib, f), join(project, "assets", "sfx", f));
      this.takes[kind].push({ src: `assets/sfx/${f}`, duration: round(probeDuration(join(lib, f))) });
    }
  }

  place(kind: SfxKind, picture: number, volume: number, duration?: number) {
    const takes = this.takes[kind];
    const at = picture + 1 / 30 - PEAK[kind];
    if (!takes.length || at < 0) return;
    const n = this.used[kind]++;
    const take = takes[n % takes.length];
    const dur = round(Math.min(duration ?? take.duration, take.duration));
    const fade = duration ? ` data-fade-out="0.12"` : "";
    this.tags.push(`<audio id="sfx-${kind}-${n}" data-start="${round(at)}" data-duration="${dur}" data-track-index="${LANE[kind]}" data-volume="${volume}"${fade} src="${take.src}"></audio>`);
  }
}

// ---------- music ----------

// Every video gets music unless asked not to: "default" (the bundled bed, see
// audio/music/CREDITS.md), a path to your own track (relative to the spec), or false.
export const DEFAULT_MUSIC = join(ROOT, "audio", "music", "wallpaper.mp3");
export const MusicChoice = z.union([z.string(), z.literal(false)]).default("default");
export type MusicChoice = z.infer<typeof MusicChoice>;

export function resolveMusic(music: MusicChoice | undefined, specDir: string): string | null {
  if (music === false || music === "none") return null;
  const file = !music || music === "default" ? DEFAULT_MUSIC : resolve(specDir, music);
  if (!existsSync(file)) throw new Error(`music file not found: ${file}`);
  return file;
}

// CLI overrides shared by every command: --music <file|default>, --no-music, --no-voice.
export function mediaFlags(flags: string[], cwd = process.cwd()) {
  const i = flags.indexOf("--music");
  return {
    music: flags.includes("--no-music") ? (false as const) : i >= 0 ? (flags[i + 1] === "default" ? "default" : resolve(cwd, flags[i + 1])) : undefined,
    narration: flags.includes("--no-voice") ? false : undefined,
  };
}

// Under a voiceover the bed sits low; on its own it carries the film.
export const musicVolume = (base: number, narration: boolean) => (narration ? base : Math.max(base, 0.5));

// Copies the track into the project and returns its <audio> tag. It starts at the track's
// first downbeat (mediaStart), so film time 0 is on the beat.
export function musicTag(file: string, project: string, o: { total: number; volume: number; mediaStart: number; fadeIn?: number; fadeOut?: number }) {
  mkdirSync(join(project, "assets", "music"), { recursive: true });
  copyFileSync(file, join(project, "assets", "music", basename(file)));
  const trim = o.mediaStart > 0 ? ` data-media-start="${round(o.mediaStart)}"` : "";
  return `<audio id="music" data-timeline-role="music" data-start="0" data-duration="${o.total}"${trim} data-track-index="11" data-volume="${o.volume}" data-fade-in="${o.fadeIn ?? 0.05}" data-fade-out="${o.fadeOut ?? 1.5}" loop src="assets/music/${basename(file)}"></audio>`;
}
