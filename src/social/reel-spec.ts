// Listing reel spec (reels/<id>.json): a 1080×1920 short built from one listing's photos
// and facts. `npm run social -- reel <listing-url>` writes a starter from the listing data;
// rewrite the copy before building. Photo fields are indexes into `photos`.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Listing } from "./listing.ts";

const base = { id: z.string().regex(/^[a-z0-9-]+$/), narration: z.string() };

const Scene = z.discriminatedUnion("kind", [
  // Frame 0 is the thumbnail: kicker, headline and price are on screen from the first frame.
  z.object({ kind: z.literal("hook"), ...base, photo: z.number().int(), kicker: z.string().optional(), headline: z.string(), priceLabel: z.string().default("STARTS AT"), price: z.string() }),
  // Market estimate struck through, starting bid counts up, then the badge lands.
  z.object({ kind: z.literal("value"), ...base, photo: z.number().int(), estimate: z.number(), price: z.number(), badge: z.string() }),
  // Quick photo cuts with fact chips popping in one by one.
  z.object({ kind: z.literal("tour"), ...base, photos: z.array(z.number().int()).min(1), chips: z.array(z.string()).default([]) }),
  z.object({ kind: z.literal("auction"), ...base, photo: z.number().int(), label: z.string(), date: z.string(), time: z.string().optional() }),
  // Light end card with the logo.
  z.object({ kind: z.literal("cta"), ...base, headline: z.string(), button: z.string(), sub: z.string().optional() }),
]);
export type ReelScene = z.infer<typeof Scene>;

export const ReelSpec = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  listing: z.string().url(),
  brand: z
    .object({
      name: z.string(),
      accent: z.string().default("#0047fb"),
      ground: z.string().default("#060a1c"),
      paper: z.string().default("#f5f7ff"), // end-card background
      highlight: z.string().default("#ffd43b"), // active caption word and the deal badge
      font: z.string().default("Inter"),
      logo: z.string().optional(), // URL or path relative to the spec; dark logo for the light end card
    })
    .default({ name: "Vihara", accent: "#0047fb", ground: "#060a1c", paper: "#f5f7ff", highlight: "#ffd43b", font: "Inter" }),
  voice: z
    .object({ engine: z.enum(["kokoro", "say"]).default("kokoro"), voice: z.string().default("af_heart"), speed: z.number().default(1.08) })
    .default({ engine: "kokoro", voice: "af_heart", speed: 1.08 }),
  music: z.string().optional(),
  musicVolume: z.number().default(0.16),
  captions: z.boolean().default(true),
  photos: z.array(z.string()).min(1),
  scenes: z.array(Scene).min(1),
});
export type ReelSpec = z.infer<typeof ReelSpec>;

export function loadReel(path: string) {
  const spec = ReelSpec.parse(JSON.parse(readFileSync(path, "utf8")));
  const n = spec.photos.length;
  for (const s of spec.scenes) {
    const used = "photos" in s ? s.photos : "photo" in s ? [s.photo] : [];
    for (const i of used) if (i < 0 || i >= n) throw new Error(`scene "${s.id}": photo ${i} is out of range (0–${n - 1})`);
  }
  return { spec, specDir: dirname(resolve(path)) };
}

// ---------- starter copy from listing data ----------

const short = (n: number) => (n >= 1e6 ? `$${Math.floor(n / 1e5) / 10}M` : `$${Math.floor(n / 1e3)}K`);
const full = (n: number) => `$${n.toLocaleString("en-US")}`;
const ZONES: Record<string, string> = {
  "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MT", "America/Los_Angeles": "PT",
};
const ASSET: Record<string, string> = { "Reo Bank Owned": "BANK-OWNED", "Foreclosure Homes": "FORECLOSURE" };

export function starterReel(l: Listing, now = new Date()): ReelSpec {
  const place = `${l.city}, ${l.state}`;
  const home = /multi/i.test(l.propertyType ?? "") ? "multi-family" : /condo/i.test(l.propertyType ?? "") ? "condo" : "home";
  const n = l.photos.length;
  const pick = (i: number) => Math.min(i, n - 1);
  const scenes: ReelScene[] = [];

  const price = l.startBid ?? l.estimate;
  scenes.push({
    kind: "hook",
    id: "hook",
    photo: 0,
    kicker: `${ASSET[l.assetType ?? ""] ?? "AUCTION"} · ${place.toUpperCase()}`,
    headline: l.beds ? (l.beds >= 5 ? `${l.beds} BEDS` : `${l.beds}-BED ${home.toUpperCase()}`) : home.toUpperCase(),
    priceLabel: l.startBid ? "STARTS AT" : "VALUED AT",
    price: price ? short(price) : "",
    narration: `This ${l.beds ? `${l.beds}-bedroom ` : ""}${home} in ${place} ${l.startBid ? "starts at" : "is valued at"} ${price ? short(price) : "a great price"}.`,
  });

  // A small discount is a weak selling point, so the value beat only runs from 10% off.
  const pct = l.estimate && l.startBid ? Math.round((1 - l.startBid / l.estimate) * 100) : 0;
  if (l.estimate && l.startBid && pct >= 10) {
    scenes.push({
      kind: "value",
      id: "value",
      photo: pick(1),
      estimate: l.estimate,
      price: l.startBid,
      badge: `${pct}% BELOW ESTIMATE`,
      narration: `Vihara estimates it's worth ${full(l.estimate)}. That's ${pct}% below value.`,
    });
  }

  const facts = [
    l.beds && `${l.beds} ${l.beds === 1 ? "BED" : "BEDS"}`,
    l.baths && `${l.baths} ${l.baths === 1 ? "BATH" : "BATHS"}`,
    l.sqft && `${l.sqft.toLocaleString("en-US")} SQ FT`,
    l.yearBuilt && `BUILT ${l.yearBuilt}`,
  ].filter((x): x is string => !!x);
  const said = [
    l.beds && `${l.beds} ${l.beds === 1 ? "bed" : "beds"}`,
    l.baths && `${l.baths} ${l.baths === 1 ? "bath" : "baths"}`,
    l.sqft && `${l.sqft.toLocaleString("en-US")} sq ft`,
  ].filter(Boolean);
  scenes.push({
    kind: "tour",
    id: "tour",
    photos: [2, 3, 4, 5].map(pick).filter((v, i, a) => a.indexOf(v) === i),
    chips: facts,
    narration: `${said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : (said[0] ?? "Take a look inside")}${l.yearBuilt ? `, built in ${l.yearBuilt}` : ""}.`,
  });

  const start = l.auctionStart ? new Date(l.auctionStart) : undefined;
  const end = l.auctionEnd ? new Date(l.auctionEnd) : undefined;
  if (start && end && end > now) {
    const tz = l.timezone ?? "America/New_York";
    const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(start);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(start);
    const live = start <= now;
    const spoken = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(start);
    scenes.push({
      kind: "auction",
      id: "auction",
      photo: pick(6),
      label: live ? "BIDDING LIVE NOW" : l.online === false ? "AUCTION" : "ONLINE AUCTION",
      date: date.toUpperCase(),
      time: live ? undefined : `${time} ${ZONES[tz] ?? ""}`.trim(),
      narration: live ? "Bidding is live right now." : `Bidding opens ${l.online === false ? "" : "online "}${spoken}.`,
    });
  }

  scenes.push({ kind: "cta", id: "cta", headline: "Bid from your phone", button: "vihara.ai", sub: "Link in bio", narration: "Bid from your phone on Vihara. Link in bio." });

  return ReelSpec.parse({
    id: l.slug,
    listing: l.url,
    brand: { name: "Vihara", logo: "https://www.vihara.ai/images/vihara-logo.png" },
    music: "../audio/music/wallpaper.mp3",
    photos: l.photos,
    scenes,
  });
}
