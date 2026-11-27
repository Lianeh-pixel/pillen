/* Pillenerinnerung als Android-App: Erinnerungen werden direkt auf dem Gerät geplant
   (kein Server, keine Internetverbindung nötig). Wird nur in der App geladen, nicht in der PWA. */
"use strict";
const NP = window.Capacitor && window.Capacitor.Plugins, LN = NP && NP.LocalNotifications;
const CHANNEL = { ton: "pillen-ton", vib: "pillen-vib", still: "pillen-still" };
const DAYS_AHEAD = 21, MAX_NOTES = 400;

// feste Zahl je Mitteilung (gleiche Mitteilung = gleiche Nummer)
function noteId(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (Math.abs(h) % 2000000000) + 100; }
const medLine = meds => meds.map(m => m.name + (doseText(m).trim() ? " · " + doseText(m).trim() : "")).join(", ");

async function nativeSetup() {
  try {
    await LN.createChannel({ id: CHANNEL.ton, name: "Erinnerungen mit Ton", importance: 5, visibility: 1, vibration: true });
    await LN.createChannel({ id: CHANNEL.vib, name: "Erinnerungen nur Vibration", importance: 5, visibility: 1, vibration: true, sound: "stille.wav" });
    await LN.createChannel({ id: CHANNEL.still, name: "Erinnerungen ohne Ton", importance: 4, visibility: 1, vibration: false, sound: "stille.wav" });
    await LN.registerActionTypes({ types: [{ id: "pill", actions: [{ id: "taken", title: "Eingenommen" }] }] });
  } catch (e) { console.warn(e); }
  LN.addListener("localNotificationActionPerformed", ev => {
    const x = (ev.notification && ev.notification.extra) || {};
    const slots = String(x.keys || "").split(",").filter(Boolean).map(slotByKey).filter(Boolean);
    if (ev.actionId === "taken" && slots.length) {
      slots.forEach(sl => mark(sl, openMeds(sl).filter(m => sl.at.getTime() >= (m.created || 0) - 60e3), "taken"));
      toast("Eingenommen ✓");
    }
    tab = x.kind === "stock" ? "mittel" : "heute"; closeSheet(); render();
  });
  LN.addListener("localNotificationReceived", () => render());
  NP.App.addListener("resume", () => nativeInbox());
  setInterval(() => { if (!document.hidden) nativeInbox(); }, 5000);
  NP.App.addListener("backButton", () => {
    if (!$("#sheet").hidden) closeSheet();
    else if (tab !== "heute") { tab = "heute"; render(); }
    else NP.App.exitApp();
  });
  await nativeInbox();
  await nativeAsk();
  nativeSchedule();
}

// „Eingenommen“ in der Mitteilung öffnet die App nicht: Android merkt sich den Tipp
// (PillActionReceiver, siehe native/patch-android.js), hier wird er übernommen.
let inboxBusy = false;
async function nativeInbox() {
  const P = NP.Preferences; if (!P || inboxBusy) return;
  inboxBusy = true;
  try {
    const r = await P.get({ key: "pillInbox" });
    const items = JSON.parse((r && r.value) || "[]");
    if (items.length) {
      await P.remove({ key: "pillInbox" });
      for (const it of items) {
        if (it.action !== "taken") continue;
        const at = it.at || Date.now();
        String(it.keys || "").split(",").filter(Boolean).map(slotByKey).filter(Boolean)
          .forEach(sl => mark(sl, openMeds(sl, at).filter(m => sl.at.getTime() >= (m.created || 0) - 60e3), "taken", at));
      }
      render();
    }
  } catch (e) { console.warn("Mitteilungs-Aktionen", e); }
  inboxBusy = false;
}

async function nativePerm() { try { return (await LN.checkPermissions()).display; } catch (e) { return "denied"; } }
async function nativeAsk() {
  let p = await nativePerm();
  if (p !== "granted") { try { p = (await LN.requestPermissions()).display; } catch (e) {} }
  if (p !== "granted") toast("Mitteilungen sind blockiert. Bitte in den Android-Einstellungen unter Apps → MedTimer erlauben.", 8000);
  return p === "granted";
}

// Alle Erinnerungen der nächsten Wochen neu planen
let nsT = null, nsBusy = false, nsAgain = false;
function nativeQueue() { clearTimeout(nsT); nsT = setTimeout(nativeSchedule, 400); }
async function nativeSchedule() {
  if (nsBusy) { nsAgain = true; return; }
  nsBusy = true;
  try {
    const now = Date.now(), list = [], doneIds = [];
    const chan = CHANNEL[S.sound] || CHANNEL.ton;
    const add = (id, at, title, body, extra, actions, largeBody) => list.push({ id, title, body, ...(largeBody ? { largeBody } : {}), channelId: chan, smallIcon: "ic_stat_pill", iconColor: "#5f8fbf",
      schedule: { at: new Date(at), allowWhileIdle: true }, extra, ...(actions ? { actionTypeId: "pill" } : {}) });
    for (let i = -1; i <= DAYS_AHEAD; i++) {
      for (const sl of slotsOf(addDays(new Date(), i), true)) {
        const t = sl.at.getTime();
        const open = remindMeds(sl, now).filter(m => t >= (m.created || 0) - 60e3);
        const ids = ["due", "nag", "snooze"].map(k => noteId(k + sl.key));
        if (!open.length) { if (t <= now + 60e3) doneIds.push(...ids); continue; }
        const many = open.length > 1, extra = { kind: "slot", keys: sl.key };
        const body = many ? open.map(m => m.name).join(", ") : medLine(open), lines = many ? open.map(m => medLine([m])).join("\n") : null;
        if (t > now) add(ids[0], t, "Zeit für deine Medikamente", body, extra, true, lines);
      }
    }
    // Vorrat
    S.stockNote = S.stockNote || {};
    for (const m of S.meds) {
      if (!m.stockMode || m.stockMode === "off" || m.stockOk) continue;
      const a = stockAlertAt(m); if (!a) continue;
      const at = a.getTime(), seen = S.stockNote[m.id];
      if (at <= now && seen && Math.abs(seen - at) < 12 * 3600e3) continue;   // schon gemeldet
      const txt = at > now && m.stockMode === "rest" ? "Nur noch " + fmtNum(m.stockRest ?? 0) + " " + unitFor(m, m.stockRest ?? 0) + " übrig – bald nachkaufen" : stockText(m);
      add(noteId("stock" + m.id), Math.max(at, now + 3000), "Vorrat: " + m.name, txt, { kind: "stock", id: m.id }, false);
      S.stockNote[m.id] = at;
    }
    localStorage.setItem(KEY, JSON.stringify(S));
    list.sort((a, b) => a.schedule.at - b.schedule.at);
    const pending = (await LN.getPending()).notifications || [];
    if (pending.length) await LN.cancel({ notifications: pending.map(n => ({ id: n.id })) });
    const want = list.slice(0, MAX_NOTES);
    if (want.length) await LN.schedule({ notifications: want });
    if (doneIds.length) { try { await LN.removeDeliveredNotifications({ notifications: doneIds.map(id => ({ id })) }); } catch (e) {} }
  } catch (e) { console.warn("Planen fehlgeschlagen", e); }
  nsBusy = false;
  if (nsAgain) { nsAgain = false; nativeSchedule(); }
}

async function nativeTest() {
  if (!(await nativeAsk())) return;
  await LN.schedule({ notifications: [{ id: 42, title: "Test: MedTimer", body: "So meldet sich die App, auch wenn sie geschlossen ist.", channelId: CHANNEL[S.sound] || CHANNEL.ton,
    smallIcon: "ic_stat_pill", iconColor: "#5f8fbf", schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
  toast("Der Test kommt in 5 Sekunden – du kannst die App dafür schließen.", 5000);
}

async function nativeExport(json, name) {
  try {
    const r = await NP.Filesystem.writeFile({ path: name, data: json, directory: "CACHE", encoding: "utf8" });
    await NP.Share.share({ title: "MedTimer-Sicherung", url: r.uri, dialogTitle: "Sicherung speichern" });
  } catch (e) { if (!/cancel/i.test(e.message || "")) toast("Speichern fehlgeschlagen: " + (e.message || e), 6000); }
}

function nativeBars(dark) {
  try { NP.StatusBar.setBackgroundColor({ color: dark ? "#25303f" : "#f6f2ee" }); NP.StatusBar.setStyle({ style: dark ? "DARK" : "LIGHT" }); } catch (e) {}
}
