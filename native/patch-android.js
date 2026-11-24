// Passt das von Capacitor erzeugte Android-Projekt an: Symbole, Startbild, Rechte, Version, Signatur.
const fs = require("fs"), path = require("path");
const app = path.join(__dirname, "..", "android", "app"), res = path.join(app, "src", "main", "res");
const rd = f => fs.readFileSync(f, "utf8"), wr = (f, s) => fs.writeFileSync(f, s);

// Symbole, Mitteilungs-Symbol, stilles Tonsignal
fs.cpSync(path.join(__dirname, "res"), res, { recursive: true });
fs.rmSync(path.join(res, "drawable-v24", "ic_launcher_foreground.xml"), { force: true });
fs.rmSync(path.join(res, "drawable", "ic_launcher_background.xml"), { force: true });

// Startbild: Nachtblau mit dem App-Symbol in der Mitte
for (const d of fs.readdirSync(res)) fs.rmSync(path.join(res, d, "splash.png"), { force: true });
wr(path.join(res, "drawable", "splash.xml"), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item><color android:color="#25303f"/></item>
  <item android:gravity="center" android:width="120dp" android:height="120dp" android:drawable="@drawable/splash_icon"/>
</layer-list>
`);
let st = rd(path.join(res, "values", "styles.xml"));
st = st.replace('<item name="android:background">@drawable/splash</item>',
  '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenBackground">#25303f</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
st = st.replace('<item name="android:background">@null</item>',
  '<item name="android:background">@null</item>\n        <item name="android:statusBarColor">#25303f</item>\n        <item name="android:navigationBarColor">#25303f</item>\n        <item name="android:windowBackground">@color/pillen_bg</item>');
wr(path.join(res, "values", "styles.xml"), st);
wr(path.join(res, "values", "pillen_colors.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="pillen_bg">#25303f</color></resources>\n`);

// Rechte: pünktliche Wecker für die Erinnerungen
const mf = path.join(app, "src", "main", "AndroidManifest.xml");
let m = rd(mf);
if (!m.includes("USE_EXACT_ALARM")) m = m.replace('<uses-permission android:name="android.permission.INTERNET" />',
  `<uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.VIBRATE" />`);
wr(mf, m);

// Version und Signatur
const bg = path.join(app, "build.gradle");
let g = rd(bg);
const run = parseInt(process.env.BUILD_NUMBER || "1", 10);
g = g.replace(/versionCode \d+/, "versionCode " + run).replace(/versionName "[^"]*"/, `versionName "1.${run}"`);
g = g.replace("    buildTypes {", `    signingConfigs {
        release {
            storeFile file(System.getenv("PILLEN_KEYSTORE") ?: "pillen.jks")
            storePassword System.getenv("PILLEN_KEY_PASS")
            keyAlias "pillen"
            keyPassword System.getenv("PILLEN_KEY_PASS")
        }
    }
    buildTypes {`).replace("            minifyEnabled false", "            minifyEnabled false\n            signingConfig signingConfigs.release");
wr(bg, g);
console.log("Android-Projekt angepasst, Version 1." + run);
