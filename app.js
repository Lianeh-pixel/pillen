/* Pillenerinnerung – alle Daten liegen auf diesem Gerät (localStorage).
   Für Push-Mitteilungen gehen nur Name, Dosis, Uhrzeiten und offene Termine an Supabase. */
"use strict";
const CFG = self.PB_CONFIG;
const PUSH_FN = CFG.supabaseUrl + "/functions/v1/pillen-push";
const KEY = "pillen";
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());   // Android-App statt PWA
const LATE = 3 * 3600e3;        // nach 3 Std. gilt eine Einnahme als vergessen
const ONTIME = 30 * 60e3;       // pünktlich = höchstens 30 Min. nach der Uhrzeit
// Darreichungsformen: [Mehrzahl, Einzahl, Symbol]
const UNITS = [["Tabletten", "Tablette", "round"], ["Sprühstöße", "Sprühstoß", "spray"], ["Hübe", "Hub", "spray"], ["Einheiten", "Einheit", "syringe"]];
const unitInfo = u => UNITS.find(x => x[0] === u || x[1] === u);

let S = load();
let tab = "heute", hist = { mode: "woche", off: 0 };
let edit = null, tick = null;

function load() {
  let s = {}; try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  return Object.assign({ meds: [], log: {}, snooze: {}, theme: "auto", sound: "ton", device: null, push: false }, s);
}
function fixSound() { if (S.sound !== "still" && !(NATIVE && S.sound === "vib")) S.sound = "ton"; }
function save() { localStorage.setItem(KEY, JSON.stringify(S)); queueSync(); }

/* ---------- Hilfen ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const dkey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseKey = k => { const [d, t] = k.split(" "); const [y, m, dd] = d.split("-").map(Number); const [hh, mi] = (t || "00:00").split(":").map(Number); return new Date(y, m - 1, dd, hh, mi); };
const slotKey = (d, t) => dkey(d) + " " + t;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmtDay = d => d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = d => d.toLocaleDateString("de-DE", { day: "numeric", month: "short" }).replace(".", ".");
const hm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString("de-DE");
const doseText = m => (m.amount != null ? fmtNum(m.amount) + " " : "") + unitFor(m, m.amount);
const unitFor = (m, n) => { const u = m.unit || "Stück", i = unitInfo(u); return i ? (n === 1 ? i[1] : i[0]) : u; };
function toast(t, ms = 3200) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, ms); }

const IC = {
  round: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M8 12h8"/></svg>',
  spray: '<svg viewBox="0 0 24 24"><rect x="8" y="9" width="8" height="11" rx="2"/><path d="M10 9V6h4v3M14 6h2M18 4.5v.01M19.5 6.5v.01M18 8v.01"/></svg>',
  patch: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="8" rx="4"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>',
  syringe: '<svg viewBox="0 0 24 24"><path d="M17 3l4 4M19 5l-9.5 9.5M15 4l5 5M13 7l4 4M8 12l4 4M9.5 14.5L5 19M4 20l1-1"/></svg>',
  tube: '<svg viewBox="0 0 24 24"><path d="M8 4h8l-1 12H9z"/><path d="M10 16v2h4v-2M11 18v2h2v-2"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 4c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0C6.5 11 9 8 12 4z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>'
};
const medIcon = m => IC[(unitInfo(m.unit) || [, , "round"])[2]] || IC.round;

/* ---------- Termine ---------- */
// Alle Termine eines Tages: [{key, at: Date, time, meds:[med]}]
function slotsOf(day, all) {
  const map = new Map();
  for (const m of S.meds) for (const t of (m.times || [])) {
    const at = parseKey(slotKey(day, t));
    if (!all && at.getTime() < (m.created || 0) - 60e3) continue;
    const k = slotKey(day, t);
    if (!map.has(k)) map.set(k, { key: k, at, time: t, meds: [] });
    map.get(k).meds.push(m);
  }
  return [...map.values()].sort((a, b) => a.at - b.at);
}
const entry = (k, m) => S.log[k + "|" + m.id];
function stateOf(slot, m, now = Date.now()) {
  const e = entry(slot.key, m);
  if (e) return e.s;
  if (now < slot.at) return "upcoming";
  return now - slot.at > LATE ? "missed" : "due";
}
const openMeds = (slot, now) => slot.meds.filter(m => { const s = stateOf(slot, m, now); return s === "due" || s === "upcoming"; });

/* ---------- Einnahme ---------- */
function mark(slot, meds, s) {
  for (const m of meds) {
    const k = slot.key + "|" + m.id, old = S.log[k];
    if (old && old.s === s) continue;
    if (old && old.s === "taken" && m.stock != null) m.stock += m.amount || 1;
    if (s === "taken" && m.stock != null) m.stock = Math.max(0, m.stock - (m.amount || 1));
    S.log[k] = { s, at: Date.now() };
    updateLow(m);
  }
  delete S.snooze[slot.key];
  save(); pushSlot(slot);
}
function unmark(slot, m) {
  const k = slot.key + "|" + m.id, old = S.log[k]; if (!old) return;
  if (old.s === "taken" && m.stock != null) m.stock += m.amount || 1;
  delete S.log[k]; updateLow(m); save(); pushSlot(slot);
}
function snooze(slot, min = 15) {
  S.snooze[slot.key] = Date.now() + min * 60e3; save();
  if (S.device && S.push) pbRpc("pill_snooze", { dev: S.device, slot: slot.at.toISOString(), minutes: min }).catch(() => {});
  toast("Ich erinnere dich um " + hm(new Date(S.snooze[slot.key])) + " Uhr nochmal.");
}

/* ---------- Vorrat ---------- */
function updateLow(m) {
  if (m.stockMode !== "rest" || m.stock == null) return;
  if (m.stock <= (m.stockRest ?? 0)) { if (!m.lowSince) m.lowSince = Date.now(); } else m.lowSince = null;
}
function firstTime(m) { return (m.times || []).slice().sort()[0] || "09:00"; }
// Wann soll an den Vorrat erinnert werden? (Date oder null)
function stockAlertAt(m) {
  if (m.stockMode === "date" && m.stockDate) return parseKey(m.stockDate + " " + firstTime(m));
  if (m.stockMode === "span" && m.stockSpan) {
    const base = parseKey((m.stockSince || dkey(new Date(m.created || Date.now()))) + " " + firstTime(m));
    return addDays(base, Math.round(m.stockSpan * (m.stockSpanUnit === "w" ? 7 : m.stockSpanUnit === "m" ? 30 : 1)));
  }
  if (m.stockMode === "rest" && m.stock != null) {
    if (m.lowSince) return new Date(m.lowSince);
    const per = m.amount || 1, rest = m.stockRest ?? 0; let left = m.stock, now = Date.now();
    if (!(m.times || []).length) return null;
    for (let i = 0; i < 800; i++) {
      for (const sl of slotsOf(addDays(startOfDay(new Date()), i))) {
        if (!sl.meds.includes(m) || sl.at < now - LATE) continue;
        if (stateOf(sl, m, now) !== "upcoming" && stateOf(sl, m, now) !== "due") continue;
        left -= per; if (left <= rest) return sl.at;
      }
    }
  }
  return null;
}
function stockDays(m) {
  if (m.stock == null || !(m.times || []).length) return null;
  return Math.floor(m.stock / ((m.amount || 1) * m.times.length));
}
function stockText(m) {
  if (m.stockMode === "rest" && m.stock != null) return "Noch " + fmtNum(m.stock) + " " + unitFor(m, m.stock) + " übrig – bald nachkaufen";
  return "Zeit, " + m.name + " nachzukaufen";
}
const stockDue = m => { const a = stockAlertAt(m); return a && a.getTime() <= Date.now() && !m.stockOk; };
function refill(m, n) {
  m.stock = (m.stock || 0) + n; m.stockSince = dkey(new Date()); m.lowSince = null; m.stockOk = false;
  if (m.stockMode === "date") m.stockDate = null;
  updateLow(m); save(); render(); toast(m.name + ": jetzt " + fmtNum(m.stock) + " " + unitFor(m, m.stock));
}

/* ---------- Abgleich für Push ---------- */
let syncT = null;
function queueSync() { if (NATIVE) { nativeQueue(); return; } if (!S.device || !S.push) return; clearTimeout(syncT); syncT = setTimeout(syncNow, 800); }
async function syncNow() {
  if (!S.device || !S.push) return;
  const meds = S.meds.map(m => { const a = stockAlertAt(m); return { id: m.id, name: m.name, dose: doseText(m).trim(), times: m.times || [], stockAt: a && !m.stockOk && m.stockMode !== "off" ? a.toISOString() : null, stockText: stockText(m) }; });
  try {
    await pbRpc("pill_sync", { dev: S.device, meds });
    const now = Date.now();
    for (const d of [addDays(new Date(), -1), new Date()]) for (const sl of slotsOf(d, true)) if (sl.at.getTime() <= now + 60e3 * 2 && now - sl.at < LATE) await pushSlot(sl);
  } catch (e) { console.warn(e); }
}
async function pushSlot(sl) {
  if (NATIVE) { nativeQueue(); return; }
  if (!S.device || !S.push) return;
  // Mittel, die es zu dem Termin noch nicht gab, gelten als erledigt
  const open = openMeds(sl).filter(m => sl.at.getTime() >= (m.created || 0) - 60e3).map(m => m.id);
  try { await pbRpc("pill_slot", { dev: S.device, slot: sl.at.toISOString(), open }); } catch (e) { console.warn(e); }
}
function b64uBytes(s) { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) { toast("Dieses Gerät kann hier keine Mitteilungen anzeigen.", 6000); return false; }
  const p = await Notification.requestPermission();
  if (p !== "granted") { toast("Mitteilungen sind blockiert. Bitte in den Android-Einstellungen für Chrome bzw. die App erlauben.", 9000); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) { const { pub } = await (await fetch(PUSH_FN)).json(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(pub) }); }
    if (!S.device) S.device = uid();
    await pbSet("device", S.device);
    await pbRpc("pill_register", { dev: S.device, sub: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin" });
    S.push = true; save(); await syncNow();
    return true;
  } catch (e) { toast("Mitteilungen konnten nicht eingerichtet werden: " + (e.message || e), 9000); return false; }
}
async function checkPush() {
  // Abo nach Neustart/Erneuerung aktuell halten
  if (!S.push || !("serviceWorker" in navigator)) return;
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (!sub) { await enablePush(); return; }
    await pbSet("device", S.device);
    await pbRpc("pill_register", { dev: S.device, sub: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin" });
    syncNow();
  } catch (e) { console.warn(e); }
}
// Aktionen aus der Mitteilung („Eingenommen“, „In 15 Min.“) übernehmen
async function readInbox() {
  let items = []; try { items = await pbInboxTake(); } catch (e) { return; }
  if (!items.length) return;
  for (const it of items) {
    const at = new Date(it.slot), k = slotKey(at, hm(at));
    const sl = slotsOf(at).find(s => s.key === k); if (!sl) continue;
    if (it.type === "taken") mark(sl, sl.meds.filter(m => !it.meds || !it.meds.length || it.meds.includes(m.id)).filter(m => !entry(sl.key, m)), "taken");
    if (it.type === "snooze") { S.snooze[k] = it.until; save(); }
  }
  render();
}

/* ---------- Darstellung ---------- */
function applyTheme() {
  const t = S.theme === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : S.theme;
  document.documentElement.dataset.theme = t;
  $("#themeColor").content = t === "light" ? "#f6f2ee" : "#25303f";
  if (NATIVE) nativeBars(t !== "light");
}

function render() {
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  const app = $("#app");
  if (tab === "heute") app.innerHTML = viewToday();
  else if (tab === "mittel") app.innerHTML = viewMeds();
  else app.innerHTML = viewHistory();
  clearInterval(tick); tick = null;
  if (tab === "heute") { updateClock(); tick = setInterval(updateClock, 1000); }
}

function header(title, sub, extra = "") {
  return `<div class="hdr"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div><div class="icons">${extra}<button class="ic" data-act="settings" aria-label="Einstellungen">${IC.gear}</button></div></div>`;
}

function stockAlerts() {
  return S.meds.filter(m => m.stockMode && m.stockMode !== "off" && stockDue(m)).map(m => {
    const txt = m.stock != null ? `<b>${esc(m.name)}</b>: noch ${fmtNum(m.stock)} ${esc(unitFor(m, m.stock))}` : `<b>${esc(m.name)}</b> nachkaufen`;
    return `<div class="alert"><span class="dot"></span><span>${txt}</span><button data-act="refill" data-id="${m.id}">+ Packung</button></div>`;
  }).join("");
}

function viewToday() {
  const now = new Date();
  let h = header("Heute", fmtDay(now), `<button class="ic acc" data-act="new" aria-label="Neues Mittel">${IC.plus}</button>`);
  if (!S.meds.length) return h + `<div class="empty">Noch keine Mittel angelegt.<br>Leg dein erstes Mittel mit Dosis und Uhrzeiten an.<button class="btn" data-act="new">${IC.plus}Erstes Mittel anlegen</button></div>`;
  h += stockAlerts();
  const slots = [...slotsOf(addDays(now, -1)), ...slotsOf(now)];
  // überfällig: ältester offener Termin der letzten 3 Std.
  const due = slots.filter(sl => openMeds(sl).some(m => stateOf(sl, m) === "due"));
  if (due.length) {
    const sl = due[0], keys = due.map(x => x.key).join(",");
    const sz = Math.max(0, ...due.map(x => S.snooze[x.key] || 0));
    const rows = []; due.forEach(x => openMeds(x).filter(m => stateOf(x, m) === "due").forEach(m => rows.push({ x, m })));
    h += `<div class="ringwrap" id="ring" data-at="${sl.at.getTime()}">${ringSvg(0)}<div class="ringtxt"><div class="s">Einnahme überfällig seit</div><div class="big" id="clock">0:00:00</div><div class="w">${dayWord(sl.at)} um ${sl.time} Uhr</div></div></div>`;
    h += `<div class="card due">${rows.map(({ x, m }) => `<div class="inl" style="gap:12px;margin-bottom:8px"><div class="pill">${medIcon(m)}</div><div class="grow"><div class="nm">${esc(m.name)}</div><div class="ds">${esc(doseText(m))} · ${x.time}${m.stock != null ? " · noch " + fmtNum(m.stock) + " im Vorrat" : ""}</div></div></div>`).join("")}
      <button class="btn" data-act="take" data-slot="${keys}">${IC.check}Jetzt einnehmen</button>
      <div class="links"><button data-act="skip" data-slot="${keys}">✕ Auslassen</button><button data-act="snooze" data-slot="${keys}">↻ ${sz > Date.now() ? "Erinnert um " + hm(new Date(sz)) : "Verschieben"}</button></div></div>`;
  }
  // als Nächstes: kommende Termine untereinander in einem Kasten
  let next = slots.filter(sl => sl.at > now && openMeds(sl).length);
  if (!next.length) next = slotsOf(addDays(now, 1)).slice(0, 3);
  const rows = [];
  next.forEach(sl => openMeds(sl, now.getTime()).forEach(m => rows.push({ sl, m })));
  if (rows.length) {
    const tomorrow = next[0] && dkey(next[0].at) !== dkey(now);
    h += `<div class="lbl">${due.length ? "Danach" : "Als Nächstes"}${tomorrow ? " · morgen" : ""}</div><div class="card">` + rows.map(({ sl, m }) =>
      `<div class="item"><span class="tm acc">${sl.time}</span><div class="grow"><div class="nm">${esc(m.name)}</div><div class="ds">${esc(doseText(m))}</div></div><button class="chk" data-act="tick" data-slot="${sl.key}" data-id="${m.id}" aria-label="Eingenommen"></button></div>`).join("") + `</div>`;
  } else if (!due.length) h += `<div class="card calm">Für heute ist alles erledigt.</div>`;
  // erledigt heute
  const done = [];
  slotsOf(now).forEach(sl => sl.meds.forEach(m => { const e = entry(sl.key, m); if (e) done.push({ sl, m, e }); else if (stateOf(sl, m) === "missed") done.push({ sl, m, e: { s: "missed" } }); }));
  if (done.length) {
    h += `<div class="lbl grey">Heute erledigt</div><div class="card">` + done.map(({ sl, m, e }) =>
      `<div class="item done"><span class="tm">${sl.time}</span><div class="grow"><div class="nm">${esc(m.name)}</div><div class="ds">${e.s === "taken" ? "eingenommen um " + hm(new Date(e.at)) : e.s === "skipped" ? "ausgelassen" : "vergessen"}</div></div>` +
      (e.s === "missed" ? `<button class="chk" data-act="tick" data-slot="${sl.key}" data-id="${m.id}" aria-label="Doch eingenommen"></button>` :
       `<button class="chk ${e.s === "taken" ? "on" : "skip"}" data-act="untick" data-slot="${sl.key}" data-id="${m.id}" aria-label="Rückgängig">${e.s === "taken" ? IC.check : IC.skip}</button>`) + `</div>`).join("") + `</div>`;
  }
  return h;
}
const dayWord = d => dkey(d) === dkey(new Date()) ? "heute" : "gestern";
function ringSvg(frac) {
  let ticks = "";
  for (let i = 0; i < 60; i++) { const a = (i * 6 - 90) * Math.PI / 180; ticks += `<circle cx="${(118 + 113 * Math.cos(a)).toFixed(1)}" cy="${(118 + 113 * Math.sin(a)).toFixed(1)}" r="${i % 5 ? .9 : 1.6}"/>`; }
  const L = 628.3;
  return `<svg viewBox="0 0 236 236"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--acc)"/><stop offset="1" stop-color="var(--warn)"/></linearGradient></defs>
    <g transform="rotate(-90 118 118)"><circle cx="118" cy="118" r="100" fill="none" stroke="var(--track)" stroke-width="14"/>
    <circle id="ringArc" cx="118" cy="118" r="100" fill="none" stroke="url(#rg)" stroke-width="14" stroke-linecap="round" style="stroke-dasharray:${Math.max(1, frac * L)} ${L}"/></g>
    <g fill="var(--muted)" opacity=".5">${ticks}</g></svg>`;
}
function updateClock() {
  const r = $("#ring"); if (!r) return;
  const at = +r.dataset.at, ms = Date.now() - at;
  if (ms > LATE) { render(); return; }
  const s = Math.floor(ms / 1000);
  $("#clock").textContent = Math.floor(s / 3600) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
  const arc = $("#ringArc"); if (arc) arc.style.strokeDasharray = Math.max(1, ms / LATE * 628.3) + " 628.3";
}
// Ansicht neu zeichnen, wenn ein Termin fällig wird
setInterval(() => { if (tab === "heute" && !$("#ring")) { const now = Date.now(); const s = [...slotsOf(new Date())].some(sl => sl.at.getTime() <= now && now - sl.at.getTime() < 61e3); if (s) render(); } }, 30e3);

function viewMeds() {
  let h = header("Mittel", S.meds.length ? S.meds.length + (S.meds.length === 1 ? " Mittel" : " Mittel") : "", `<button class="ic acc" data-act="new" aria-label="Neues Mittel">${IC.plus}</button>`);
  if (!S.meds.length) return h + `<div class="empty">Noch keine Mittel angelegt.<button class="btn" data-act="new">${IC.plus}Mittel anlegen</button></div>`;
  h += stockAlerts();
  h += `<div class="card">` + S.meds.slice().sort((a, b) => a.name.localeCompare(b.name, "de")).map(m => {
    const d = stockDays(m);
    const st = m.stock != null ? `noch ${fmtNum(m.stock)} ${unitFor(m, m.stock)}${d != null ? " · reicht bis " + fmtShort(addDays(new Date(), d)) : ""}` : "";
    return `<button class="item" data-act="edit" data-id="${m.id}"><div class="pill">${medIcon(m)}</div><div class="grow"><div class="nm">${esc(m.name)}</div><div class="ds">${esc(doseText(m))}${(m.times || []).length ? " · " + m.times.join(", ") : ""}</div>${st ? `<div class="ds">${esc(st)}</div>` : ""}</div></button>`;
  }).join("") + `</div>`;
  return h;
}

/* ---------- Verlauf ---------- */
function histRange() {
  const today = startOfDay(new Date());
  if (hist.mode === "woche") { const end = addDays(today, hist.off * 7); return { from: addDays(end, -6), to: end }; }
  if (hist.mode === "monat") { const f = new Date(today.getFullYear(), today.getMonth() + hist.off, 1); return { from: f, to: new Date(f.getFullYear(), f.getMonth() + 1, 0) }; }
  if (hist.mode === "3m") { const end = addDays(today, hist.off * 91); return { from: addDays(end, -90), to: end }; }
  const f = new Date(today.getFullYear() + hist.off, 0, 1); return { from: f, to: new Date(f.getFullYear(), 11, 31) };
}
function dayStats(d, now) {
  let total = 0, taken = 0, ontime = 0, missed = 0, skipped = 0; const items = [];
  for (const sl of slotsOf(d)) for (const m of sl.meds) {
    const s = stateOf(sl, m, now);
    if (s === "upcoming" || s === "due") continue;
    total++; const e = entry(sl.key, m);
    if (s === "taken") { taken++; if (e.at - sl.at <= ONTIME) ontime++; }
    if (s === "missed") missed++;
    if (s === "skipped") skipped++;
    items.push({ sl, m, s, e });
  }
  return { total, taken, ontime, missed, skipped, items };
}
function miniRing(size, sw, frac, color, label, sub, big) {
  const r = (size - sw) / 2 - 1, L = 2 * Math.PI * r;
  return `<div class="rg"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="rotate(-90 ${size / 2} ${size / 2})"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${sw}"/>${frac > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" style="stroke-dasharray:${Math.max(0.01, Math.min(1, frac)) * L} ${L}"/>` : ""}</g></svg><div class="in" style="height:${size}px;font-size:${big ? 28 : 14}px;${big ? "font-weight:500;letter-spacing:-.02em" : ""}">${label}</div>${sub}</div>`;
}
function viewHistory() {
  const now = Date.now(), { from, to } = histRange(), today = startOfDay(new Date());
  let h = header("Verlauf", "");
  h += `<div class="tabs">${[["woche", "Woche"], ["monat", "Monat"], ["3m", "3 Monate"], ["jahr", "Jahr"]].map(([k, t]) => `<button data-act="hmode" data-m="${k}" class="${hist.mode === k ? "on" : ""}">${t}</button>`).join("")}</div>`;
  const label = hist.mode === "monat" ? from.toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : hist.mode === "jahr" ? String(from.getFullYear()) : fmtShort(from) + " – " + fmtShort(to);
  h += `<div class="range"><button data-act="hprev" aria-label="Zurück">←</button><span>${label}</span><button data-act="hnext" ${hist.off >= 0 ? "disabled" : ""} aria-label="Weiter">→</button></div>`;
  let T = 0, K = 0, O = 0, M = 0; const days = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const st = d > today ? null : dayStats(d, now);
    if (st) { T += st.total; K += st.taken; O += st.ontime; M += st.missed; }
    days.push({ d: new Date(d), st });
  }
  if (!S.meds.length) return h + `<div class="empty">Noch nichts aufgezeichnet.</div>`;
  h += `<div class="rings">${miniRing(76, 6, K ? O / K : 0, "var(--acc)", K ? Math.round(O / K * 100) + " %" : "–", "Pünktlich")}
    ${miniRing(128, 9, T ? K / T : 0, "url(#hg)", T ? Math.round(K / T * 100) + " %" : "–", "eingenommen", true)}
    ${miniRing(76, 6, T ? M / T : 0, "var(--warn)", String(M), "Vergessen")}</div>
    <svg width="0" height="0" style="position:absolute"><defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--acc2)"/><stop offset="1" stop-color="var(--acc)"/></linearGradient></defs></svg>`;
  // Punkte: voll = alles genommen, halb = teilweise, leer = nichts
  const cls = hist.mode === "woche" ? "" : hist.mode === "monat" ? "small" : "tiny";
  let pre = "";
  if (hist.mode === "monat") { const wd = (from.getDay() + 6) % 7; for (let i = 0; i < wd; i++) pre += `<div class="d"></div>`; }
  h += `<div class="dots ${cls}">${pre}${days.map(({ d, st }) => {
    let bg = "";
    if (st && st.total) { const f = st.taken / st.total; bg = f >= 1 ? "background:var(--acc)" : f > 0 ? `background:conic-gradient(var(--acc) 0 ${Math.round(f * 100)}%,var(--track) ${Math.round(f * 100)}% 100%)` : ""; }
    const isToday = dkey(d) === dkey(today);
    return `<div class="d"><i class="${!st || !st.total ? "none" : ""} ${isToday ? "today" : ""}" style="${bg}"></i>${hist.mode === "woche" ? WD[d.getDay()] : hist.mode === "monat" ? d.getDate() : ""}</div>`;
  }).join("")}</div>`;
  // Liste der Tage (neueste zuerst)
  const list = days.filter(x => x.st && x.st.items.length).reverse().slice(0, 31);
  if (!list.length) h += `<div class="card calm">In diesem Zeitraum gibt es noch keine Einträge.</div>`;
  list.forEach(({ d, st }) => {
    const dd = dkey(d) === dkey(today) ? "Heute" : dkey(d) === dkey(addDays(today, -1)) ? "Gestern · " + d.toLocaleDateString("de-DE", { weekday: "long" }) : d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
    h += `<div class="lbl">${dd}</div><div class="card">` + st.items.map(({ sl, m, s, e }) =>
      `<div class="item"><span class="tm">${sl.time}</span><div class="nm grow">${esc(m.name)}</div>${s === "taken" ? `<span class="st-ok">${hm(new Date(e.at))}</span>` : s === "skipped" ? `<span class="st-skip">ausgelassen</span>` : `<span class="st-miss">vergessen</span>`}</div>`).join("") + `</div>`;
  });
  return h;
}

/* ---------- Bearbeiten ---------- */
function openSheet(html) { const s = $("#sheet"); s.innerHTML = `<div class="grab"></div>` + html; s.hidden = false; $("#sheetBack").hidden = false; s.scrollTop = 0; }
function closeSheet() { $("#sheet").hidden = true; $("#sheetBack").hidden = true; edit = null; }

function openEdit(id) {
  const m = id ? S.meds.find(x => x.id === id) : null;
  edit = m ? JSON.parse(JSON.stringify(m)) : { id: uid(), name: "", amount: 1, unit: "Tabletten", times: ["08:00"], stock: null, stockMode: "rest", stockRest: 10, stockSpan: 30, stockSpanUnit: "d", created: Date.now(), isNew: true };
  drawEdit();
}
function drawEdit() {
  const m = edit;
  const modeField = {
    off: `<div class="hint">Keine Erinnerung an den Vorrat.</div>`,
    rest: `<div class="inl" style="margin-top:10px"><span>bei</span><input class="field" inputmode="decimal" data-f="stockRest" value="${m.stockRest ?? ""}"><span>${esc(m.unit || "Stück")} Rest</span></div>`,
    date: `<input class="field" style="margin-top:10px" type="date" data-f="stockDate" value="${m.stockDate || ""}">`,
    span: `<div class="inl" style="margin-top:10px"><span>nach</span><input class="field" inputmode="numeric" data-f="stockSpan" value="${m.stockSpan ?? ""}"><select class="field" data-f="stockSpanUnit" style="flex:0 0 120px"><option value="d"${m.stockSpanUnit === "d" ? " selected" : ""}>Tagen</option><option value="w"${m.stockSpanUnit === "w" ? " selected" : ""}>Wochen</option><option value="m"${m.stockSpanUnit === "m" ? " selected" : ""}>Monaten</option></select></div><div class="hint">gezählt ab der letzten neuen Packung.</div>`
  }[m.stockMode || "off"];
  openSheet(`<div class="hdr" style="margin:0 0 4px"><h2>${m.isNew ? "Neues Mittel" : esc(m.name) || "Mittel"}</h2>${m.isNew ? "" : `<button class="ic" data-act="del" aria-label="Löschen">${IC.trash}</button>`}</div>
    <label class="l">Name</label><input class="field" data-f="name" value="${esc(m.name)}" placeholder="z. B. Vitamin D" autocomplete="off">
    <label class="l">Dosis</label><div class="two"><input class="field" inputmode="decimal" data-f="amount" value="${m.amount != null ? fmtNum(m.amount) : ""}"><select class="field" data-act="unitsel">${UNITS.map(u => `<option value="${u[0]}"${(unitInfo(m.unit) || UNITS[0]) === u ? " selected" : ""}>${u[0]}</option>`).join("")}</select><input type="hidden" data-f="unit" value="${esc((unitInfo(m.unit) || UNITS[0])[0])}"></div>
    <label class="l">Erinnerungen</label>
    <div class="chips">${(m.times || []).map((t, i) => `<button class="chip" data-act="deltime" data-i="${i}">${t}<i>×</i></button>`).join("")}<label class="chip add">+ Uhrzeit<input type="time" data-act="addtime"></label></div>
    <label class="l">Vorrat</label>
    <div class="inl"><input class="field" inputmode="decimal" data-f="stock" value="${m.stock != null ? fmtNum(m.stock) : ""}" placeholder="optional"><span>${esc(m.unit || "Stück")} übrig</span></div>
    <label class="l">Erinnern, wenn der Vorrat zur Neige geht</label>
    <div class="seg">${[["off", "Aus"], ["rest", "Restbestand"], ["date", "Datum"], ["span", "Zeitspanne"]].map(([k, t]) => `<button data-act="smode" data-m="${k}" class="${(m.stockMode || "off") === k ? "on" : ""}">${t}</button>`).join("")}</div>
    ${modeField}
    <button class="btn" data-act="save" style="margin-top:22px">Speichern</button>
    <button class="btn danger" data-act="close" style="margin-top:4px">Abbrechen</button>`);
}
function readEdit() {
  document.querySelectorAll("#sheet [data-f]").forEach(el => {
    const f = el.dataset.f, v = el.value.trim();
    if (["amount", "stock", "stockRest", "stockSpan"].includes(f)) edit[f] = v === "" ? null : num(v);
    else edit[f] = v || (f === "stockDate" ? null : "");
  });
}
function saveEdit() {
  readEdit(); const m = edit;
  if (!m.name) { toast("Bitte einen Namen eingeben."); return; }
  if (m.amount == null || m.amount <= 0) m.amount = 1;
  m.unit = (m.unit || "").trim() || "Stück";
  m.times = [...new Set(m.times)].sort();
  if (m.stockMode === "rest" && m.stock == null) toast("Tipp: Trag den Vorrat ein, damit die Restbestand-Erinnerung funktioniert.", 5000);
  const i = S.meds.findIndex(x => x.id === m.id), old = S.meds[i];
  delete m.isNew;
  if (old && (old.stock !== m.stock)) { m.stockSince = dkey(new Date()); m.lowSince = null; }
  if (old && (old.stockMode !== m.stockMode || old.stockDate !== m.stockDate || old.stockSpan !== m.stockSpan || old.stockRest !== m.stockRest)) m.stockOk = false;
  if (!old) m.stockSince = dkey(new Date());
  updateLow(m);
  if (i >= 0) S.meds[i] = m; else S.meds.push(m);
  save(); closeSheet(); render();
  if (!S.push && !NATIVE) toast("Gespeichert. Tipp: Mitteilungen über ⚙ einschalten.", 4500);
}

async function openSettings() {
  const perm = NATIVE ? await nativePerm() : "Notification" in window ? Notification.permission : "denied";
  const on = NATIVE ? perm === "granted" : S.push && perm === "granted";
  const sounds = NATIVE ? [["still", "Ohne Ton"], ["vib", "Nur Vibration"], ["ton", "Mit Ton"]] : [["still", "Ohne Ton"], ["ton", "Mit Ton"]];
  const pushTxt = on ? "eingeschaltet" : perm === "denied" ? "vom Gerät blockiert" : "aus";
  openSheet(`<h2>Einstellungen</h2>
    <div class="lbl">Darstellung</div>
    <div class="seg">${[["auto", "Automatisch"], ["dark", "Nachtblau"], ["light", "Altrosa"]].map(([k, t]) => `<button data-act="theme" data-m="${k}" class="${S.theme === k ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="lbl">Mitteilungen</div>
    <div class="card"><div class="row-set"><div><div class="t">Erinnerungen${NATIVE ? "" : " per Push"}</div><div class="x">${pushTxt}</div></div>${on ? `<button class="a" data-act="testpush">Test senden</button>` : `<button class="a" data-act="push">Einschalten</button>`}</div></div>
    <div class="seg" style="margin-top:12px">${sounds.map(([k, t]) => `<button data-act="sound" data-m="${k}" class="${S.sound === k ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="lbl">Daten</div>
    <div class="card"><div class="row-set"><div><div class="t">Sicherung speichern</div><div class="x">Alle Mittel und der Verlauf als Datei</div></div><button class="a" data-act="export">Speichern</button></div>
    <div class="row-set"><div><div class="t">Sicherung laden</div><div class="x">Ersetzt die Daten auf diesem Gerät</div></div><label class="a" style="color:var(--acc);font-weight:600;font-size:14px">Laden<input type="file" accept="${NATIVE ? "" : "application/json,.json"}" data-act="import" hidden></label></div></div>
    <button class="btn ghost" data-act="close" style="margin-top:22px">Fertig</button>`);
}

/* ---------- Klicks ---------- */
const slotByKey = k => { const at = parseKey(k); return slotsOf(at).find(s => s.key === k); };
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) { if (e.target.id === "sheetBack") closeSheet(); return; }
  const a = b.dataset.act;
  if (b.tagName === "INPUT") return;
  if (a === "new") openEdit(null);
  else if (a === "edit") openEdit(b.dataset.id);
  else if (a === "settings") openSettings();
  else if (a === "close") closeSheet();
  else if (a === "save") saveEdit();
  else if (a === "del") { if (confirm(edit.name + " wirklich löschen? Der Verlauf dieses Mittels wird ausgeblendet.")) { S.meds = S.meds.filter(x => x.id !== edit.id); save(); closeSheet(); render(); } }
  else if (a === "deltime") { readEdit(); edit.times.splice(+b.dataset.i, 1); drawEdit(); }
  else if (a === "smode") { readEdit(); edit.stockMode = b.dataset.m; drawEdit(); }
  else if (a === "take" || a === "skip") { b.dataset.slot.split(",").map(slotByKey).filter(Boolean).forEach(sl => mark(sl, openMeds(sl).filter(m => stateOf(sl, m) === "due"), a === "take" ? "taken" : "skipped")); render(); if (a === "take") toast("Gut gemacht ✓"); }
  else if (a === "snooze") { b.dataset.slot.split(",").map(slotByKey).filter(Boolean).forEach(sl => snooze(sl, 15)); render(); }
  else if (a === "tick") { const sl = slotByKey(b.dataset.slot), m = S.meds.find(x => x.id === b.dataset.id); if (sl && m) { mark(sl, [m], "taken"); render(); } }
  else if (a === "untick") { const sl = slotByKey(b.dataset.slot), m = S.meds.find(x => x.id === b.dataset.id); if (sl && m) { unmark(sl, m); render(); } }
  else if (a === "refill") {
    const m = S.meds.find(x => x.id === b.dataset.id); if (!m) return;
    if (m.stock == null && m.stockMode !== "rest") { m.stockOk = true; m.stockSince = dkey(new Date()); if (m.stockMode === "date") m.stockDate = null; save(); render(); toast("Erledigt. Datum und Zeitspanne kannst du beim Mittel neu setzen."); return; }
    const v = prompt("Wie viele " + unitFor(m, 2) + " sind in der neuen Packung?", m.lastPack || "");
    const n = num(v); if (n && n > 0) { m.lastPack = n; refill(m, n); }
  }
  else if (a === "hmode") { hist = { mode: b.dataset.m, off: 0 }; render(); }
  else if (a === "hprev") { hist.off--; render(); }
  else if (a === "hnext") { if (hist.off < 0) hist.off++; render(); }
  else if (a === "sound") { S.sound = b.dataset.m; save(); if (NATIVE) nativeSchedule(); pbSet("sound", S.sound).catch(() => {}); openSettings(); }
  else if (a === "theme") { S.theme = b.dataset.m; save(); applyTheme(); openSettings(); }
  else if (a === "push" && NATIVE) { if (await nativeAsk()) { nativeSchedule(); openSettings(); } }
  else if (a === "testpush" && NATIVE) nativeTest();
  else if (a === "push") { if (await enablePush()) { toast("Mitteilungen sind eingeschaltet."); openSettings(); } }
  else if (a === "testpush") { try { await pbRpc("pill_test", { dev: S.device }); toast("Test kommt innerhalb einer Minute – du kannst die App dafür schließen.", 5000); } catch (err) { toast("Test fehlgeschlagen: " + err.message, 8000); } }
  else if (a === "export") {
    const json = JSON.stringify({ app: "pillen", version: 1, saved: new Date().toISOString(), meds: S.meds, log: S.log }, null, 1), name = "pillen-sicherung-" + dkey(new Date()) + ".json";
    if (NATIVE) { nativeExport(json, name); return; }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob), x = document.createElement("a"); x.href = url; x.download = name; x.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
});
document.addEventListener("change", async e => {
  const el = e.target;
  if (el.dataset.act === "addtime" && el.value) { readEdit(); if (!edit.times.includes(el.value)) edit.times.push(el.value); edit.times.sort(); drawEdit(); }
  if (el.dataset.act === "import" && el.files[0]) {
    try { const d = JSON.parse(await el.files[0].text()); if (d.app !== "pillen" || !Array.isArray(d.meds)) throw new Error("Keine Pillen-Sicherung");
      if (!confirm("Sicherung vom " + new Date(d.saved).toLocaleDateString("de-DE") + " laden? Die Daten auf diesem Gerät werden ersetzt.")) return;
      S.meds = d.meds; S.log = d.log || {}; save(); closeSheet(); render(); toast("Sicherung geladen.");
    } catch (err) { toast("Laden fehlgeschlagen: " + err.message, 6000); }
  }
  if (el.dataset.act === "unitsel" && edit) { readEdit(); edit.unit = el.value; drawEdit(); }
});
document.querySelectorAll(".nav button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; closeSheet(); render(); scrollTo(0, 0); }));

/* ---------- Start ---------- */
applyTheme();
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
render();
if (NATIVE) { fixSound(); nativeSetup(); }
else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", ev => { if (ev.data && ev.data.type === "inbox") readInbox(); else if (tab === "heute") render(); });
}
if (!NATIVE) { fixSound(); readInbox(); checkPush(); pbSet("sound", S.sound).catch(() => {}); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (!NATIVE) readInbox(); render(); queueSync(); } });
