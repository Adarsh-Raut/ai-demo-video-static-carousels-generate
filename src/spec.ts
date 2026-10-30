// The demo spec: one JSON file per video. Claude writes it from the site + script,
// the pipeline turns it into voiceover, a recording and a HyperFrames project.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

// Pointer actions share: zoom (camera punch-in, default 1.45, 1 = none), callout (a short
// bubble pointing at the element) and spotlight (dim everything else; default on for
// click/type and whenever there's a callout).
const pointer = {
  selector: z.string(),
  zoom: z.number().optional(),
  callout: z.string().optional(),
  spotlight: z.boolean().optional(),
};
const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), url: z.string() }),
  z.object({ type: z.literal("click"), ...pointer }),
  z.object({ type: z.literal("hover"), ...pointer, hold: z.number().default(1.2) }),
  z.object({ type: z.literal("type"), ...pointer, text: z.string() }),
  z.object({ type: z.literal("scroll"), y: z.number(), duration: z.number().default(1.4) }),
  // offset: where the element lands, as a fraction of viewport height from the top.
  z.object({ type: z.literal("scrollTo"), selector: z.string(), duration: z.number().default(1.4), offset: z.number().default(0.15) }),
  z.object({ type: z.literal("wait"), seconds: z.number() }),
]);
export type Action = z.infer<typeof Action>;

const Scene = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  narration: z.string(),
  // Short on-screen label for the scene (lower third). Optional.
  title: z.string().optional(),
  actions: z.array(Action).default([]),
});
export type Scene = z.infer<typeof Scene>;

export const Spec = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  url: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }).default({ width: 1440, height: 900 }),
  // Extra CSS selectors to hide while recording (chat widgets, promo bars). Common cookie
  // banners and chat launchers are handled already.
  hide: z.array(z.string()).default([]),
  // Browser frame around the recording: match the site (scout picks it from the page background).
  chrome: z.enum(["light", "dark"]).default("light"),
  brand: z
    .object({
      name: z.string(),
      accent: z.string().default("#6d5efc"),
      ground: z.string().default("#0b0b12"),
      ink: z.string().default("#ffffff"),
      font: z.string().default("Inter"),
    })
    .default({ name: "", accent: "#6d5efc", ground: "#0b0b12", ink: "#ffffff", font: "Inter" }),
  // kokoro: HyperFrames' local Kokoro-82M (best quality, one-time ~340 MB model download).
  // say: macOS built-in voices, zero setup; voice is a `say -v '?'` name such as "Samantha".
  voice: z
    .object({ engine: z.enum(["kokoro", "say"]).default("kokoro"), voice: z.string().default("af_heart"), speed: z.number().default(1) })
    .default({ engine: "kokoro", voice: "af_heart", speed: 1 }),
  // Path (relative to the spec) to a music file. Omit for no music bed.
  music: z.string().optional(),
  musicVolume: z.number().default(0.14),
  intro: z.object({ headline: z.string(), sub: z.string().optional(), narration: z.string().optional() }),
  outro: z.object({ headline: z.string(), cta: z.string().optional(), narration: z.string().optional() }),
  scenes: z.array(Scene).min(1),
});
export type Spec = z.infer<typeof Spec>;

export function loadSpec(path: string): { spec: Spec; specDir: string } {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const specDir = dirname(resolve(path));
  // "file://./site/index.html" is relative to the spec, handy for local test sites.
  const local = (u: string) => (u.startsWith("file://.") ? `file://${resolve(specDir, u.slice(7))}` : u);
  const spec = Spec.parse(raw);
  spec.url = local(spec.url);
  for (const s of spec.scenes) for (const a of s.actions) if (a.type === "goto") a.url = local(a.url);
  return { spec, specDir };
}
