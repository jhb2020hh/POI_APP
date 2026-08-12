/**
 * Duenner Zugang zur Resend-API.
 *
 * Bewusst ueber fetch statt ueber das offizielle SDK: gebraucht wird ein
 * einziger Endpunkt, und jede Abhaengigkeit weniger ist ein Kaltstart weniger
 * zu laden. Node 22 bringt fetch mit.
 *
 * Nichts in diesem Modul wirft beim Laden - der Mailversand darf die Anwendung
 * nicht mitreissen, wenn der Schluessel fehlt (dieselbe Lehre wie bei
 * supabase.ts und db/connection.ts).
 */

const RESEND_ENDPUNKT = "https://api.resend.com/emails";

/**
 * Resend erlaubt auf den kleinen Tarifen 2 Anfragen je Sekunde. Der Versand
 * wartet deshalb zwischen zwei Mails - lieber ein paar Sekunden laenger als
 * eine 429 mitten im Lauf.
 */
const PAUSE_ZWISCHEN_MAILS_MS = 600;

export const isMailConfigured = Boolean(process.env.RESEND_API_KEY);

/** Absender. Ohne verifizierte eigene Domaene nimmt Resend nur die Testadresse an. */
function absender(): string {
  return process.env.MAIL_FROM ?? "POI-App <onboarding@resend.dev>";
}

/** Basisadresse fuer Links in den Mails, ohne abschliessenden Schraegstrich. */
export function anwendungsAdresse(): string {
  const wert = process.env.APP_BASE_URL ?? "";
  return wert.replace(/\/+$/, "");
}

export interface MailEntwurf {
  an: string;
  betreff: string;
  html: string;
  text: string;
}

export class MailFehler extends Error {
  status: number;

  constructor(status: number, nachricht: string) {
    super(nachricht);
    this.name = "MailFehler";
    this.status = status;
  }
}

function warte(ms: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, ms));
}

/**
 * Verschickt eine einzelne Mail und liefert die Resend-Kennung zurueck.
 *
 * Bei 429 (Taktgrenze) wird genau einmal nachgefasst. Alles andere wird
 * durchgereicht: der Aufrufer entscheidet, ob er den Doppelversandschutz
 * wieder zuruecknimmt.
 */
export async function sendeMail(entwurf: MailEntwurf): Promise<string> {
  const schluessel = process.env.RESEND_API_KEY;
  if (!schluessel) {
    throw new MailFehler(0, "RESEND_API_KEY ist nicht gesetzt");
  }

  for (let versuch = 0; versuch < 2; versuch += 1) {
    const antwort = await fetch(RESEND_ENDPUNKT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${schluessel}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: absender(),
        to: [entwurf.an],
        subject: entwurf.betreff,
        html: entwurf.html,
        text: entwurf.text,
      }),
    });

    if (antwort.ok) {
      const daten = (await antwort.json()) as { id?: string };
      return daten.id ?? "";
    }

    const rumpf = await antwort.text();
    if (antwort.status === 429 && versuch === 0) {
      await warte(2000);
      continue;
    }
    throw new MailFehler(antwort.status, `Resend antwortete ${antwort.status}: ${rumpf}`);
  }

  // Nicht erreichbar - die Schleife endet in beiden Zweigen mit return oder throw.
  throw new MailFehler(0, "Mailversand fehlgeschlagen");
}

/** Zwischen zwei Mails einhalten, damit die Taktgrenze nicht greift. */
export function taktPause(): Promise<void> {
  return warte(PAUSE_ZWISCHEN_MAILS_MS);
}
