// Voiceover: one WAV per beat via HyperFrames' local Kokoro TTS. No API key, no network.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Spec } from "./spec.ts";
import { HF, probeDuration, round, run, workDir, writeJson } from "./util.ts";

export type VoiceManifest = Record<string, { file: string; duration: number } | null>;

export function beats(spec: Spec): { id: string; text?: string }[] {
  return [
    { id: "intro", text: spec.intro.narration },
    ...spec.scenes.map((s) => ({ id: s.id, text: s.narration })),
    { id: "outro", text: spec.outro.narration },
  ];
}

export function voice(spec: Spec, { force = false } = {}): VoiceManifest {
  const { dir, project } = workDir(spec.id);
  const voDir = join(project, "assets", "vo");
  mkdirSync(voDir, { recursive: true });

  const manifest: VoiceManifest = {};
  for (const beat of beats(spec)) {
    if (!beat.text?.trim()) {
      manifest[beat.id] = null;
      continue;
    }
    const file = join(voDir, `${beat.id}.wav`);
    if (force || !existsSync(file)) {
      console.log(`tts  ${beat.id}  (${spec.voice.engine})`);
      if (spec.voice.engine === "say") {
        const aiff = file.replace(/\.wav$/, ".aiff");
        run("say", ["-v", spec.voice.voice, "-r", String(Math.round(185 * spec.voice.speed)), "-o", aiff, beat.text]);
        run("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-ar", "48000", "-ac", "1", file]);
        rmSync(aiff);
      } else {
        run(HF, ["tts", beat.text, "--voice", spec.voice.voice, "--speed", String(spec.voice.speed), "-o", file], {
          quiet: true,
        });
      }
    }
    manifest[beat.id] = { file: `assets/vo/${beat.id}.wav`, duration: round(probeDuration(file)) };
  }
  writeJson(join(dir, "voice.json"), manifest);
  return manifest;
}
