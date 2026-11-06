// Carousel: spec → one HTML page per slide → 1080×1350 PNGs (Instagram) plus a PDF of the
// whole set (LinkedIn document posts). Plain HTML and CSS screenshotted with Playwright;
// fonts come from npm (@fontsource), so rendering needs no network apart from photos.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { esc } from "../media.ts";
import { ROOT, run } from "../util.ts";
import type { CarouselSpec, Slide } from "./carousel-spec.ts";
import { photoUrl } from "./listing.ts";

const W = 1080;
const H = 1350;
const PAD = 72;
const INK = "#0b0d17";
const FONTS = {
  inter: join(ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
  serif: join(ROOT, "node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2"),
  serifItalic: join(ROOT, "node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-italic.woff2"),
};

export async function renderCarousel(spec: CarouselSpec, specDir: string) {
  const dir = join(ROOT, "out", spec.id);
  const pages = join(dir, "slides");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(pages, "assets"), { recursive: true });

  // Photos and the logo are fetched once into the slide folder.
  const local = new Map<string, string>();
  const fetchTo = async (src: string, name: string) => {
    if (local.has(src)) return local.get(src)!;
    const file = join(pages, "assets", name);
    if (/^https?:/.test(src)) {
      const res = await fetch(src.includes("/image/upload/") ? photoUrl(src, 1600) : src);
      if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } else copyFileSync(resolve(specDir, src), file);
    local.set(src, `assets/${name}`);
    return `assets/${name}`;
  };
  const logo = spec.brand.logo ? await fetchTo(spec.brand.logo, "logo.png") : undefined;
  const photos: Record<number, string> = {};
  for (const [i, s] of spec.slides.entries()) if ("photo" in s && s.photo) photos[i] = await fetchTo(s.photo, `photo-${i}.jpg`);

  const n = spec.slides.length;
  const bodies = spec.slides.map((s, i) => slideHtml(spec, s, { i, n, photo: photos[i], logo }));
  bodies.forEach((body, i) => writeFileSync(join(pages, `${pad(i + 1)}.html`), page(spec, [body])));
  writeFileSync(join(pages, "all.html"), page(spec, bodies, true));

  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const ready = `document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))`;
    for (let i = 0; i < n; i++) {
      await tab.goto(pathToFileURL(join(pages, `${pad(i + 1)}.html`)).href);
      await tab.evaluate(ready);
      await tab.screenshot({ path: join(dir, `${pad(i + 1)}.png`) });
    }
    await tab.goto(pathToFileURL(join(pages, "all.html")).href);
    await tab.evaluate(ready);
    await tab.pdf({ path: join(dir, `${spec.id}.pdf`), width: `${W}px`, height: `${H}px`, printBackground: true });
  } finally {
    await browser.close();
  }
  // A one-image overview for review.
  const cols = Math.min(n, 4);
  run("ffmpeg", ["-y", "-v", "error", "-framerate", "1", "-i", join(dir, "%02d.png"), "-vf",
    `scale=360:450,pad=376:466:8:8:white,tile=${cols}x${Math.ceil(n / cols)}:color=white`, "-frames:v", "1", join(dir, "overview.jpg")]);
  console.log(`carousel  ${n} slides → ${dir}  (01.png…${pad(n)}.png, ${spec.id}.pdf, overview.jpg)`);
  return dir;
}

const pad = (i: number) => String(i).padStart(2, "0");
// Headings never break inside a hyphenated word ("first-time").
const keep = (text: string) => esc(text).replace(/\S*-\S*/g, (w) => `<span class="nb">${w}</span>`);

// The largest size (up to max) at which text fits in `lines` lines of `width`, at about k em per character.
function fit(text: string, width: number, max: number, lines = 1, k = 0.56) {
  for (let size = max; size > 20; size -= 2) {
    const perLine = Math.floor(width / (size * k));
    const words = text.split(/\s+/);
    let used = 1;
    let len = 0;
    for (const w of words) {
      if (w.length > perLine) {
        used = Infinity;
        break;
      }
      if (len && len + 1 + w.length > perLine) {
        used++;
        len = w.length;
      } else len += (len ? 1 : 0) + w.length;
    }
    if (used <= lines) return size;
  }
  return 20;
}

type Ctx = { i: number; n: number; photo?: string; logo?: string };

function slideHtml(spec: CarouselSpec, s: Slide, c: Ctx): string {
  const { brand } = spec;
  const count = (dark: boolean) => (c.i > 0 ? `<div class="count ${dark ? "on-dark" : ""}">${c.i + 1}/${c.n}</div>` : "");
  const foot = (dark: boolean, right = esc(brand.site)) =>
    `<div class="foot ${dark ? "on-dark" : ""}">${c.logo ? `<img class="mark ${dark ? "white" : ""}" src="${c.logo}" alt="${esc(brand.name)}">` : `<b>${esc(brand.name)}</b>`}<span>${right}</span></div>`;

  switch (s.kind) {
    case "cover":
      return `<section class="slide dark">
        ${c.photo ? `<img class="cover-photo" src="${c.photo}" alt=""><div class="cover-fade"></div>` : `<div class="orb" style="left:-240px; top:-200px"></div><div class="orb" style="left:520px; top:760px"></div>`}
        <div class="cover-text">
          ${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ""}
          <h1 style="font-size:${fit(s.title, W - 2 * PAD, 112, 3)}px">${keep(s.title)}</h1>
          ${s.sub ? `<p class="cover-sub">${esc(s.sub)}</p>` : ""}
        </div>
        ${foot(true, `Swipe <span class="arrow">→</span>`)}
      </section>`;

    case "listing":
      return `<section class="slide light">
        <img class="listing-photo" src="${c.photo}" alt="">
        ${s.badge ? `<div class="badge">${esc(s.badge)}</div>` : ""}
        ${count(true)}
        <div class="pricebox"><span>${esc(s.priceLabel)}</span><b>${esc(s.price)}</b></div>
        <div class="listing-text">
          <div class="place">${esc(s.place)}</div>
          <h2 style="font-size:${fit(s.address, W - 2 * PAD, 64, 1, 0.6)}px">${esc(s.address)}</h2>
          ${s.facts.length ? `<div class="facts">${s.facts.map(esc).join('<i>·</i>')}</div>` : ""}
          <div class="rows">
            ${s.estimate ? `<div class="row"><span>${esc(brand.name)} estimate</span><b>${esc(s.estimate)}</b></div>` : ""}
            ${s.when ? `<div class="row"><span>Auction</span><b>${esc(s.when.replace(/^Online auction · |^Auction · /, ""))}</b></div>` : ""}
          </div>
        </div>
        ${foot(false)}
      </section>`;

    case "term":
      return `<section class="slide cream">
        ${count(false)}
        <div class="term">
          <h2 class="word" style="font-size:${fit(s.word, W - 2 * PAD, 170, 1, 0.52)}px">${esc(s.word)}</h2>
          ${s.phonetic || s.pos ? `<div class="say">${s.phonetic ? esc(s.phonetic) : ""}${s.pos ? ` <em>${esc(s.pos)}</em>` : ""}</div>` : ""}
          <hr>
          <ol>${s.definitions.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>
          ${s.example ? `<blockquote>${esc(s.example)}</blockquote>` : ""}
          ${s.origin ? `<div class="origin">${esc(s.origin)}</div>` : ""}
        </div>
        ${foot(false)}
      </section>`;

    case "tip":
      return `<section class="slide light">
        ${count(false)}
        <div class="tip">
          ${s.n !== undefined ? `<div class="num">${pad(s.n)}</div>` : ""}
          <h2 style="font-size:${fit(s.title, W - 2 * PAD, 80, 3, 0.58)}px">${keep(s.title)}</h2>
          <p>${esc(s.body)}</p>
        </div>
        ${foot(false)}
      </section>`;

    case "stat":
      return `<section class="slide dark">
        <div class="orb" style="left:420px; top:-260px"></div>
        ${count(true)}
        <div class="stat">
          <div class="value" style="font-size:${fit(s.value, W - 2 * PAD, 260, 1, 0.62)}px">${esc(s.value)}</div>
          <h2>${keep(s.label)}</h2>
          ${s.body ? `<p>${esc(s.body)}</p>` : ""}
        </div>
        ${foot(true)}
      </section>`;

    case "cta":
      return `<section class="slide light">
        <div class="orb soft" style="left:-300px; top:80px"></div><div class="orb soft" style="left:560px; top:860px"></div>
        ${count(false)}
        <div class="cta">
          ${c.logo ? `<img class="cta-logo" src="${c.logo}" alt="${esc(brand.name)}">` : `<div class="cta-word">${esc(brand.name)}</div>`}
          <h2>${keep(s.title)}</h2>
          <div class="button">${esc(s.button)}</div>
          ${s.sub ? `<p>${esc(s.sub)}</p>` : ""}
        </div>
      </section>`;
  }
}

function page(spec: CarouselSpec, bodies: string[], print = false) {
  const { accent, ground, paper, cream, highlight } = spec.brand;
  const font = (family: string, file: string, style = "normal") =>
    `@font-face { font-family: "${family}"; src: url("${pathToFileURL(file).href}") format("woff2"); font-weight: 100 900; font-style: ${style}; }`;
  if (!existsSync(FONTS.inter)) throw new Error("fonts missing: run npm install");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  ${font("Inter", FONTS.inter)}
  ${font("Playfair", FONTS.serif)}
  ${font("Playfair", FONTS.serifItalic, "italic")}
  @page { size: ${W}px ${H}px; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; ${print ? "" : `height: ${H}px; overflow: hidden;`} font-family: "Inter", sans-serif; -webkit-font-smoothing: antialiased; }
  .nb { white-space: nowrap; }
  .slide { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; break-after: page; }
  .dark { background: ${ground}; color: #fff; }
  .light { background: ${paper}; color: ${INK}; }
  .cream { background: ${cream}; color: #1d1a16; }
  .orb { position: absolute; width: 900px; height: 900px; border-radius: 50%; background: radial-gradient(circle, ${accent}66 0%, transparent 68%); }
  .orb.soft { background: radial-gradient(circle, ${accent}2e 0%, transparent 68%); }

  .count { position: absolute; top: 56px; right: ${PAD}px; z-index: 3; padding: 10px 18px; border-radius: 999px; font-size: 24px; font-weight: 700; background: rgba(11,13,23,.07); color: ${INK}; }
  .count.on-dark { background: rgba(6,10,28,.55); color: #fff; }
  .foot { position: absolute; left: ${PAD}px; right: ${PAD}px; bottom: 54px; z-index: 3; display: flex; align-items: center; justify-content: space-between; font-size: 26px; font-weight: 600; color: #6b7080; }
  .foot.on-dark { color: rgba(255,255,255,.8); }
  .mark { height: 38px; }
  .mark.white { filter: brightness(0) invert(1); }
  .arrow { display: inline-block; margin-left: 8px; color: ${highlight}; font-weight: 800; }

  .cover-photo { position: absolute; left: 0; top: 0; width: 100%; height: 900px; object-fit: cover; }
  .cover-fade { position: absolute; left: 0; top: 0; width: 100%; height: 900px; background: linear-gradient(180deg, ${ground}00 30%, ${ground}cc 72%, ${ground} 100%); }
  .cover-text { position: absolute; left: ${PAD}px; right: ${PAD}px; bottom: 150px; }
  .kicker { display: inline-block; padding: 12px 22px; border-radius: 999px; background: ${accent}; font-size: 26px; font-weight: 700; letter-spacing: .08em; margin-bottom: 30px; }
  h1 { font-weight: 900; line-height: .98; letter-spacing: -.035em; }
  .cover-sub { margin-top: 28px; font-size: 36px; line-height: 1.35; color: rgba(255,255,255,.78); max-width: 860px; }

  .listing-photo { position: absolute; left: 0; top: 0; width: 100%; height: 740px; object-fit: cover; }
  .badge { position: absolute; left: ${PAD}px; top: 56px; z-index: 3; padding: 14px 24px; border-radius: 16px; background: ${highlight}; color: ${INK}; font-size: 32px; font-weight: 900; transform: rotate(-2deg); box-shadow: 0 14px 40px rgba(0,0,0,.3); }
  .pricebox { position: absolute; left: ${PAD}px; top: 628px; z-index: 3; display: flex; flex-direction: column; padding: 16px 30px 18px; border-radius: 26px; background: ${accent}; color: #fff;
    transform: rotate(-2deg); box-shadow: 0 24px 60px ${accent}70; }
  .pricebox span { font-size: 24px; font-weight: 800; letter-spacing: .1em; opacity: .85; }
  .pricebox b { font-size: 112px; font-weight: 900; letter-spacing: -.04em; line-height: 1; }
  .listing-text { position: absolute; left: ${PAD}px; right: ${PAD}px; top: 840px; }
  .place { font-size: 26px; font-weight: 700; letter-spacing: .12em; color: ${accent}; }
  .listing-text h2 { margin-top: 10px; font-weight: 900; letter-spacing: -.03em; line-height: 1.05; white-space: nowrap; }
  .facts { margin-top: 18px; font-size: 34px; font-weight: 600; color: #3d4252; }
  .facts i { font-style: normal; margin: 0 16px; color: #a0a5b5; }
  .rows { margin-top: 34px; border-top: 2px solid rgba(11,13,23,.08); }
  .row { display: flex; justify-content: space-between; align-items: baseline; padding: 20px 0; border-bottom: 2px solid rgba(11,13,23,.08); font-size: 30px; }
  .row span { color: #6b7080; font-weight: 500; }
  .row b { font-weight: 800; }

  .term { position: absolute; left: ${PAD}px; right: ${PAD}px; top: 130px; bottom: 150px; display: flex; flex-direction: column; justify-content: center; font-family: "Playfair", serif; }
  .word { font-weight: 700; line-height: 1; letter-spacing: -.02em; }
  .say { margin-top: 18px; font-size: 40px; color: #6d655a; }
  .say em { margin-left: 18px; }
  .term hr { margin: 40px 0 36px; border: 0; border-top: 3px solid #1d1a16; }
  .term ol { list-style: none; counter-reset: d; }
  .term li { counter-increment: d; position: relative; padding-left: 64px; margin-bottom: 26px; font-size: 40px; line-height: 1.32; }
  .term li::before { content: counter(d) "."; position: absolute; left: 0; font-family: "Inter", sans-serif; font-weight: 800; font-size: 34px; top: 6px; color: ${accent}; }
  .term blockquote { margin-top: 34px; padding-left: 30px; border-left: 6px solid ${accent}; font-style: italic; font-size: 38px; line-height: 1.35; color: #3b352d; }
  .origin { margin-top: 36px; font-family: "Inter", sans-serif; font-size: 24px; font-weight: 600; letter-spacing: .06em; color: #8a8174; text-transform: uppercase; }

  .tip { position: absolute; left: ${PAD}px; right: ${PAD}px; top: 190px; }
  .num { font-size: 200px; font-weight: 900; letter-spacing: -.05em; line-height: .9; color: ${accent}; }
  .tip h2 { margin-top: 40px; font-weight: 900; letter-spacing: -.03em; line-height: 1.04; }
  .tip p { margin-top: 36px; font-size: 40px; line-height: 1.45; color: #3d4252; }

  .stat { position: absolute; left: ${PAD}px; right: ${PAD}px; top: 300px; }
  .stat .value { font-weight: 900; letter-spacing: -.05em; line-height: .95; color: ${highlight}; }
  .stat h2 { margin-top: 30px; font-size: 60px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; }
  .stat p { margin-top: 30px; font-size: 36px; line-height: 1.45; color: rgba(255,255,255,.75); }

  .cta { position: absolute; left: ${PAD}px; right: ${PAD}px; top: 380px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .cta-logo { width: 560px; }
  .cta-word { font-size: 120px; font-weight: 900; }
  .cta h2 { margin-top: 70px; font-size: 88px; font-weight: 900; letter-spacing: -.035em; line-height: 1.02; }
  .button { margin-top: 56px; padding: 30px 80px; border-radius: 999px; background: ${accent}; color: #fff; font-size: 56px; font-weight: 900; box-shadow: 0 24px 60px ${accent}66; }
  .cta p { margin-top: 40px; font-size: 34px; font-weight: 600; color: #6b7080; }
</style></head>
<body>
${bodies.join("\n")}
</body></html>
`;
}
