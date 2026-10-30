// Scout: open any URL and map what a demo could show, so Claude can write the spec
// against real selectors instead of guessing. Writes out/<id>/scout/ with:
//   site.json   title, description, brand colours/fonts, sections, headings, clickable
//               elements and inputs, each with a selector that resolves to exactly one node
//   shot-*.jpg  viewport screenshots down the page (to look at)
// and, if it doesn't exist yet, a starter spec at demos/<id>.json.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { openSite } from "./record.ts";
import { Spec } from "./spec.ts";
import { ROOT, workDir, writeJson } from "./util.ts";

// HyperFrames resolves these by name; anything else falls back to Inter (see compose).
export const BUNDLED_FONTS = [
  "Inter", "Montserrat", "Outfit", "Nunito", "Oswald", "League Gothic", "Archivo Black", "Space Mono",
  "IBM Plex Mono", "JetBrains Mono", "EB Garamond", "Playfair Display", "Source Code Pro", "Noto Sans JP",
  "Roboto", "Open Sans", "Lato", "Poppins",
];

type Site = {
  url: string;
  chrome: "light" | "dark";
  title: string;
  description: string;
  pageHeight: number;
  brand: { name: string; accent: string; ground: string; ink: string; font: string; siteFont: string };
  sections: { selector: string; heading: string; y: number }[];
  headings: { level: number; text: string; y: number }[];
  clickables: { selector: string; text: string; kind: string; y: number; href?: string }[];
  inputs: { selector: string; label: string; type: string; y: number }[];
};

// Runs in the page. Plain JS string so tsx's helpers don't leak into it.
const MAP_PAGE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
  const text = (el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  // What Playwright's :has-text matches against: textContent, whitespace-collapsed (so a
  // <br> joins words, unlike innerText).
  const pwText = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();
  const absY = (el) => Math.round(el.getBoundingClientRect().top + scrollY);
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const esc = (s) => CSS.escape(s);
  const selectorFor = (el) => {
    const tag = el.tagName.toLowerCase();
    // Framework-generated ids (React useId, Radix, Headless UI) change between builds.
    const stableId = (id) => id && !/[:_]R_|^radix-|^headlessui-|^base-ui-|^react-|\\d{5,}/.test(id);
    if (stableId(el.id) && unique("#" + esc(el.id))) return "#" + esc(el.id);
    for (const a of ["data-testid", "data-test", "data-cy", "name", "aria-label", "placeholder"]) {
      const v = el.getAttribute(a);
      if (v && unique(tag + "[" + a + '="' + v.replace(/"/g, '\\\\"') + '"]')) return tag + "[" + a + '="' + v.replace(/"/g, '\\\\"') + '"]';
    }
    if (tag === "a" && el.getAttribute("href") && unique('a[href="' + el.getAttribute("href") + '"]')) return 'a[href="' + el.getAttribute("href") + '"]';
    // Text-based (Playwright :has-text), scoped to a landmark when the text repeats.
    const t = pwText(el);
    if (t && t.length <= 40 && !t.includes('"')) {
      const same = [...document.querySelectorAll(tag)].filter((x) => vis(x) && pwText(x) === t);
      if (same.length === 1) return tag + ':has-text("' + t + '")';
      for (const lm of ["header", "nav", "main", "footer"]) {
        const scope = el.closest(lm);
        if (scope && [...scope.querySelectorAll(tag)].filter((x) => vis(x) && pwText(x) === t).length === 1
            && [...document.querySelectorAll(lm)].find((x) => x.contains(el)) === document.querySelector(lm))
          return lm + " " + tag + ':has-text("' + t + '")';
      }
      // Recording uses locator(...).first(), so "first visible match" is enough.
      if (same[0] === el) return tag + ':has-text("' + t + '"):visible';
    }
    const path = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (stableId(n.id) && unique("#" + esc(n.id))) { path.unshift("#" + esc(n.id)); break; }
      const idx = [...n.parentElement.children].filter((c) => c.tagName === n.tagName).indexOf(n) + 1;
      path.unshift(n.tagName.toLowerCase() + ":nth-of-type(" + idx + ")");
    }
    return (path[0].startsWith("#") ? "" : "body > ") + path.join(" > ");
  };

  // Brand: the most common saturated background among buttons/links is the accent.
  const toHex = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number);
    if (a < 0.5) return null; return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""); };
  const sat = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  const tally = {};
  for (const el of document.querySelectorAll("button, a, [role=button], input[type=submit]")) {
    if (!vis(el)) continue;
    const hex = toHex(getComputedStyle(el).backgroundColor);
    if (hex && sat(hex) > 0.35 && hex !== "#0000ee") tally[hex] = (tally[hex] || 0) + 1;
  }
  const accent = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const bodyBg = toHex(getComputedStyle(document.body).backgroundColor) || toHex(getComputedStyle(document.documentElement).backgroundColor) || "#ffffff";
  const h1 = document.querySelector("h1");
  const fontOf = (el) => (el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim() : "");

  const clickables = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("a[href], button, [role=button], [role=tab], summary, input[type=submit]")) {
    if (!vis(el)) continue;
    const t = text(el);
    if (!t || seen.has(t + el.tagName)) continue;
    seen.add(t + el.tagName);
    const kind = el.closest("nav, header") ? "nav" : el.tagName === "A" ? "link" : "button";
    clickables.push({ selector: selectorFor(el), text: t, kind, y: absY(el), href: el.getAttribute("href") || undefined });
    if (clickables.length >= 80) break;
  }
  const inputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]), textarea, select")]
    .filter(vis).slice(0, 30).map((el) => ({
      selector: selectorFor(el),
      label: (el.labels?.[0]?.innerText || el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.name || "").trim().slice(0, 60),
      type: el.getAttribute("type") || el.tagName.toLowerCase(), y: absY(el) }));
  const headings = [...document.querySelectorAll("h1, h2, h3")].filter(vis).slice(0, 60)
    .map((el) => ({ level: Number(el.tagName[1]), text: text(el), y: absY(el) })).filter((h) => h.text);
  const sections = [...document.querySelectorAll("section, [id]:is(div, article, main > *)")]
    .filter((el) => vis(el) && el.getBoundingClientRect().height > 200).slice(0, 40)
    .map((el) => {
      const h = el.querySelector("h1, h2, h3");
      const ht = h ? pwText(h) : "";
      // Prefer "section with this heading": stable across layout changes.
      const byHeading = ht && ht.length <= 60 && !ht.includes('"') && !el.id
        && [...document.querySelectorAll(el.tagName)].filter((x) => x.querySelector("h1, h2, h3") && pwText(x.querySelector("h1, h2, h3")) === ht).length === 1
        ? el.tagName.toLowerCase() + ":has(" + h.tagName.toLowerCase() + ':has-text("' + ht + '"))' : null;
      return { selector: byHeading || selectorFor(el), heading: (h ? text(h) : text(el)).slice(0, 60), y: absY(el) };
    })
    .filter((s, i, a) => a.findIndex((x) => x.selector === s.selector) === i);

  return {
    title: document.title,
    description: document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "",
    siteName: document.querySelector('meta[property="og:site_name"]')?.content || "",
    pageHeight: document.documentElement.scrollHeight,
    accent, bodyBg, ink: toHex(getComputedStyle(h1 || document.body).color) || "#111111",
    siteFont: fontOf(h1) || fontOf(document.body),
    clickables, inputs, headings, sections,
  };
})()`;

export async function scout(url: string, id: string) {
  const { dir } = workDir(id);
  const out = join(dir, "scout");
  mkdirSync(out, { recursive: true });

  const viewport = { width: 1440, height: 900 };
  const browser = await chromium.launch();
  try {
    const probe = Spec.parse({
      id, url, viewport,
      intro: { headline: "" }, outro: { headline: "" }, scenes: [{ id: "probe", narration: "" }],
    });
    const page = await openSite(browser, probe);
    await page.clock.resume();
    const raw = (await page.evaluate(MAP_PAGE)) as Omit<Site, "url" | "brand"> & {
      accent: string | null; bodyBg: string; ink: string; siteFont: string; siteName: string;
    };

    // Screenshots down the page, at most 8.
    const shots = Math.min(8, Math.ceil(raw.pageHeight / viewport.height));
    for (let i = 0; i < shots; i++) {
      await page.evaluate(`window.scrollTo({ top: ${i * viewport.height}, behavior: "instant" })`);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(out, `shot-${i}.jpg`), type: "jpeg", quality: 70, scale: "css" });
    }

    const name = raw.siteName || raw.title.split(/[|\-–—:·]/)[0].trim() || new URL(url).hostname.replace(/^www\./, "");
    const font = BUNDLED_FONTS.find((f) => f.toLowerCase() === raw.siteFont.toLowerCase()) ?? "Inter";
    // Video ground: a dark take on the brand so the white browser window pops.
    const lum = (hex: string) => [1, 3, 5].reduce((a, i, k) => a + parseInt(hex.slice(i, i + 2), 16) * [0.299, 0.587, 0.114][k], 0);
    const site: Site = {
      url, chrome: lum(raw.bodyBg) < 100 ? "dark" : "light", title: raw.title, description: raw.description, pageHeight: raw.pageHeight,
      brand: { name, accent: raw.accent ?? "#6d5efc", ground: "#0b0b12", ink: "#ffffff", font, siteFont: raw.siteFont },
      sections: raw.sections, headings: raw.headings, clickables: raw.clickables, inputs: raw.inputs,
    };
    writeJson(join(out, "site.json"), site);
    console.log(`scout  ${raw.title}\n  ${site.clickables.length} clickables, ${site.inputs.length} inputs, ${site.sections.length} sections, ${shots} screenshots → ${out}`);

    const specPath = join(ROOT, "demos", `${id}.json`);
    if (!existsSync(specPath)) {
      mkdirSync(join(ROOT, "demos"), { recursive: true });
      writeFileSync(specPath, JSON.stringify(starterSpec(id, site), null, 2) + "\n");
      console.log(`  starter spec → ${specPath}  (edit the narration and actions before recording)`);
    }
    return site;
  } finally {
    await browser.close();
  }
}

// A runnable first draft: hero with the main CTA, then a tour of the biggest sections.
// Claude is expected to rewrite the narration and pick better moments.
function starterSpec(id: string, site: Site) {
  const cta = site.clickables.find((c) => c.kind === "button" && c.y < 900) ?? site.clickables.find((c) => c.kind !== "nav" && c.y < 900);
  const sections = site.sections.filter((s) => s.y > 600).slice(0, 3);
  const h1 = site.headings.find((h) => h.level === 1)?.text ?? site.title;
  return {
    id,
    url: site.url,
    viewport: { width: 1440, height: 900 },
    chrome: site.chrome,
    brand: { name: site.brand.name, accent: site.brand.accent, ground: site.brand.ground, ink: site.brand.ink, font: site.brand.font },
    voice: { engine: "kokoro", voice: "af_heart", speed: 1 },
    intro: { headline: h1.slice(0, 60), sub: site.brand.name, narration: `This is ${site.brand.name}.` },
    scenes: [
      {
        id: "hero",
        title: site.brand.name,
        narration: site.description || `Here's what ${site.brand.name} does.`,
        actions: cta ? [{ type: "hover", selector: cta.selector, callout: cta.text, hold: 1.5 }] : [{ type: "wait", seconds: 2 }],
      },
      ...sections.map((s, i) => ({
        id: `section-${i + 1}`,
        title: s.heading.split(" ").slice(0, 4).join(" "),
        narration: s.heading,
        actions: [{ type: "scrollTo", selector: s.selector }, { type: "wait", seconds: 1.5 }],
      })),
    ],
    outro: { headline: site.brand.name, cta: cta?.text ?? "Learn more", narration: `Try ${site.brand.name} today.` },
  };
}
