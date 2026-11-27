-- Pillenerinnerung: eigene Tabellen im Supabase-Projekt "rezeptbuch" (getrennt von den Rezept-Tabellen).
-- Die Mittel und der Verlauf liegen auf dem Gerät. Hier liegt nur, was für die Push-Mitteilungen nötig ist:
-- Push-Abo, Name/Dosis/Uhrzeiten der Mittel, offene Termine und der Termin für die Vorratserinnerung.
-- Zugriff nur über die Funktionen unten (geheime Geräte-ID), keine direkten Tabellenrechte.

create table if not exists public.pill_devices (
  id uuid primary key,
  endpoint text unique,
  sub jsonb,
  tz text not null default 'Europe/Berlin',
  updated timestamptz not null default now()
);
create table public.pill_meds (
  device uuid not null references public.pill_devices(id) on delete cascade,
  med_id text not null,
  name text not null,
  dose text not null default '',
  times text[] not null default '{}',
  stock_alert_at timestamptz,
  stock_text text,
  stock_sent boolean not null default false,
  primary key (device, med_id)
);
create table public.pill_slots (
  device uuid not null references public.pill_devices(id) on delete cascade,
  slot timestamptz not null,
  open text[],
  sent boolean not null default false,
  nag_sent boolean not null default false,
  snooze_until timestamptz,
  snooze_sent boolean not null default true,
  primary key (device, slot)
);
create table public.pill_outbox (
  id bigint generated always as identity primary key,
  device uuid not null references public.pill_devices(id) on delete cascade,
  payload jsonb not null,
  created timestamptz not null default now()
);
alter table public.pill_devices enable row level security;
alter table public.pill_meds enable row level security;
alter table public.pill_slots enable row level security;
alter table public.pill_outbox enable row level security;

-- Gerät anmelden / Push-Abo aktualisieren
create function public.pill_register(dev uuid, sub jsonb, tz text)
returns void language sql security definer set search_path = '' as $$
  insert into public.pill_devices (id, endpoint, sub, tz, updated) values (dev, sub->>'endpoint', sub, coalesce(tz,'Europe/Berlin'), now())
  on conflict (id) do update set endpoint = excluded.endpoint, sub = excluded.sub, tz = excluded.tz, updated = now();
$$;

-- Mittel (nur Name, Dosis, Uhrzeiten, Vorrats-Termin) abgleichen
create function public.pill_sync(dev uuid, meds jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  if not exists (select 1 from public.pill_devices where id = dev) then return; end if;
  delete from public.pill_meds where device = dev and med_id not in (select x->>'id' from jsonb_array_elements(meds) x);
  for m in select * from jsonb_array_elements(meds) loop
    insert into public.pill_meds (device, med_id, name, dose, times, stock_alert_at, stock_text)
    values (dev, m->>'id', m->>'name', coalesce(m->>'dose',''),
            coalesce((select array_agg(t) from jsonb_array_elements_text(m->'times') t), '{}'),
            (m->>'stockAt')::timestamptz, m->>'stockText')
    on conflict (device, med_id) do update set name = excluded.name, dose = excluded.dose, times = excluded.times,
      stock_text = excluded.stock_text,
      stock_sent = case when public.pill_meds.stock_alert_at is not distinct from excluded.stock_alert_at then public.pill_meds.stock_sent else false end,
      stock_alert_at = excluded.stock_alert_at;
  end loop;
end $$;

-- Offene Mittel eines Termins setzen (leer = alles eingenommen/ausgelassen)
create function public.pill_slot(dev uuid, slot timestamptz, open text[])
returns void language sql security definer set search_path = '' as $$
  insert into public.pill_slots (device, slot, open) select dev, slot, open where exists (select 1 from public.pill_devices where id = dev)
  on conflict (device, slot) do update set open = excluded.open;
$$;

-- Später erinnern
create function public.pill_snooze(dev uuid, slot timestamptz, minutes int)
returns void language sql security definer set search_path = '' as $$
  insert into public.pill_slots (device, slot, sent, snooze_until, snooze_sent)
  select dev, slot, true, now() + make_interval(mins => least(greatest(minutes,1),240)), false where exists (select 1 from public.pill_devices where id = dev)
  on conflict (device, slot) do update set snooze_until = excluded.snooze_until, snooze_sent = false, sent = true;
$$;

-- Fällige Mitteilungen in den Ausgang legen (läuft jede Minute über pg_cron)
-- due = zur Uhrzeit (nur einmal), snooze = "später erinnern", stock = Vorrat
create function public.pill_queue()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; kind text; names text;
begin
  delete from public.pill_slots where slot < now() - interval '3 days';
  delete from public.pill_outbox where created < now() - interval '1 hour';
  for r in
    with sl as (
      select m.device, ((d.day + t::time) at time zone dv.tz) as slot, m.med_id, m.name, m.dose
      from public.pill_meds m join public.pill_devices dv on dv.id = m.device and dv.sub is not null
      cross join lateral unnest(m.times) t
      cross join lateral (values ((now() at time zone dv.tz)::date), ((now() at time zone dv.tz)::date - 1)) d(day)
    ), g as (
      select sl.device, sl.slot, s.sent, s.nag_sent, s.snooze_until, s.snooze_sent, s.open,
        jsonb_agg(jsonb_build_object('id', sl.med_id, 'name', sl.name, 'dose', sl.dose) order by sl.name) filter (where s.open is null or sl.med_id = any(s.open)) as meds
      from sl left join public.pill_slots s on s.device = sl.device and s.slot = sl.slot
      where sl.slot <= now() and sl.slot > now() - interval '3 hours'
      group by sl.device, sl.slot, s.sent, s.nag_sent, s.snooze_until, s.snooze_sent, s.open
    )
    select * from g where meds is not null and jsonb_array_length(meds) > 0
  loop
    kind := null;
    if r.sent is null or not r.sent then kind := 'due';
    elsif r.snooze_until is not null and not r.snooze_sent and r.snooze_until <= now() then kind := 'snooze';
    end if;
    continue when kind is null;
    insert into public.pill_slots (device, slot, sent) values (r.device, r.slot, true)
      on conflict (device, slot) do update set sent = true,
        snooze_sent = public.pill_slots.snooze_sent or kind = 'snooze';
    select string_agg(x->>'name' || coalesce(' · ' || nullif(x->>'dose',''), ''), ', ') into names from jsonb_array_elements(r.meds) x;
    insert into public.pill_outbox (device, payload) values (r.device, jsonb_build_object(
      'title', 'Zeit für deine Tabletten',
      'body', names, 'slot', r.slot, 'meds', r.meds, 'kind', kind, 'tag', 'slot-' || extract(epoch from r.slot)::bigint));
    n := n + 1;
  end loop;
  for r in update public.pill_meds m set stock_sent = true
    from public.pill_devices dv where dv.id = m.device and dv.sub is not null
      and m.stock_alert_at is not null and not m.stock_sent and m.stock_alert_at <= now()
    returning m.device, m.med_id, m.name, m.stock_text
  loop
    insert into public.pill_outbox (device, payload) values (r.device, jsonb_build_object(
      'title', 'Vorrat: ' || r.name, 'body', coalesce(r.stock_text, 'Bald nachkaufen'), 'kind', 'stock', 'tag', 'stock-' || r.med_id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Ausgang für die Versand-Funktion abholen
create function public.pill_take()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare items jsonb;
begin
  with o as (delete from public.pill_outbox where id is not null returning device, payload)
  select coalesce(jsonb_agg(jsonb_build_object('payload', o.payload, 'sub', d.sub, 'device', d.id)), '[]'::jsonb) into items
  from o join public.pill_devices d on d.id = o.device;
  return items;
end $$;

create function public.pill_gone(dev uuid)
returns void language sql security definer set search_path = '' as $$ update public.pill_devices set sub = null, endpoint = null where id = dev $$;

-- Test-Mitteilung
create function public.pill_test(dev uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.pill_outbox (device, payload) select dev, jsonb_build_object('title','Test: Pillenerinnerung','body','So meldet sich die App, auch wenn sie geschlossen ist.','kind','test','tag','test') where exists (select 1 from public.pill_devices where id = dev and sub is not null);
$$;

revoke all on function public.pill_register(uuid, jsonb, text), public.pill_sync(uuid, jsonb), public.pill_slot(uuid, timestamptz, text[]),
  public.pill_snooze(uuid, timestamptz, int), public.pill_test(uuid), public.pill_queue(), public.pill_take(), public.pill_gone(uuid) from public, anon, authenticated;
grant execute on function public.pill_register(uuid, jsonb, text), public.pill_sync(uuid, jsonb), public.pill_slot(uuid, timestamptz, text[]),
  public.pill_snooze(uuid, timestamptz, int), public.pill_test(uuid) to anon, authenticated;
grant execute on function public.pill_take(), public.pill_gone(uuid), public.pill_queue() to service_role;

-- Jede Minute: fällige Mitteilungen vorbereiten und nur dann die Versand-Funktion anstoßen
select cron.schedule('pillen-push', '* * * * *', $$
  select net.http_post(url := 'https://ivuujkfocefzzquuhldd.supabase.co/functions/v1/pillen-push', body := '{}'::jsonb, timeout_milliseconds := 8000)
  where public.pill_queue() > 0 or exists (select 1 from public.pill_outbox)
$$);
