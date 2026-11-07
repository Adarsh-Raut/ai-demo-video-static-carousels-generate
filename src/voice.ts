// Voiceover: one WAV per beat via HyperFrames' local Kokoro TTS. No API key, no network.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Spec } from "./spec.ts";
import { HF, probeDuration, readJson, round, run, workDir, writeJson } from "./util.ts";

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
    if (!spec.narration || !beat.text?.trim()) {
      manifest[beat.id] = null;
      continue;
    }
    const file = join(voDir, `${beat.id}.wav`);
    if (force || !existsSync(file)) {
      console.log(`tts  ${beat.id}  (${spec.voice.engine})`);
      speak(beat.text, file, spec.voice);
    }
    manifest[beat.id] = { file: `assets/vo/${beat.id}.wav`, duration: round(probeDuration(file)) };
  }
  writeJson(join(dir, "voice.json"), manifest);
  return manifest;
}

// One line of speech to a WAV: Kokoro through HyperFrames, or macOS `say`.
export function speak(text: string, file: string, v: Spec["voice"]) {
  text = forSpeech(text);
  if (v.engine === "say") {
    const aiff = file.replace(/\.wav$/, ".aiff");
    run("say", ["-v", v.voice, "-r", String(Math.round(185 * v.speed)), "-o", aiff, text]);
    run("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-ar", "48000", "-ac", "1", file]);
    rmSync(aiff);
  } else {
    run(HF, ["tts", text, "--voice", v.voice, "--speed", String(v.speed), "-o", file], { quiet: true });
  }
}

export type Word = { text: string; start: number; end: number };

// Word timings for a line we already know the text of. Local Whisper (base.en, a one-time
// ~150 MB download) supplies the timing; the words shown are always the script's own, since
// Whisper misspells names. If the counts disagree, time is shared out by word length.
export function wordTimings(file: string, text: string, duration: number): Word[] {
  const script = text.split(/\s+/).filter(Boolean);
  let heard: Word[] = [];
  const tmp = mkdtempSync(join(tmpdir(), "words-"));
  try {
    run(HF, ["transcribe", file, "--model", "base.en", "--dir", tmp], { quiet: true });
    const t = readJson<{ text: string; start: number; end: number }[] | { words: Word[] }>(join(tmp, "transcript.json"));
    heard = Array.isArray(t) ? t : t.words;
  } catch (e) {
    console.warn(`  ! word timing fell back to estimates (${(e as Error).message.split("\n")[0]})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (heard.length === script.length) return script.map((w, i) => ({ text: w, start: heard[i].start, end: heard[i].end }));
  const from = heard[0]?.start ?? 0.05;
  const to = heard.at(-1)?.end ?? duration - 0.05;
  const weight = script.map((w) => w.length + 2);
  const total = weight.reduce((a, b) => a + b, 0);
  let t = from;
  return script.map((w, i) => {
    const d = ((to - from) * weight[i]) / total;
    const word = { text: w, start: round(t), end: round(t + d) };
    t += d;
    return word;
  });
}

// Written forms TTS reads badly, rewritten as words: "$126K" → "one hundred twenty-six
// thousand dollars", "$155,118" → "one hundred fifty-five thousand dollars" (rounded),
// "1.5 baths" → "one and a half baths", "sq ft" → "square feet", "D.C." → "D C".
export function forSpeech(text: string) {
  return text
    .replace(/\$(\d+(?:\.\d+)?)\s?([KkMm])\b/g, (_, n, u) => `${money(Number(n) * (/k/i.test(u) ? 1e3 : 1e6))} dollars`)
    .replace(/\$(\d{1,3}(?:,\d{3})+|\d+)/g, (_, n) => `${money(Number(n.replace(/,/g, "")))} dollars`)
    .replace(/\b(\d+)\.5\b/g, (_, n) => `${n === "0" ? "a half" : `${words(Number(n))} and a half`}`)
    .replace(/\bsq\.? ?ft\b/gi, "square feet")
    .replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, n) => words(Number(n.replace(/,/g, ""))))
    .replace(/(\d)%/g, "$1 percent")
    .replace(/\bD\.C\./g, "D C");
}

// Prices are spoken to two significant figures above a thousand: nobody says the dollars.
function money(n: number) {
  if (n >= 1e6) {
    const m = Math.round(n / 1e5) / 10;
    return `${Number.isInteger(m) ? words(m) : `${words(Math.floor(m))} point ${words(Math.round((m % 1) * 10))}`} million`;
  }
  if (n >= 1e3) return `${words(Math.round(n / 1e3))} thousand`;
  return words(Math.round(n));
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${words(n % 100)}` : ""}`;
  if (n < 1e6) return `${words(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${words(n % 1000)}` : ""}`;
  return `${words(Math.floor(n / 1e6))} million${n % 1e6 ? ` ${words(n % 1e6)}` : ""}`;
}
