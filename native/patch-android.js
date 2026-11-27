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

// „Eingenommen“ in der Mitteilung: ohne die App zu öffnen. Ein Empfänger merkt sich den Tipp
// (für die App lesbar über @capacitor/preferences) und schließt die Mitteilung.
const pkgDir = path.join(app, "src", "main", "java", "de", "lianeh", "pillen");
fs.mkdirSync(pkgDir, { recursive: true });
wr(path.join(pkgDir, "PillActionReceiver.java"), `package de.lianeh.pillen;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import org.json.JSONArray;
import org.json.JSONObject;

public class PillActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Integer.MIN_VALUE);
        try {
            JSONObject e = new JSONObject();
            e.put("action", intent.getStringExtra(LocalNotificationManager.ACTION_INTENT_KEY));
            e.put("at", System.currentTimeMillis());
            String src = intent.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY);
            if (src != null) {
                JSONObject x = new JSONObject(src).optJSONObject("extra");
                if (x != null) e.put("keys", x.optString("keys", ""));
            }
            SharedPreferences p = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            JSONArray a;
            try { a = new JSONArray(p.getString("pillInbox", "[]")); } catch (Exception ex) { a = new JSONArray(); }
            a.put(e);
            p.edit().putString("pillInbox", a.toString()).commit();
        } catch (Exception ex) {}
        if (id != Integer.MIN_VALUE) NotificationManagerCompat.from(context).cancel(id);
    }
}
`);
m = rd(mf);
if (!m.includes("PillActionReceiver")) m = m.replace("</application>", '    <receiver android:name=".PillActionReceiver" android:exported="false" />\n    </application>');
wr(mf, m);
const lnm = path.join(__dirname, "..", "node_modules", "@capacitor", "local-notifications", "android", "src", "main", "java", "com", "capacitorjs", "plugins", "localnotifications", "LocalNotificationManager.java");
let ln = rd(lnm);
const lnOld = `                PendingIntent actionPendingIntent = PendingIntent.getActivity(
                    context,
                    localNotification.getId() + notificationAction.getId().hashCode(),
                    actionIntent,
                    flags
                );`;
if (!ln.includes("PillActionReceiver")) {
  if (!ln.includes(lnOld)) throw new Error("LocalNotificationManager.java hat sich geändert – Anpassung für „Eingenommen“ prüfen");
  ln = ln.replace(lnOld, `                PendingIntent actionPendingIntent;
                if ("taken".equals(notificationAction.getId())) {
                    Intent bi = new Intent();
                    bi.setClassName(context, "de.lianeh.pillen.PillActionReceiver");
                    bi.putExtra(NOTIFICATION_INTENT_KEY, localNotification.getId());
                    bi.putExtra(ACTION_INTENT_KEY, notificationAction.getId());
                    bi.putExtra(NOTIFICATION_OBJ_INTENT_KEY, localNotification.getSource());
                    actionPendingIntent = PendingIntent.getBroadcast(
                        context,
                        localNotification.getId() + notificationAction.getId().hashCode(),
                        bi,
                        flags
                    );
                } else {
                    actionPendingIntent = PendingIntent.getActivity(
                        context,
                        localNotification.getId() + notificationAction.getId().hashCode(),
                        actionIntent,
                        flags
                    );
                }`);
  wr(lnm, ln);
}

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
