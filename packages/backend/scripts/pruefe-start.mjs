/**
 * Laedt die gebaute Anwendung mit reinem Node - so, wie Vercel es tut.
 *
 * Warum das noetig ist: `tsc` prueft nur Typen, und die Diagnoseskripte laufen
 * unter `tsx`, das TypeScript-Quellen direkt ausfuehren kann. Beides uebersieht
 * einen Import, der zur Laufzeit nicht aufloesbar ist.
 *
 * Genau das ist passiert: das Backend importierte @poi-app/shared, dessen
 * `main` auf die TypeScript-Quelle zeigte. Build und Diagnose liefen sauber
 * durch, im Betrieb scheiterte dann der Start der gesamten Function mit
 * ERR_MODULE_NOT_FOUND - und damit jeder Endpunkt, auch die Anmeldung.
 *
 * Laeuft als letzter Schritt von `npm run build -w packages/backend`. Es wird
 * nur geladen und aufgebaut, nicht gelauscht und nichts abgefragt: eine
 * Datenbankverbindung braucht es dafuer nicht.
 */
const beginn = Date.now();

try {
  const { buildApp } = await import("../dist/app.js");
  const server = await buildApp();
  await server.ready();
  await server.close();
  console.log(`Startprüfung bestanden (${Date.now() - beginn} ms).`);
} catch (fehler) {
  console.error("");
  console.error("STARTPRÜFUNG FEHLGESCHLAGEN");
  console.error("");
  console.error("Die gebaute Anwendung lässt sich mit Node nicht laden. Im");
  console.error("Betrieb würde damit jeder Endpunkt mit HTTP 500 antworten.");
  console.error("");
  console.error(fehler);
  process.exit(1);
}
