// Motion video spec (motion/<id>.json): a launch-style film built from the product's UI,
// redrawn and animated (not screen-recorded), one short headline per scene, every scene a
// whole number of bars of the music. Scenes are joined by the accent-dot flood transition.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { MusicChoice } from "../media.ts";

const Card = z.object({
  photo: z.string(), // image URL or path relative to the spec
  place: z.string(), // "Capitol Heights, MD"
  facts: z.string(), // "3 bd · 1 ba · 1,180 sq ft"
  label: z.string().default("Starts at"),
  price: z.string(), // "$126,753"
});

const base = { id: z.string().regex(/^[a-z0-9-]+$/), bars: z.number().int().min(1).default(2) };

const Scene = z.discriminatedUnion("kind", [
  // Short lines, one per beat, each replacing the last ("No USB." "No terminal." ...).
  z.object({ ...base, kind: z.literal("lines"), lines: z.array(z.string()).min(1).max(8) }),
  // The logo lands on the downbeat, tagline on the next beat.
  z.object({ ...base, kind: z.literal("logo"), tagline: z.string().optional() }),
  // Headline + search bar that types the query, then result cards drop in on beats.
  z.object({ ...base, kind: z.literal("search"), headline: z.string(), query: z.string(), cards: z.array(Card).min(1).max(3) }),
  // Headline + rolling number + a bar: the estimate, with the starting bid's share dragged in.
  z.object({
    ...base,
    kind: z.literal("value"),
    headline: z.string(),
    estimate: z.number(),
    price: z.number(),
    estimateLabel: z.string().default("Vihara estimate"),
    priceLabel: z.string().default("Starting bid"),
    badge: z.string(),
  }),
  // Headline + current bid + a button the cursor clicks on the beat, the bid ticks up, a toast.
  z.object({
    ...base,
    kind: z.literal("bid"),
    headline: z.string(),
    label: z.string().default("Current bid"),
    from: z.number(),
    to: z.number(),
    button: z.string().default("Place bid"),
    toast: z.string().default("Bid placed."),
    ends: z.number().default(8071), // countdown seconds shown ("Ends in 02:14:31"), illustrative
  }),
  // Headline + checklist rows, one per beat.
  z.object({ ...base, kind: z.literal("checks"), headline: z.string(), items: z.array(z.string()).min(1).max(5) }),
  // A ball hops card to card, one landing per listed beat (put them on the track's hop
  // sounds); the card it lands on dips and lights up, the rest dim. Headlines swap on beats.
  z.object({
    ...base,
    kind: z.literal("hop"),
    headlines: z.array(z.object({ text: z.string(), beat: z.number().int().min(0) })).min(1),
    cards: z.array(Card).min(2).max(4),
    hops: z.array(z.object({ beat: z.number().int().min(0), card: z.number().int().min(0) })).min(1),
  }),
  // Full accent background, one big word or short line per step.
  z.object({ ...base, kind: z.literal("flood"), words: z.array(z.string()).min(1).max(4) }),
  // End card: logo, headline, URL, small print. Held to the end.
  z.object({ ...base, kind: z.literal("end"), headline: z.string(), url: z.string(), sub: z.string().optional() }),
]);
export type MotionScene = z.infer<typeof Scene>;

export const MotionSpec = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  // landscape 1920×1080, or vertical 1080×1920 for Reels / Shorts / TikTok (key content kept
  // between ~250 and ~1500 px and clear of the right-hand action rail).
  format: z.enum(["landscape", "vertical"]).default("landscape"),
  brand: z
    .object({
      name: z.string(),
      accent: z.string().default("#0c4bea"), // the flood transition, numbers, highlights
      ink: z.string().default("#111827"),
      muted: z.string().default("#6b7280"),
      paper: z.string().default("#ffffff"),
      font: z.string().default("Inter"),
      logo: z.string().optional(), // dark logo for white scenes
    })
    .default({ name: "Vihara", accent: "#0c4bea", ink: "#111827", muted: "#6b7280", paper: "#ffffff", font: "Inter" }),
  music: MusicChoice,
  // Seconds into the track the film starts at (a bar line). Omit to start on its first
  // detected downbeat.
  musicOffset: z.number().optional(),
  musicVolume: z.number().default(0.9),
  sfx: z.boolean().default(true), // our UI sounds on top of the music (pops, clicks, typing)
  tail: z.number().default(0.8), // seconds the end card holds past the last bar line
  scenes: z.array(Scene).min(1),
});
export type MotionSpec = z.infer<typeof MotionSpec>;

export function loadMotion(path: string) {
  return { spec: MotionSpec.parse(JSON.parse(readFileSync(path, "utf8"))), specDir: dirname(resolve(path)) };
}
