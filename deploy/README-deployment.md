# Deployment auf Apache (NF-401 / NF-402)

## 1. Frontend bauen

```
npm run build:frontend
```

Ergebnis liegt in `packages/frontend/dist/`. Diesen Ordner 1:1 nach
`/var/www/poi-app/frontend-dist` (oder den in `poi-app.conf` konfigurierten Pfad) kopieren.

## 2. Backend bauen und als Dauerprozess starten

```
npm run build:backend
```

Ergebnis liegt in `packages/backend/dist/`. Auf dem Zielserver z.B. mit `pm2`:

```
pm2 start packages/backend/dist/server.js --name poi-app-backend
```

Oder als systemd-Service (Linux-Zielserver), der `node dist/server.js` im Verzeichnis
`packages/backend` mit den Umgebungsvariablen `PORT=3001` und `JWT_SECRET=<zufaelliger-string>`
ausfuehrt und bei Absturz automatisch neu startet.

Wichtig: `JWT_SECRET` muss auf dem Zielserver gesetzt werden (der Code-Default ist nur fuer
lokale Entwicklung gedacht und darf nicht produktiv verwendet werden).

## 3. Erste Nutzer anlegen

Das System ist ein geschlossenes System ohne Selbstregistrierung (siehe Lastenheft-Interpretation
im Plan). Nutzer werden ueber das Seed-Skript angelegt:

```
npm run seed:admin -w packages/backend -- <email> <passwort> [anzeigename]
```

## 4. Apache konfigurieren

- Module aktivieren: `proxy`, `proxy_http`, `proxy_wstunnel`, `rewrite`, `ssl`, `headers`
- `deploy/apache/poi-app.conf` als Vorlage nach `/etc/apache2/sites-available/` kopieren,
  `ServerName`, Zertifikatspfade und `DocumentRoot` anpassen
- `a2ensite poi-app` und `systemctl reload apache2`

## 5. Bekannte Stolperfallen

- **WebSocket-Proxy**: `mod_proxy_wstunnel` muss geladen sein, sonst schlaegt der
  Upgrade-Handshake fuer Echtzeit-Updates (FA-403) fehl. Mit
  `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" https://.../ws` testbar,
  sobald der WebSocket-Endpunkt existiert (WP11).
- **Dateigroesse fuer PDF-Uploads**: Apache limitiert Request-Body-Groessen ueber
  `LimitRequestBody` (Default meist ausreichend, aber bei sehr grossen Plaenen pruefen).
- **HTTPS ist Pflicht (NF-402)**: Ohne gueltiges Zertifikat (z.B. via certbot/Let's Encrypt)
  funktioniert der produktive Zugriff nicht.

## 6. Verifikationshinweis (Entwicklungsumgebung)

Diese Config wurde in der Entwicklungsumgebung **nicht** gegen ein echtes Apache getestet,
da die Entwicklungsmaschine auf Windows ARM64 laeuft und Apache HTTP Server dafuer offiziell
keine Windows-Binaries bereitstellt. Stattdessen wurde verifiziert:

- Der Production-Build (`packages/frontend/dist`) liefert eine funktionsfaehige statische
  Seite aus (per lokalem Static-File-Server getestet).
- Backend-API ist unabhaengig erreichbar und liefert korrekte Responses.
- Die Proxy-/Routing-Logik (welcher Pfad geht wohin) wurde mit einem einfachen Node-Reverse-Proxy
  nachgebildet und funktional gegengeprueft (siehe Testlauf im Projektverlauf).

**Vor dem produktiven Go-Live sollte diese Config einmalig gegen ein echtes Apache
(Zielserver oder eine x86/x64-Testumgebung) verifiziert werden** — insbesondere der
WebSocket-Proxy-Pfad, sobald WP11 (Echtzeit-Updates) umgesetzt ist.
