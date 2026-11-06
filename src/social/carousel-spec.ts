// Carousel spec (carousels/<id>.json): Instagram slides at 1080×1350 (4:5), rendered to PNG.
// Slides are composable: any mix of cover, listing, term, tip, stat and cta. A "deals"
// starter is built from live auctions; glossary and tips carousels are written by hand
// (or by Claude) from the same slide kinds.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Listing } from "./listing.ts";

const Slide = z.discriminatedUnion("kind", [
  // First slide: the hook. With a photo it sits over the top of a dark slide.
  z.object({ kind: z.literal("cover"), kicker: z.string().optional(), title: z.string(), sub: z.string().optional(), photo: z.string().optional() }),
  z.object({
    kind: z.literal("listing"),
    photo: z.string(),
    place: z.string(), // "CAPITOL HEIGHTS, MD"
    address: z.string(),
    priceLabel: z.string().default("STARTS AT"),
    price: z.string(), // "$126K"
    badge: z.string().optional(), // "18% BELOW ESTIMATE"
    facts: z.array(z.string()).default([]), // ["3 bd", "1 ba", "1,180 sq ft"]
    estimate: z.string().optional(), // "$155,118"
    when: z.string().optional(), // "Online auction · Sun, Nov 15"
  }),
  // Dictionary card: the word, how it sounds, what it means.
  z.object({
    kind: z.literal("term"),
    word: z.string(), // "auc·tion"
    phonetic: z.string().optional(),
    pos: z.string().optional(), // "noun"
    definitions: z.array(z.string()).min(1),
    example: z.string().optional(),
    origin: z.string().optional(),
  }),
  z.object({ kind: z.literal("tip"), n: z.number().int().optional(), title: z.string(), body: z.string() }),
  z.object({ kind: z.literal("stat"), value: z.string(), label: z.string(), body: z.string().optional() }),
  z.object({ kind: z.literal("cta"), title: z.string(), button: z.string(), sub: z.string().optional() }),
]);
export type Slide = z.infer<typeof Slide>;

export const CarouselSpec = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  brand: z
    .object({
      name: z.string(),
      accent: z.string().default("#0047fb"),
      ground: z.string().default("#060a1c"), // dark slides
      paper: z.string().default("#f5f7ff"), // light slides
      cream: z.string().default("#f6f1e7"), // dictionary cards
      highlight: z.string().default("#ffd43b"),
      logo: z.string().optional(), // dark logo; it is turned white on dark slides
      site: z.string().default("vihara.ai"),
    })
    .default({ name: "Vihara", accent: "#0047fb", ground: "#060a1c", paper: "#f5f7ff", cream: "#f6f1e7", highlight: "#ffd43b", site: "vihara.ai" }),
  slides: z.array(Slide).min(1).max(20), // Instagram allows up to 20
});
export type CarouselSpec = z.infer<typeof CarouselSpec>;

export function loadCarousel(path: string) {
  return { spec: CarouselSpec.parse(JSON.parse(readFileSync(path, "utf8"))), specDir: dirname(resolve(path)) };
}

// ---------- deals starter from live auctions ----------

const short = (n: number) => (n >= 1e6 ? `$${Math.floor(n / 1e5) / 10}M` : `$${Math.floor(n / 1e3)}K`);
const full = (n: number) => `$${n.toLocaleString("en-US")}`;
const discount = (l: Listing) => (l.estimate && l.startBid ? 1 - l.startBid / l.estimate : 0);
const ZONES: Record<string, string> = { "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MT", "America/Los_Angeles": "PT" };

export function listingSlide(l: Listing): Slide {
  const tz = l.timezone ?? "America/New_York";
  const start = l.auctionStart ? new Date(l.auctionStart) : undefined;
  const pct = Math.round(discount(l) * 100);
  return {
    kind: "listing",
    photo: l.photos[0],
    place: `${l.city}, ${l.state}`.toUpperCase(),
    address: l.street,
    priceLabel: l.startBid ? "STARTS AT" : "VALUED AT",
    price: short(l.startBid ?? l.estimate ?? 0),
    badge: pct >= 10 ? `${pct}% BELOW ESTIMATE` : undefined,
    facts: [
      l.beds && `${l.beds} bd`,
      l.baths && `${l.baths} ba`,
      l.sqft && `${l.sqft.toLocaleString("en-US")} sq ft`,
      l.yearBuilt && `built ${l.yearBuilt}`,
    ].filter((x): x is string => !!x),
    estimate: l.estimate ? full(l.estimate) : undefined,
    when: start
      ? `${l.online === false ? "Auction" : "Online auction"} · ${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(start)} · ${new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(start)} ${ZONES[tz] ?? ""}`.trim()
      : undefined,
  };
}

// The biggest discounts to Vihara's estimate among auctions that haven't ended yet.
export function dealsCarousel(all: Listing[], { count = 5, under, state, now = new Date() }: { count?: number; under?: number; state?: string; now?: Date } = {}): CarouselSpec {
  const picks = all
    .filter((l) => l.photos.length && l.startBid && (!l.auctionEnd || new Date(l.auctionEnd) > now))
    .filter((l) => !under || (l.startBid ?? Infinity) <= under)
    .filter((l) => !state || l.state.toUpperCase() === state.toUpperCase())
    .sort((a, b) => discount(b) - discount(a))
    .slice(0, count);
  if (!picks.length) throw new Error("no live auctions match those filters");
  const where = state ? ` in ${state.toUpperCase()}` : "";
  const title = under ? `${picks.length} homes under ${short(under)}${where}` : `${picks.length} deals${where} going to auction`;
  const day = now.toISOString().slice(0, 10);
  return CarouselSpec.parse({
    id: `deals-${day}${state ? `-${state.toLowerCase()}` : ""}${under ? `-under-${Math.round(under / 1000)}k` : ""}`,
    brand: { name: "Vihara", logo: "https://www.vihara.ai/images/vihara-logo.png" },
    slides: [
      { kind: "cover", kicker: "THIS WEEK ON VIHARA", title, sub: "Bank-owned homes, ranked by how far they start below our estimate.", photo: (picks[1] ?? picks[0]).photos[0] },
      ...picks.map(listingSlide),
      { kind: "cta", title: "Bid from your phone", button: "vihara.ai", sub: "Link in bio · new auctions every week" },
    ],
  });
}
