// Download the media used in the video (images only) and record the hero's animated 3D canvas as frames.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2];
const cl = (url) => url.replace(/\/upload\/[^/]+\//, "/upload/c_lfill,w_720,h_912,q_auto:good,f_jpg/");
const slugs = ["401-rensselaer-ave-ogdensburg","2529-2531-e-monument-st-baltimore","703-59th-ave-capitol-heights","18753-san-diego-blvd-lathrup-village","1983-law-st-new-orleans","1977-law-st-new-orleans","2508-12-s-prieur-st-new-orleans","1405-tamarack-ave-atwater","16556-sallander-dr-sonora","334-s-2nd-ave-oakdale","1961-nikki-ann-way-turlock","17895-towhee-ln-twain-harte"];
const site = JSON.parse((await import("node:fs")).readFileSync(`${out}/site.json`, "utf8"));
for (const s of slugs) {
  const img = site.imgs.find((i) => i.src.includes(s));
  const r = await fetch(cl(img.src)); writeFileSync(`${out}/assets/${s}.jpg`, Buffer.from(await r.arrayBuffer()));
}
writeFileSync(`${out}/assets/logo.png`, Buffer.from(await (await fetch("https://www.vihara.ai/images/vihara-logo.png")).arrayBuffer()));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await p.goto("https://www.vihara.ai/", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const t0 = Date.now(); const times = [];
for (let i = 0; i < 60; i++) {
  await p.screenshot({ path: `${out}/canvas/f${String(i).padStart(3, "0")}.png`, clip: { x: 990, y: 230, width: 580, height: 360 } });
  times.push(Date.now() - t0);
}
writeFileSync(`${out}/canvas/times.json`, JSON.stringify(times));
await b.close();
