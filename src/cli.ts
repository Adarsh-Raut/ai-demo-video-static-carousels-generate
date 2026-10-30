// npm run demo -- scout <url> [--id name]      map a site, write demos/<id>.json starter
// npm run demo -- <step> <spec.json> [--force] [--quality draft|standard|high] [--engine say --voice Samantha]
//   steps: voice | record | compose | check | render | all
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compose } from "./compose.ts";
import { type Recording, record } from "./record.ts";
import { check, render } from "./render.ts";
import { scout } from "./scout.ts";
import { loadSpec } from "./spec.ts";
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
const steps = ["voice", "record", "compose", "check", "render", "all"];
if (!steps.includes(step) || !specPath) {
  console.error(`usage: npm run demo -- scout <url> [--id name]
       npm run demo -- <${steps.join("|")}> <spec.json> [--force] [--quality draft|standard|high] [--engine kokoro|say --voice <name>]`);
  process.exit(1);
}
const force = flags.includes("--force");
const quality = flags.includes("--quality") ? flags[flags.indexOf("--quality") + 1] : step === "all" ? "standard" : "draft";

const { spec, specDir } = loadSpec(specPath);
// e.g. --engine say --voice Samantha: try a spec without the Kokoro model download.
if (flag("--engine")) spec.voice.engine = flag("--engine") as "kokoro" | "say";
if (flag("--voice")) spec.voice.voice = flag("--voice")!;
for (const reserved of ["intro", "outro", "main"]) {
  if (spec.scenes.some((s) => s.id === reserved)) throw new Error(`scene id "${reserved}" is reserved`);
}
const { dir } = workDir(spec.id);
const cached = <T>(name: string): T => {
  const p = join(dir, name);
  if (!existsSync(p)) throw new Error(`${name} missing: run the earlier step first`);
  return readJson<T>(p);
};

const vo = () => (step === "voice" || step === "all" ? voice(spec, { force }) : cached<VoiceManifest>("voice.json"));

if (step === "voice") vo();
if (step === "record") await record(spec, cached<VoiceManifest>("voice.json"));
if (step === "compose") compose(spec, specDir, cached<VoiceManifest>("voice.json"), cached<Recording>("recording.json"));
if (step === "check") check(spec.id);
if (step === "render") render(spec.id, { quality });
if (step === "all") {
  const v = vo();
  const rec = await record(spec, v);
  compose(spec, specDir, v, rec);
  check(spec.id);
  render(spec.id, { quality });
}
