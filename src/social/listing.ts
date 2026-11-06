// Listing data from a vihara.ai listing page. The page embeds the full property record
// in its Next.js flight payload; JSON-LD is the fallback when that can't be parsed.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export type Listing = {
  url: string;
  slug: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  lotSqft?: number;
  yearBuilt?: number;
  propertyType?: string;
  assetType?: string; // e.g. "Reo Bank Owned"
  startBid?: number;
  estimate?: number; // Vihara's market estimate
  rent?: number; // estimated monthly rent
  auctionStart?: string; // ISO
  auctionEnd?: string;
  timezone?: string;
  online?: boolean;
  description?: string;
  photos: string[]; // full-size URLs, cover first
};

export async function fetchListing(url: string): Promise<Listing> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const html = await res.text();
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "listing";
  const record = flightRecord(html);
  if (record) return fromRecord(url, slug, record);
  const ld = jsonLd(html);
  if (!ld) throw new Error(`${url}: no listing data found on the page`);
  return fromJsonLd(url, slug, ld);
}

// Property objects are the ones that hold "productName" in the flight payload.
function flightRecords(html: string): Record<string, any>[] {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`));
  const flight = chunks.join("");
  const out: Record<string, any>[] = [];
  for (let at = flight.indexOf('"productName"'); at >= 0; at = flight.indexOf('"productName"', at + 1)) {
    let start = at;
    for (let depth = 0; start > 0; ) {
      const c = flight[--start];
      if (c === "}") depth++;
      else if (c === "{" && depth-- === 0) break;
    }
    let end = start;
    for (let depth = 0; end < flight.length; end++) {
      if (flight[end] === "{") depth++;
      else if (flight[end] === "}" && --depth === 0) break;
    }
    try {
      const r = JSON.parse(flight.slice(start, end + 1));
      if (r.slug && !out.some((x) => x.slug === r.slug)) out.push(r);
    } catch {}
    at = Math.max(at, end);
  }
  return out;
}

const flightRecord = (html: string) => flightRecords(html)[0];

// Every listing on the auctions page, test properties left out.
export async function fetchAuctions(url = "https://www.vihara.ai/auctions"): Promise<Listing[]> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const origin = new URL(url).origin;
  return flightRecords(await res.text())
    .filter((r) => !r.isTestProperty && !r.archived)
    .map((r) => fromRecord(`${origin}/listing/${r.slug}`, r.slug, r));
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

function fromRecord(url: string, slug: string, r: Record<string, any>): Listing {
  const photos = [r.image, ...(r.otherImages ?? [])].filter((p): p is string => typeof p === "string" && !!p);
  return {
    url,
    slug: r.slug ?? slug,
    street: r.street ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zip: r.zipCode ?? "",
    beds: num(r.beds),
    baths: num(r.baths),
    sqft: num(r.squareFootage),
    lotSqft: num(r.lotSize),
    yearBuilt: num(r.yearBuilt),
    propertyType: r.propertyType,
    assetType: r.assetType,
    startBid: num(r.startBid),
    estimate: num(r.investmentData?.valuation?.ViharaValue),
    rent: num(r.investmentData?.rental?.estimatedMonthlyRent) ?? num(r.rentEstimate),
    auctionStart: r.auctionStartDate,
    auctionEnd: r.auctionEndDate,
    timezone: r.auctionTimezone ?? zoneFor(r.state), // the auctions page leaves it out
    online: r.onlineOrInPerson ? r.onlineOrInPerson === "Online" : undefined,
    description: r.propertyDescription,
    photos: [...new Set(photos)],
  };
}

function jsonLd(html: string): Record<string, any> | undefined {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d["@type"] === "RealEstateListing") return d;
    } catch {}
  }
  return undefined;
}

function fromJsonLd(url: string, slug: string, d: Record<string, any>): Listing {
  const a = d.about?.address ?? {};
  const desc: string = d.description ?? "";
  const grab = (re: RegExp) => {
    const m = desc.match(re);
    return m ? Number(m[1].replace(/,/g, "")) : undefined;
  };
  return {
    url,
    slug,
    street: a.streetAddress ?? "",
    city: a.addressLocality ?? "",
    state: a.addressRegion ?? "",
    zip: a.postalCode ?? "",
    beds: grab(/([\d.]+) bed/),
    baths: grab(/([\d.]+) bath/),
    sqft: grab(/([\d,]+) sq ft/),
    startBid: num(d.offers?.price),
    photos: d.image ? [d.image] : [],
  };
}

// Fallback when a record has no timezone: the main zone of the state.
const STATE_ZONES: Record<string, string[]> = {
  "America/Los_Angeles": ["CA", "WA", "OR", "NV"],
  "America/Phoenix": ["AZ"],
  "America/Denver": ["CO", "UT", "NM", "WY", "MT", "ID"],
  "America/Chicago": ["TX", "IL", "LA", "MO", "MN", "WI", "IA", "KS", "OK", "AR", "MS", "AL", "NE", "SD", "ND", "TN"],
  "America/Anchorage": ["AK"],
  "Pacific/Honolulu": ["HI"],
};
function zoneFor(state?: string) {
  const s = (state ?? "").toUpperCase();
  return Object.entries(STATE_ZONES).find(([, states]) => states.includes(s))?.[0] ?? "America/New_York";
}

// Cloudinary serves any size; ask for a sharp JPEG large enough for a 1080×1920 crop.
export function photoUrl(src: string, width = 2000) {
  return src.includes("/image/upload/") ? src.replace("/image/upload/", `/image/upload/c_limit,w_${width},q_auto:good,f_jpg/`) : src;
}
