// npm run demo -- scout <url> [--id name]      map a site, write demos/<id>.json starter
// npm run demo -- storyboard <spec.json>        plan the film (out/<id>/storyboard.md) for review
// npm run demo -- <step> <spec.json> [--force] [--quality draft|standard|high] [--engine say --voice Samantha]
//   steps: voice | record | compose | check | render | all
//   record and all need a storyboard of this exact spec first (--yes skips that).
// Media options on any step: --music <file|default>, --no-music, --no-voice.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { analyzeMusic, Grid } from "./beats.ts";
import { compose } from "./compose.ts";
import { demoBoard } from "./demo-board.ts";
import { mediaFlags, resolveMusic } from "./media.ts";
import { type Recording, record } from "./record.ts";
import { check, render } from "./render.ts";
import { scout } from "./scout.ts";
import { loadSpec } from "./spec.ts";
import { fingerprint, requireBoard } from "./storyboard.ts";
import { readJson, workDir } from "./util.ts";
import { type VoiceManifest, voice } from "./voice.ts";

const [step, specPath, ...flags] = process.argv.slice(2);
const flag = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);

if (step === "scout") {
  if (!specPath) throw new Error("usage: npm run demo -- scout <url> [--id name]");
  const url = /^https?:|^file:/.test(specPath) ? specPath : `https://${specPath}`;
  const id = flag("--id") ?? (new URL(url).hostname.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9-]/g, "-") || "site");
  await scout(url, id);
  process.exit(0);
}
const steps = ["storyboard", "voice", "record", "compose", "check", "render", "all"];
if (!steps.includes(step) || !specPath) {
  console.error(`usage: npm run demo -- scout <url> [--id name]
       npm run demo -- <${steps.join("|")}> <spec.json> [--force] [--yes] [--quality draft|standard|high]
         [--engine kokoro|say --voice <name>] [--music <file|default> | --no-music] [--no-voice]`);
  process.exit(1);
}
const force = flags.includes("--force");
const quality = flags.includes("--quality") ? flags[flags.indexOf("--quality") + 1] : step === "all" ? "standard" : "draft";

const { spec, specDir } = loadSpec(specPath);
// e.g. --engine say --voice Samantha: try a spec without the Kokoro model download.
if (flag("--engine")) spec.voice.engine = flag("--engine") as "kokoro" | "say";
if (flag("--voice")) spec.voice.voice = flag("--voice")!;
const media = mediaFlags(flags);
if (media.music !== undefined) spec.music = media.music;
if (media.narration !== undefined) spec.narration = media.narration;
const music = resolveMusic(spec.music, specDir);
const grid = new Grid(music ? analyzeMusic(music) : null);
const print = fingerprint(spec, music);
for (const reserved of ["intro", "outro", "main"]) {
  if (spec.scenes.some((s) => s.id === reserved)) throw new Error(`scene id "${reserved}" is reserved`);
}
const { dir } = workDir(spec.id);
const cached = <T>(name: string): T => {
  const p = join(dir, name);
  if (!existsSync(p)) throw new Error(`${name} missing: run the earlier step first`);
  return readJson<T>(p);
};

const vo = () => (["voice", "all", "storyboard"].includes(step) ? voice(spec, { force }) : cached<VoiceManifest>("voice.json"));
if (step === "record" || step === "all") {
  const opts = [media.music === false ? " --no-music" : media.music ? ` --music ${media.music}` : "", media.narration === false ? " --no-voice" : ""].join("");
  requireBoard(spec.id, print, flags.includes("--yes"), `npm run demo -- storyboard ${specPath}${opts}`);
}

if (step === "storyboard") demoBoard(spec, vo(), grid, music, print);
if (step === "voice") vo();
if (step === "record") await record(spec, cached<VoiceManifest>("voice.json"), grid);
if (step === "compose") compose(spec, specDir, cached<VoiceManifest>("voice.json"), cached<Recording>("recording.json"), grid);
if (step === "check") check(spec.id);
if (step === "render") render(spec.id, { quality });
if (step === "all") {
  const v = vo();
  const rec = await record(spec, v, grid);
  compose(spec, specDir, v, rec, grid);
  check(spec.id);
  render(spec.id, { quality });
}
