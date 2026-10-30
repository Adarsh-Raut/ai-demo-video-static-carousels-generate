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
    "-af", "loudnorm=I=-14:TP=-1:LRA=11",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final,
  ]);
  console.log(`render  → ${final}`);
  return final;
}
