/* Gemeinsam für App und Service Worker: kleiner IndexedDB-Speicher und Aufrufe an Supabase. */
const PB_DB = "pillen";
function pbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(PB_DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("inbox", { autoIncrement: true }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function pbTx(store, mode, fn) {
  const db = await pbOpen();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => { db.close(); res(out); }; t.onerror = () => { db.close(); rej(t.error); };
  });
}
const pbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const pbGet = key => pbTx("kv", "readonly", s => pbReq(s.get(key)));
const pbSet = (key, val) => pbTx("kv", "readwrite", s => { s.put(val, key); });
const pbInboxAdd = item => pbTx("inbox", "readwrite", s => { s.add(item); });
const pbInboxTake = () => pbTx("inbox", "readwrite", async s => { const all = await pbReq(s.getAll()); s.clear(); return all; });

async function pbRpc(name, args) {
  const c = self.PB_CONFIG;
  const r = await fetch(c.supabaseUrl + "/rest/v1/rpc/" + name, {
    method: "POST", headers: { apikey: c.supabaseKey, Authorization: "Bearer " + c.supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error(name + ": " + r.status + " " + (await r.text()).slice(0, 200));
}
