# Betrieb auf Vercel + Supabase

Ersetzt den bisherigen LAN-Betrieb auf dem Niederlassungs-Laptop. Frontend und
API laufen auf Vercel, Datenbank, Anmeldung, Dateiablage und Live-Updates bei
Supabase.

```
Browser ──► Vercel (Region fra1)
              ├─ statisch: packages/frontend/dist   (SPA + sw.js)
              └─ Function: api/[...path].ts         (Fastify, alle /api-Routen)
                            │
              ┌─────────────┼──────────────┬────────────────┐
              ▼             ▼              ▼                ▼
        Supabase Auth  Postgres      Storage          Realtime
                       (Pooler 6543) (plans,          (Tabelle
                                      attachments)     points)
```

---

## 1. Umgebungsvariablen

Vorlage: [`.env.example`](../.env.example) im Projektstamm. Für die lokale
Entwicklung eine `.env` daraus anlegen (ist gitignored), für den Betrieb
dieselben Werte im Vercel-Projekt unter *Settings → Environment Variables*
eintragen.

| Variable | Wo zu finden | Sichtbarkeit |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Transaction pooler** | geheim |
| `SUPABASE_URL` | Project Settings → API | geheim¹ |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API | **streng geheim** |
| `VITE_SUPABASE_URL` | derselbe Wert wie `SUPABASE_URL` | öffentlich |
| `VITE_SUPABASE_ANON_KEY` | Project Settings → API (anon/public) | öffentlich |
| `SUPABASE_JWT_SECRET` | nur bei älteren Projekten mit HS256-Signatur | geheim |

¹ technisch nicht geheim, wird aber nur serverseitig gebraucht.

**Mit der Supabase-Integration in Vercel** muss nichts davon von Hand angelegt
werden — der Code akzeptiert die Namen, die die Integration vergibt:

| erwartet | Ersatzname aus der Integration |
|---|---|
| `DATABASE_URL` | `POSTGRES_URL` |
| `VITE_SUPABASE_URL` | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY` |

Zu prüfen bleibt dort nur, dass `POSTGRES_URL` auf **Port 6543** zeigt und dass
die Variablen auch für *Preview* freigegeben sind, falls Preview-Deployments
genutzt werden — die Integration setzt sie standardmäßig nur für *Production*.

**Zwei Dinge, die erfahrungsgemäß schiefgehen:**

- **Port 6543, nicht 5432.** Der Direktanschluss (5432) hält je Verbindung eine
  eigene Postgres-Sitzung offen. Bei Serverless-Funktionen, die beliebig oft
  parallel starten, sind die verfügbaren Verbindungen damit sofort erschöpft.
  Der Transaction Pooler ist genau für diesen Fall gebaut.
- **Die `VITE_*`-Variablen werden zur Bauzeit fest ins Bundle eingesetzt.**
  Fehlen sie beim Build, entsteht eine App, die beim Anmelden meldet, sie sei
  nicht konfiguriert. Ein nachträgliches Setzen in Vercel wirkt erst nach einem
  erneuten Deployment.

---

## 2. Ersteinrichtung

Einmalig, aus dem Projektstamm mit gesetzter `.env`:

```bash
npm install
npm run db:migrate       # legt das Schema an (20 Migrationen)
npm run setup:storage    # legt die privaten Ablagen "plans" und "attachments" an
npm run seed:admin -- <email> <passwort> "<anzeigename>"
```

`seed:admin` legt den Nutzer sowohl in Supabase Auth als auch in der
Profiltabelle `users` an. Ohne diesen Schritt gibt es kein Konto, mit dem man
sich anmelden könnte — eine Selbstregistrierung existiert bewusst nicht.

Weitere Nutzer danach im Admin-Menü der laufenden Anwendung anlegen
(Rollen: `extern`, `mitarbeiter`, `admin`).

---

## 3. Vercel-Projekt

| Einstellung | Wert |
|---|---|
| Framework Preset | Other |
| Root Directory | Projektstamm (nicht `packages/frontend`) |
| Build Command | aus [`vercel.json`](../vercel.json) — nicht überschreiben |
| Output Directory | `packages/frontend/dist` |
| Region | `dub1` (Dublin) |

Alles Nötige steht in `vercel.json`: Build beider Pakete, Auslieferung der SPA,
Weiterleitung aller Pfade außer `/api/*` auf `index.html`, und `no-store` für
`sw.js`, damit ein neuer Service Worker nicht hinter einer alten
zwischengespeicherten Fassung hängen bleibt.

Das Supabase-Projekt sollte in der EU liegen (`eu-central-1`, Frankfurt) — es
werden Projekt-, Kunden- und Personendaten verarbeitet.

---

## 4. Lokale Entwicklung

```bash
npm run dev:backend     # Fastify auf Port 3001
npm run dev:frontend    # Vite auf Port 5173, reicht /api an 3001 weiter
```

Beide arbeiten gegen dasselbe Supabase-Projekt wie der Betrieb. Wer getrennte
Daten will, legt ein zweites Supabase-Projekt an und hinterlegt dessen Werte in
der lokalen `.env`.

---

## 5. Was sich gegenüber dem LAN-Betrieb geändert hat

| Vorher | Jetzt |
|---|---|
| SQLite-Datei `data.sqlite` auf dem Laptop | Postgres bei Supabase |
| Ordner `packages/backend/uploads/` | Supabase Storage, privat, signierte URLs |
| Eigener WebSocket-Server für Live-Updates | Supabase Realtime auf der Tabelle `points` |
| Eigenes JWT, bcrypt, `POST /api/auth/login` | Supabase Auth; die App liest ihr Profil über `GET /api/me` |
| Fastify lieferte auch das Frontend aus | Vercel liefert die statischen Dateien |
| Autostart-Skripte, Firewall-Regel, Task Scheduler | entfällt |

Der Offline-Modus bleibt unverändert erhalten: Der Service Worker legt die
App-Hülle und die Plan-PDFs weiterhin unter dem stabilen Pfad
`/api/plans/:id/file` ab; dass dahinter jetzt eine Weiterleitung auf Supabase
Storage steckt, ist für ihn unsichtbar.

### Sicherheit

Supabase veröffentlicht jede Tabelle des `public`-Schemas automatisch über
PostgREST. Migration `0020_rls_and_realtime.sql` schaltet deshalb auf **allen**
Tabellen Row Level Security ein. Ohne Policy bedeutet das: kein Zugriff für
`anon` und `authenticated`, auch nicht mit dem öffentlichen anon-Key. Einzige
Ausnahme ist eine Lese-Policy auf `points`, ohne die Realtime nichts ausliefern
dürfte; sie bildet dieselbe Logik ab wie `src/authorization.ts`.

Die Anwendung selbst arbeitet mit dem `service_role`-Schlüssel und umgeht RLS —
die eigentliche Rechteprüfung bleibt unverändert im Backend. Der
`service_role`-Schlüssel gehört ausschließlich in die Vercel-Umgebung und darf
niemals im Frontend landen.

---

## 6. Abnahme

Nach dem ersten Deployment der Reihe nach prüfen:

1. Anmeldung mit dem angelegten Admin-Konto.
2. Projekt anlegen (mit Projektnummer).
3. Plan-PDF **über 4,5 MB** hochladen — prüft gezielt, dass der Upload am
   Backend vorbei direkt zu Supabase Storage läuft. Vercel würde einen so
   großen Request-Body ablehnen.
4. Plan öffnet sich im Viewer; Ticket setzen; Foto anhängen; Anhang wird wieder
   angezeigt.
5. Mehrere Tickets zügig hintereinander anlegen — die Nummern laufen lückenlos
   und ohne Dubletten.
6. Zwei Browser parallel: Ticket in A anlegen und verschieben, erscheint in B
   ohne Neuladen.
7. Je ein Nutzer `extern` und `mitarbeiter`: `extern` sieht ausschließlich die
   ihm zugewiesenen Tickets — in der Liste, im CSV-Export und im Offline-Paket.
8. Projekt offline verfügbar machen, Netzwerk in den Entwicklertools trennen,
   Plan öffnen, Ticket anlegen, wieder verbinden — der Abgleich läuft durch.
9. CSV-Export und PDF-Abnahmeprotokoll erzeugen.

Es gibt im Projekt kein Test-Framework; diese Kette ist die Absicherung.

---

## 7. Grenzen des kostenlosen Tarifs

- **Supabase Free** pausiert die Datenbank nach 7 Tagen ohne Zugriff; sie muss
  dann im Dashboard manuell reaktiviert werden. 500 MB Datenbank und 1 GB
  Dateiablage sind bei Bauplänen und Baustellenfotos schnell erreicht.
- **Vercel Hobby** ist laut Lizenzbedingungen nur für nicht-kommerzielle
  Nutzung zugelassen.

Für den Produktivbetrieb ist ein Wechsel auf die Pro-Tarife nötig
(zusammen rund 45 USD/Monat).
