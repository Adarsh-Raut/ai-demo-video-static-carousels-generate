// Visit vihara.ai as a visitor, scroll through, and save section screenshots plus copy/colors/fonts.
import { chromium } from "playwright";
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await p.goto("https://www.vihara.ai/", { waitUntil: "networkidle", timeout: 60000 });
for (const s of ["button:has-text('Accept')", "button:has-text('Reject')", "[aria-label*='close' i]"]) {
  const el = p.locator(s).first(); if (await el.isVisible().catch(() => false)) await el.click().catch(() => {});
}
const kill = () => p.evaluate(`(() => { for (const e of document.querySelectorAll('body *')) { const c = getComputedStyle(e); if ((c.position === 'fixed' || c.position === 'sticky') && e.getBoundingClientRect().height > 300 && !e.closest('header,nav')) e.style.setProperty('display','none','important'); if (/Send me deals/.test(e.innerText||'') && c.position === 'fixed') e.style.setProperty('display','none','important'); } document.body.style.overflow = 'auto'; document.documentElement.style.overflow = 'auto'; })()`);
const H = await p.evaluate("document.body.scrollHeight");
for (let y = 0; y < H; y += 500) { await p.evaluate(`window.scrollTo(0, ${y})`); await p.waitForTimeout(250); }
await p.evaluate("window.scrollTo(0,0)"); await p.waitForTimeout(800);
const info = await p.evaluate(`(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const h1 = document.querySelector('h1');
  const heads = [...document.querySelectorAll('h1,h2,h3,p,button,a')].map(e => ({tag:e.tagName, text:e.innerText.trim().replace(/\\s+/g,' ').slice(0,160), y: Math.round(e.getBoundingClientRect().top + scrollY)})).filter(x => x.text.length > 2);
  const colors = {}; for (const e of document.querySelectorAll('*')) { const c = cs(e); for (const k of ['color','backgroundColor']) colors[c[k]] = (colors[c[k]]||0)+1; }
  return { title: document.title, h1Font: cs(h1).fontFamily, h1Weight: cs(h1).fontWeight, bodyFont: cs(document.body).fontFamily,
    colors: Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0,24),
    og: [...document.querySelectorAll('meta[property^=og], meta[name=description]')].map(m => (m.getAttribute('property')||m.name)+': '+m.content),
    imgs: [...document.querySelectorAll('img')].map(i => ({src: i.currentSrc, alt: i.alt, w: i.naturalWidth, y: Math.round(i.getBoundingClientRect().top+scrollY)})).filter(i=>i.w>200).slice(0,60),
    videos: [...document.querySelectorAll('video source, video')].map(v => v.src || v.currentSrc).filter(Boolean),
    text: heads };
})()`);
const fs = await import("node:fs");
fs.writeFileSync(`${out}/site.json`, JSON.stringify(info, null, 1));
let i = 0;
for (const sec of await p.locator("section").all()) {
  await sec.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(700); await kill();
  const bb = await sec.boundingBox(); if (!bb || bb.height < 100) continue;
  await sec.screenshot({ path: `${out}/shots/sec-${String(i++).padStart(2, "0")}.png` }).catch(() => {});
}
await p.evaluate("window.scrollTo(0,0)"); await p.waitForTimeout(800);
await kill(); await p.screenshot({ path: `${out}/shots/hero-1080.png` });
await b.close();
