// Erzeugt die Android-Ressourcen (Symbole, Mitteilungs-Symbol, Startbild, stilles Tonsignal) aus den SVGs in icons/.
// Einmalig lokal ausführen: node native/make-res.js  (braucht Playwright/Chromium)
const fs = require("fs"), path = require("path"), { chromium } = require("playwright");
const root = path.join(__dirname, ".."), out = path.join(__dirname, "res");
const svg = f => fs.readFileSync(path.join(root, "icons", f), "utf8");
const mask = svg("maskable.svg"), fg = mask.replace(/<rect[^>]*\/>/, ""), icon = svg("icon.svg"), badge = svg("badge.svg");
const round = mask.replace('<rect width="512" height="512" fill="#ffffff"/>', '<circle cx="256" cy="256" r="256" fill="#ffffff"/>');
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  async function png(src, size, file) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${src.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  for (const [d, f] of Object.entries(D)) {
    await png(icon, 48 * f, `${out}/mipmap-${d}/ic_launcher.png`);
    await png(round, 48 * f, `${out}/mipmap-${d}/ic_launcher_round.png`);
    await png(fg, 108 * f, `${out}/mipmap-${d}/ic_launcher_foreground.png`);
    await png(badge, 24 * f, `${out}/drawable-${d}/ic_stat_pill.png`);
  }
  await png(round, 288, `${out}/drawable-nodpi/splash_icon.png`);
  await b.close();
  // 0,3 Sek. Stille (für „Nur Vibration“ und „Ohne Ton“)
  const n = 4410, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(14700, 24); buf.writeUInt32LE(29400, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  fs.mkdirSync(`${out}/raw`, { recursive: true }); fs.writeFileSync(`${out}/raw/stille.wav`, buf);
  console.log("fertig");
})();
