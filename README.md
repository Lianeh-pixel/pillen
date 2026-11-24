# Pillenerinnerung

Eigene kleine App (PWA) zur Erinnerung an Tabletten: Mittel mit Dosis und Uhrzeiten, Abhaken, Verlauf, Vorrat mit Erinnerung.

- Adresse: https://lianeh-pixel.github.io/pillen/
- Daten (Mittel, Verlauf) liegen nur auf dem Gerät (localStorage). Sicherung über ⚙ → Daten.
- Push-Mitteilungen über das Supabase-Projekt „rezeptbuch“ mit eigenen Tabellen `pill_*` und der Funktion `pillen-push` (Quelltext unter `supabase/`). Dorthin gehen nur Name, Dosis, Uhrzeiten und offene Termine.
- Nach Änderungen `VERSION` in `sw.js` und `?v=` in `index.html` erhöhen.
