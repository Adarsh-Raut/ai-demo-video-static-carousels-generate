import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");
export const HF = join(ROOT, "node_modules", ".bin", "hyperframes");
// HyperFrames' local Kokoro TTS runs in Python; point it at our venv (see py/requirements.txt).
const VENV_PY = join(ROOT, "py", ".venv", "bin", "python");
if (!process.env.HYPERFRAMES_PYTHON && existsSync(VENV_PY)) process.env.HYPERFRAMES_PYTHON = VENV_PY;

export function workDir(id: string) {
  const dir = join(ROOT, "out", id);
  const project = join(dir, "project");
  mkdirSync(join(project, "assets"), { recursive: true });
  return { dir, project };
}

export function run(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})\n${r.stderr ?? ""}`);
  }
  return r.stdout ?? "";
}

export function probeDuration(file: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return Number.parseFloat(out.trim());
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;
