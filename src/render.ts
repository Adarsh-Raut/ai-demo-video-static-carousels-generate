// Render: HyperFrames check + render, then an FFmpeg loudness pass so every demo lands
// at -14 LUFS / -1 dBTP regardless of how hot the voice, music and SFX files were.
import { join } from "node:path";
import { HF, run, workDir } from "./util.ts";

export function check(id: string) {
  const { project } = workDir(id);
  run(HF, ["check"], { cwd: project });
}

export function render(id: string, { quality = "standard" } = {}) {
  const { dir, project } = workDir(id);
  const raw = join(dir, "raw.mp4");
  const final = join(dir, `${id}.mp4`);
  run(HF, ["render", "-o", raw, "--quality", quality, "--video-frame-format", "png"], { cwd: project });
  run("ffmpeg", [
    "-y", "-v", "error", "-i", raw,
    // loudnorm works at 192 kHz and can overshoot its ceiling; resample to 48 kHz first, then
    // limit, so the AAC file stays at about -1 dBTP (measured -1.1 dBTP at -14 LUFS).
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.71:level=false:attack=1:release=50", "-ar", "48000",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final,
  ]);
  console.log(`render  → ${final}`);
  return final;
}
