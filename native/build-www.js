// Kopiert die Web-App nach www/ (ohne Service Worker und Web-Manifest, die braucht die Android-App nicht)
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), www = path.join(root, "www");
fs.rmSync(www, { recursive: true, force: true });
for (const f of ["index.html", "style.css", "app.js", "native.js", "shared.js", "config.js", "fonts", "icons"])
  fs.cpSync(path.join(root, f), path.join(www, f), { recursive: true });
let html = fs.readFileSync(path.join(www, "index.html"), "utf8").replace(/<link rel="manifest"[^>]*>\n?/, "");
fs.writeFileSync(path.join(www, "index.html"), html);
console.log("www fertig");
