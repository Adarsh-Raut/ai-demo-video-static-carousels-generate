// npm run setup [-- --kokoro <path/to/kokoro-v1.0.onnx>] [--skip-models]
// One-time machine setup after `npm install`. Safe to re-run: every step checks first.
//   1. FFmpeg present            4. Kokoro model + voices (~355 MB, resumable; or copied from a
//   2. browsers for recording       file you downloaded yourself, also found in ~/Downloads)
//      and rendering             5. smoke test: speak a line, transcribe it (fetches the Whisper
//   3. Python venv for Kokoro       model and runtime on first run, ~150 MB)
// Models live in ~/.cache/hyperframes, outside the repo, and are never committed.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { HF, ROOT } from "./util.ts";

const flags = process.argv.slice(2);
const flag = (name: string) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);

const TTS = join(homedir(), ".cache", "hyperframes", "tts");
const RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
const MODELS = [
  { name: "kokoro-v1.0.onnx", dir: join(TTS, "models"), bytes: 325_532_387 },
  { name: "voices-v1.0.bin", dir: join(TTS, "voices"), bytes: 28_214_398 },
];
const VENV = join(ROOT, "py", ".venv");
const PY = join(VENV, "bin", "python");

const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const step = (msg: string) => console.log(`\n${msg}`);
const fail = (msg: string, fix?: string): never => {
  console.error(`  ✗ ${msg}${fix ? `\n    fix: ${fix}` : ""}`);
  process.exit(1);
};
const sh = (cmd: string, args: string[], opts: { quiet?: boolean; env?: NodeJS.ProcessEnv } = {}) =>
  spawnSync(cmd, args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", env: opts.env ?? process.env });
const has = (cmd: string) => sh("which", [cmd], { quiet: true }).status === 0;
const size = (p: string) => (existsSync(p) ? statSync(p).size : -1);

step("1/5  FFmpeg");
if (Number(process.versions.node.split(".")[0]) < 22) fail(`Node ${process.versions.node} is too old`, "install Node 22 or newer");
for (const c of ["ffmpeg", "ffprobe"]) if (!has(c)) fail(`${c} not found`, "brew install ffmpeg");
ok("ffmpeg and ffprobe");

step("2/5  Browsers");
if (sh("npx", ["playwright", "install", "chromium"]).status !== 0) fail("Playwright Chromium install failed");
ok("Playwright Chromium (site recording)");
if (sh(HF, ["browser", "ensure"], { quiet: true }).status !== 0) fail("HyperFrames Chrome download failed", `${HF} browser ensure --force`);
ok("HyperFrames Chrome (rendering)");

step("3/5  Python environment for the Kokoro voice");
const imports = () => existsSync(PY) && sh(PY, ["-c", "import kokoro_onnx, soundfile"], { quiet: true }).status === 0;
if (imports()) ok("py/.venv already has kokoro-onnx and soundfile");
else {
  const py = ["python3.12", "python3.11", "python3.13", "python3.10", "python3"].find(has);
  if (!py) fail("no python3 found", "brew install python@3.12");
  const v = sh(py!, ["-c", "import sys; print(sys.version_info >= (3, 10))"], { quiet: true }).stdout.trim();
  if (v !== "True") fail(`${py} is older than 3.10`, "brew install python@3.12");
  if (!existsSync(PY) && sh(py!, ["-m", "venv", VENV]).status !== 0) fail("could not create py/.venv");
  const pip = sh(PY, ["-m", "pip", "install", "--timeout", "120", "--retries", "5", "-r", join(ROOT, "py", "requirements.txt")]);
  if (pip.status !== 0 || !imports()) fail("pip install failed", "re-run npm run setup (downloads resume from pip's cache)");
  ok("py/.venv with kokoro-onnx and soundfile");
}

step("4/5  Kokoro model (~355 MB, one time)");
if (flags.includes("--skip-models")) console.log("  - skipped (--skip-models); demos can use --engine say --voice Samantha meanwhile");
else {
  for (const m of MODELS) {
    const target = join(m.dir, m.name);
    mkdirSync(m.dir, { recursive: true });
    if (size(target) === m.bytes) {
      ok(`${m.name} already installed`);
      continue;
    }
    // A copy someone downloaded by hand (slow connection, browser download) is used as is.
    const local = [m.name === "kokoro-v1.0.onnx" ? flag("--kokoro") : flag("--voices"), join(homedir(), "Downloads", m.name)]
      .filter((p): p is string => !!p)
      .find((p) => size(p) === m.bytes);
    if (local) {
      copyFileSync(local, target);
      ok(`${m.name} copied from ${local}`);
      continue;
    }
    const part = `${target}.download`;
    console.log(`  downloading ${m.name} (resumes if interrupted; re-run to continue)`);
    const curl = sh("curl", ["-L", "--fail", "-C", "-", "--retry", "5", "--retry-delay", "3", "--progress-bar", "-o", part, `${RELEASE}/${m.name}`]);
    if (curl.status !== 0 || size(part) !== m.bytes) {
      fail(`${m.name} download incomplete (${Math.max(0, size(part))} of ${m.bytes} bytes)`,
        `re-run npm run setup to resume, or download ${RELEASE}/${m.name} in a browser and run: npm run setup -- ${m.name.startsWith("kokoro") ? "--kokoro" : "--voices"} <file>`);
    }
    renameSync(part, target);
    ok(`${m.name} downloaded`);
  }
}

step("5/5  Smoke test: speak a line, then transcribe it");
if (flags.includes("--skip-models")) console.log("  - skipped (--skip-models)");
else {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"));
  try {
    const env = { ...process.env, HYPERFRAMES_PYTHON: PY };
    const wav = join(tmp, "check.wav");
    if (sh(HF, ["tts", "Setup complete. Ready to make videos.", "-o", wav], { quiet: true, env }).status !== 0 || size(wav) <= 0) {
      fail("Kokoro could not speak", `${HF} tts "hello" -o /tmp/hello.wav  (with HYPERFRAMES_PYTHON=${PY})`);
    }
    ok("Kokoro voice works");
    console.log("  transcribing (first run downloads the Whisper model and runtime, ~150 MB)");
    const tx = sh(HF, ["transcribe", wav, "--model", "base.en", "--dir", tmp], { quiet: true, env });
    if (tx.status !== 0) {
      console.warn("  ! Whisper failed: captions will fall back to estimated word timing. Retry later with npm run setup.");
    } else ok("Whisper word timing works");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\nReady. Try:
  npm run social -- reel https://www.vihara.ai/listing/703-59th-ave-capitol-heights
  npm run demo -- all examples/lumen.json --quality draft`);
