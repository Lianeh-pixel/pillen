// Versand-Funktion der Pillenerinnerung (Web Push).
// GET  -> öffentlicher Schlüssel für die App (dieselben VAPID-Schlüssel wie beim Rezeptbuch-Timer)
// POST -> Ausgang (pill_outbox) verschicken; wird von pg_cron angestoßen, wenn etwas fällig ist
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { data: k, error: ke } = await db.rpc("push_keys");
    if (ke) throw ke;
    if (!k?.pub || !k?.key) return json({ error: "Keine Schlüssel" }, 500);
    if (req.method === "GET") return json({ pub: k.pub });
    webpush.setVapidDetails("https://lianeh-pixel.github.io/pillen/", k.pub, k.key);
    const { data, error } = await db.rpc("pill_take");
    if (error) throw error;
    let sent = 0;
    for (const it of data || []) {
      try {
        await webpush.sendNotification(it.sub, JSON.stringify(it.payload), { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.rpc("pill_gone", { dev: it.device });
        console.error("Push fehlgeschlagen", code, String(e));
      }
    }
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
