# Betrieb auf Vercel + Supabase

Ersetzt den bisherigen LAN-Betrieb auf dem Niederlassungs-Laptop. Frontend und
API laufen auf Vercel, Datenbank, Anmeldung, Dateiablage und Live-Updates bei
Supabase.

```
Browser ──► Vercel (Region dub1)
              ├─ statisch: packages/frontend/dist   (SPA + sw.js)
              └─ Function: api/index.ts             (Fastify, alle /api-Routen)
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
| `RESEND_API_KEY` | Resend → API Keys | **streng geheim** |
| `MAIL_FROM` | Absenderadresse, siehe Abschnitt 5 | öffentlich |
| `APP_BASE_URL` | Adresse der Anwendung, ohne Schrägstrich am Ende | öffentlich |
| `CRON_SECRET` | selbst vergeben, lang und zufällig | **streng geheim** |

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
npm run db:migrate       # legt das Schema an (24 Migrationen)
npm run setup:storage    # legt die privaten Ablagen "plans" und "attachments" an
npm run seed:admin -- <email> "<anzeigename>" [rolle] [--password=<passwort>]
```

`seed:admin` legt den Nutzer sowohl in Supabase Auth als auch in der
Profiltabelle `users` an. Ohne diesen Schritt gibt es kein Konto, mit dem man
sich anmelden könnte — eine Selbstregistrierung existiert bewusst nicht.

Ohne `--password` wird ein Passwort erzeugt und **nur** in
`ADMIN-ZUGANGSDATEN.txt` geschrieben (gitignored), nicht auf die Konsole.

**Konto schon im Supabase-Dashboard angelegt?** Dann bindet `seed:admin` es an
und trägt nur die Rolle nach; das Passwort bleibt unangetastet. Dieser Schritt
ist trotzdem nötig: Supabase kennt die anwendungseigenen Rollen nicht. Ein
Konto ohne Profilzeile bekommt beim ersten Anmelden die Standardrolle `extern`
und damit kaum Rechte.

### Selbstregistrierung

Auf dem Anmeldebildschirm gibt es einen Reiter „Registrieren". Ein so
angelegtes Konto bekommt die niedrigste Rolle (`extern`) und ist **gesperrt**,
bis ein Admin es freischaltet — bis dahin scheitert jede Anmeldung mit einem
entsprechenden Hinweis. Die Freischaltung erfolgt im Admin-Menü unter
„Nutzer": offene Anträge stehen dort ganz oben. „Ablehnen" entfernt das Konto
vollständig; ein bloß gesperrtes Konto liefe sonst bei jedem Anmeldeversuch in
dieselbe Meldung, ohne dass sich etwas ändert.

Auch nach der Freischaltung sieht ein `extern`-Konto nichts, solange es keinem
Projekt zugeordnet ist.

In Supabase muss dafür unter *Authentication → Sign In / Providers* die
Registrierung erlaubt und die E-Mail-Bestätigung eingeschaltet sein.

Prüfen lässt sich die ganze Kette mit `npm run diagnose:registrierung` — das
Skript legt zwei Wegwerf-Konten an, spielt Sperre und Freischaltung durch und
räumt hinterher auf.

### Rolle ändern

```bash
npm run set:role -- <email> <extern|mitarbeiter|admin>
```

Die Oberfläche setzt die Rolle nur beim **Anlegen** eines Nutzers; danach wird
sie nur noch angezeigt. Wer ein Konto direkt im Supabase-Dashboard anlegt,
bekommt beim ersten Anmelden automatisch `extern` — das fällt nur dadurch auf,
dass fast nichts sichtbar ist. Dieses Skript ist der Weg, das zu korrigieren.

### Passwort setzen oder zurücksetzen

```bash
npm run set:password -- <email> [--password=<passwort>]
```

Ohne `--password` wird eines erzeugt und in `ADMIN-ZUGANGSDATEN.txt`
geschrieben. Der Befehl beendet anschließend alle bestehenden Sitzungen des
Kontos — wichtig beim Zurücksetzen wegen eines abgeflossenen Zugangs, denn ein
Refresh-Token bliebe sonst unbegrenzt gültig.

Die Anwendung selbst hat keine Funktion zum Ändern des eigenen Passworts, und
ein „Passwort vergessen"-Versand ist nicht eingerichtet (dafür bräuchte das
Supabase-Projekt einen SMTP-Server). Dieses Skript ist deshalb der vorgesehene
Weg. Als Notbehelf funktioniert außerdem der Magic Link aus dem
Supabase-Dashboard.

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

## 5. Erinnerungsmails zu Fälligkeiten

Ein täglicher Auftrag um **05:00 UTC** (Eintrag `crons` in
[`vercel.json`](../vercel.json)) ruft `GET /api/cron/due-date-digest` auf und
verschickt **eine** Mail je Person mit bis zu drei Abschnitten:

| Abschnitt | Auswahl | Wiederholung |
|---|---|---|
| Überfällig | Frist liegt vor heute | höchstens **einmal pro Woche** |
| Heute fällig | Frist ist heute | einmal je Frist |
| Demnächst fällig | Frist in den nächsten 3 Tagen | einmal je Frist |

Berücksichtigt werden nur offene Tickets (`open`, `in_bearbeitung`, `geprueft`)
aus nicht archivierten Projekten. Empfänger sind die zuständige Person und alle
Admins — Letztere auch bei Tickets ohne Zuordnung, die sonst niemanden
erreichen würden.

**Doppelversand** ist über die Spalte `notifications.dedupe_key` ausgeschlossen
(Migrationen `0022`/`0023`). Der Schlüssel enthält die Frist selbst: wird ein Ticket
verschoben, wird die neue Frist wieder gemeldet. Der Anspruch auf eine Zeile
wird **vor** dem Absenden eingetragen und bei einem Fehler zurückgenommen —
zwei gleichzeitig laufende Aufrufe können deshalb nicht dieselbe Mail zweimal
verschicken.

**Absender.** Solange in Resend keine eigene Domäne verifiziert ist, muss
`MAIL_FROM` auf der Testdomäne `onboarding@resend.dev` stehen bleiben, und
Resend liefert nur an die Adresse des Resend-Kontos aus. Für den echten Betrieb
ist eine verifizierte Domäne nötig (Resend → Domains, DNS-Einträge setzen),
danach etwa `POI-App <poi@caverion.example>`.

**Abmelden.** Jedes Konto kann die Erinnerungen für sich abschalten — Umschlag-
Schaltfläche oben rechts. Der Wert steht in `users.email_benachrichtigungen`.

**Prüfen:**

```bash
npm run diagnose:mail                 # Trockenlauf, verschickt nichts
npm run diagnose:mail -- --senden     # verschickt echte Mails
```

Das Skript legt ein eigenes Projekt mit vier Tickets an (überfällig, heute,
in zwei Tagen, in zwei Wochen) plus einem erledigten, prüft die Auswahl, den
Doppelversandschutz und die erneute Meldung nach einer verschobenen Frist —
und räumt hinterher auf.

Von Hand auslösen lässt sich der Lauf auch im Betrieb:

```bash
curl -X POST "https://<projekt>.vercel.app/api/cron/due-date-digest?trockenlauf=1" \
     -H "Authorization: Bearer $CRON_SECRET"
```

Ohne gesetztes `CRON_SECRET` antwortet der Endpunkt mit **401** — ein offener
Endpunkt, der Mails auslöst, wäre aus dem Netz beliebig oft aufrufbar. Ob
Schlüssel und Geheimnis gesetzt sind, zeigt `/api/health` unter
`konfiguration.mailversand` bzw. `konfiguration.cronGeheimnis`, ohne die Werte
selbst preiszugeben.

> **Vercel Hobby** erlaubt nur *einen* Cron-Lauf pro Tag; die Uhrzeit kann um
> bis zu eine Stunde abweichen. Für einen festen Zeitpunkt ist der Pro-Tarif
> nötig.

---

## 6. Projekte archivieren und löschen

Zwei getrennte Vorgänge — der Umweg über das Archiv ist der eigentliche Schutz.

**Archivieren** kann jeder Admin, in den Projekt-Einstellungen oder im
Admin-Menü unter *Projekte* (dort auch mehrere auf einmal). Ein archiviertes
Projekt bleibt vollständig erhalten und einsehbar, lässt sich aber nicht mehr
bearbeiten: keine neuen Tickets, keine Änderungen, keine neuen Zeichnungen.
Zurückholen ist jederzeit möglich.

Der Schreibschutz sitzt in **einer** Funktion — `requireProjectWritable` in
[authorization.ts](../packages/backend/src/authorization.ts) — und ist in allen
18 schreibenden Endpunkten eingehängt. Verteilte Einzelprüfungen wären genau
die Stelle, an der später eine vergessen wird.

**Endgültig löschen** geht nur aus dem Archiv heraus, nur für Admins, und nur
nach Abtippen des Projektnamens. Gelöscht wird alles: Tickets, Kommentare,
Verlauf, Zeichnungen, Ordner, projekteigene Kategorien und Exportvorlagen,
Mitgliedschaften, Nummernzähler, Änderungsprotokoll — **und die Dateien in
Supabase Storage**. Projektübergreifende Vorlagen (`project_id IS NULL`)
bleiben stehen; sie gehören allen Projekten.

Reihenfolge: erst die Dateipfade sammeln, dann die Zeilen in **einer**
Transaktion löschen, danach die Dateien. Bricht das Aufräumen der Dateien ab,
bleibt eine verwaiste Datei liegen — ärgerlich, aber harmlos. Andersherum gäbe
es Tickets mit Fotos, die sich nicht mehr öffnen lassen.

```bash
npm run diagnose:loeschen
```

Legt ein Projekt mit Zeichnung, Ordner, Ticket, Anhang, Kommentar,
Benachrichtigung, Exportvorlage und Änderungsprotokoll an, archiviert es, holt
es zurück, löscht endgültig und zählt anschließend **13 Tabellen** einzeln
nach. Zusätzlich wird geprüft, dass projektübergreifende Vorlagen den Vorgang
überstehen.

---

## 7. Planansicht und Symbole

### Die Planansicht trennt Sehen und Zeichnen

Der Betrachter hat zwei Ebenen, und diese Trennung ist der Grund, warum sich
Zoomen und Schwenken flüssig anfühlen:

```
.plan-flaeche      der sichtbare Ausschnitt, fängt alle Eingaben ab
  .plan-buehne     feste CSS-Größe (Seite im Einpassmaßstab),
                   bewegt wird sie über transform
    Grundebene     die ganze Seite in der Auflösung für 100 %
    Scharfebene    nur der sichtbare Ausschnitt, punktgenau
    Nadeln         in Prozent, gegen den Zoom skaliert
```

Sehen ist eine CSS-Transformation und wirkt sofort. Geschärft wird erst
150 ms nach der letzten Bewegung — bis dahin skaliert der Browser das
vorhandene Bild. Weil die Größe der Bühne dabei gleich bleibt, verschiebt das
Schärfen nichts.

Vorher trug eine Größe beides: sie bestimmte den Anblick **und** die Auflösung
des Canvas. Deshalb hing jede Bewegung am Neuzeichnen, das Layout änderte sich
dabei, und der Ausschnitt sprang.

### Warum zwei Ebenen und nicht eine

**Die ganze Seite in voller Auflösung geht nicht.** Ein A1-Plan bei 800 % auf
einem Bildschirm mit doppelter Punktdichte bräuchte rund 24 000 × 17 000
Bildpunkte — vierhundert Millionen, etwa 1,6 GB. Kein Browser gibt das her; er
liefert dann eine leere Fläche.

Deshalb zeichnet die **Scharfebene** nur den sichtbaren Ausschnitt, mit 20 %
Rand. Der ist nie größer als der Bildschirm, egal wie weit man hineinzoomt —
der Bedarf bleibt damit unabhängig vom Zoom konstant bei etwa 3900 × 2400
Bildpunkten. pdf.js zeichnet ihn über den Parameter `transform`, der die
Zeichnung so verschiebt, dass die linke obere Ecke des Ausschnitts auf dem
Canvas bei (0,0) landet.

Die **Grundebene** darunter ist die ganze Seite in der Auflösung für 100 %.
Bei starkem Zoom ist sie unscharf, liegt aber immer sofort vor — beim Schwenken
entsteht deshalb kein weißes Loch, solange die Scharfebene nachzieht.

Der Zwischenstand ohne Scharfebene wäre nicht tragbar gewesen: dort wurde die
ganze Seite gezeichnet und bei Überschreiten der Canvas-Grenze der Maßstab
gekürzt. Bei 800 % blieben davon rund 43 % der nötigen Auflösung übrig —
sichtbar als grobe Klötzchen.

Dass `transform` genau den gemeinten Ausschnitt liefert, ist im Browser gegen
eine Vollauflösung geprüft worden: von 800 000 verglichenen Farbwerten wich
**keiner** ab, während dieselbe Prüfung ohne `transform` in 585 042 Werten
abweicht. Die Zusage gilt also nicht bloß laut Dokumentation.

Die Rechnung dazu steht in `packages/frontend/src/utils/planAnsicht.ts` — ohne
jeden Zugriff auf das Dokument, damit sie prüfbar bleibt:

```bash
npm run diagnose:ansicht
```

Prüft ohne Browser, dass der Punkt unter dem Zeiger beim Zoomen stehen bleibt,
dass zehnmal hinein und heraus wieder bei 100 % landet, dass sich der Plan
nicht aus dem Bild schieben lässt, dass Rad- und Trackpad-Ausschläge
gleichwertig umgerechnet werden, dass das Sichtfenster das Sichtbare stets
vollständig abdeckt und dass in jedem Maßstab punktgenau gezeichnet wird.

Eine Einschränkung, die kein Fehler ist: solange die Seite schmaler als die
Zeichenfläche ist, wird sie mittig gestellt — dort kann der Punkt unter dem
Zeiger nicht zusätzlich festgehalten werden. Sobald die Seite breiter als die
Fläche ist, stimmt es auf fünf Nachkommastellen.

**Mehrseitige PDFs werden nicht unterstützt.** Angezeigt wird Seite 1, und neue
Tickets werden mit `page_number = 1` geschrieben. Hat ein Plan mehr Seiten,
steht das als Hinweis in der Zoomleiste — es soll nicht stillschweigend
untergehen.

### Symbole

Alle Symbole der Oberfläche kommen aus `packages/frontend/src/components/Zeichen.tsx`:
eingebettete SVG-Pfade, eine Strichstärke, Farbe über `currentColor`.

Der Ton kommt aus der Umgebung, nicht fest aus dem hellen Farbsatz. `.icon-btn`
liest `--icon-farbe`, und `.app-sidebar` setzt diese Variable einmal auf die
Leistentöne. Wer eine weitere dunkle Fläche baut, setzt dort dieselben zwei
Variablen — jeder Symbolknopf darin folgt dann automatisch.

Das war vorher ein echter Fehler: `.icon-btn` stand fest auf
`--color-text-muted`, einem Ton für helle Flächen. Auf dem Leistengrund ergab
das rund 2,9:1 statt der nötigen 4,5:1. Der Papierkorb blieb trotzdem sichtbar,
weil 🗑 ein Farb-Emoji ist und `color` ignoriert — Stift und Plus daneben
verschwanden.

Emoji bleiben nur dort, wo sie **Daten** sind: die selbst gewählten
Kategoriezeichen auf den Nadeln.

---

## 8. Was sich gegenüber dem LAN-Betrieb geändert hat

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

## 9. Abnahme

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
10. Erinnerungsmail von Hand auslösen (Abschnitt 5) — erst mit
    `?trockenlauf=1`, dann echt. Anschließend ein zweites Mal: es darf nichts
    mehr rausgehen.

Es gibt im Projekt kein Test-Framework; diese Kette ist die Absicherung.

---

## 10. Grenzen des kostenlosen Tarifs

- **Supabase Free** pausiert die Datenbank nach 7 Tagen ohne Zugriff; sie muss
  dann im Dashboard manuell reaktiviert werden. 500 MB Datenbank und 1 GB
  Dateiablage sind bei Bauplänen und Baustellenfotos schnell erreicht.
- **Vercel Hobby** ist laut Lizenzbedingungen nur für nicht-kommerzielle
  Nutzung zugelassen.

Für den Produktivbetrieb ist ein Wechsel auf die Pro-Tarife nötig
(zusammen rund 45 USD/Monat).
