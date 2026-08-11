import pg from "pg";

const { Pool, types } = pg;

// pg liefert int8 (BIGINT) und COUNT(*) standardmaessig als String aus, weil nicht
// jeder 64-Bit-Wert verlustfrei in eine JS-Zahl passt. In diesem Schema bleiben alle
// Zaehler weit unter 2^53 (change_log.seq ist der Sync-Cursor, COUNT(*) zaehlt Zeilen),
// deshalb parsen wir sie zu Number - sonst waere `seq` im Offline-Sync ploetzlich ein
// String und Vergleiche wie `seq > cursor` wuerden lexikografisch falsch rechnen.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

// POSTGRES_URL wird von der Supabase-Integration in Vercel automatisch angelegt.
// DATABASE_URL hat Vorrang, damit sich der Wert bei Bedarf gezielt uebersteuern
// laesst, ohne die von der Integration verwalteten Variablen anzufassen.
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

/**
 * Bewusst kein Abbruch beim Laden des Moduls.
 *
 * In einer Serverless-Umgebung wuerde ein Fehler an dieser Stelle die ganze
 * Function unbrauchbar machen: jeder Endpunkt antwortete mit einer
 * nichtssagenden 500, auch /api/health, mit dem sich die Ursache feststellen
 * liesse. Stattdessen wird der Zustand festgehalten und erst beim tatsaechlichen
 * Zugriff mit einer verstaendlichen Meldung abgebrochen.
 */
export const isDatabaseConfigured = Boolean(connectionString);

function requireConnection(): string {
  if (!connectionString) {
    throw new Error(
      "Weder DATABASE_URL noch POSTGRES_URL ist gesetzt. Erwartet wird der " +
        "Supabase-Connection-String (Transaction Pooler, Port 6543)."
    );
  }
  return connectionString;
}

// Der Direktanschluss (5432) haelt je Verbindung eine eigene Postgres-Sitzung
// offen. Serverless-Instanzen starten beliebig oft parallel, die verfuegbaren
// Verbindungen waeren damit schnell erschoepft. Das ist kein Abbruchgrund -
// lokal ist der Direktanschluss voellig in Ordnung -, aber im Betrieb ein
// Fehler, der sich sonst erst unter Last als sporadischer Ausfall zeigt.
if (connectionString && /:5432\//.test(connectionString)) {
  console.warn(
    "[db] Die Verbindung nutzt Port 5432 (Direktanschluss). Fuer den Betrieb " +
      "auf Vercel wird der Transaction Pooler auf Port 6543 benoetigt."
  );
}

/**
 * Serverless-Instanzen werden zwischen Requests eingefroren und wiederverwendet.
 * Der Pool haengt deshalb bewusst am globalen Objekt: sonst wuerde jeder Kaltstart
 * eine neue Verbindung aufmachen und der Supabase-Pooler waere schnell erschoepft.
 * `max: 1` weil eine Serverless-Instanz immer nur einen Request gleichzeitig
 * bearbeitet - Parallelitaet entsteht durch mehrere Instanzen, nicht im Pool.
 */
const globalForPg = globalThis as typeof globalThis & { __poiPgPool?: pg.Pool };

/**
 * Trennt die TLS-Einstellung vom Connection-String.
 *
 * pg wertet Parameter aus dem Connection-String aus und laesst sie die
 * explizit uebergebene ssl-Option ueberschreiben. Steht dort sslmode=require -
 * wie im String, den die Supabase-Integration in Vercel hinterlegt -, wird
 * streng geprueft, und die Verbindung scheitert an Supabases eigener
 * Zertifikatskette ("self-signed certificate in certificate chain").
 *
 * sslmode wird deshalb aus dem String entfernt und die TLS-Einstellung
 * ausschliesslich ueber die Pool-Option gesetzt. sslmode=disable bleibt
 * respektiert.
 */
function buildConnectionConfig(dsn: string): {
  connectionString: string;
  ssl: pg.PoolConfig["ssl"];
} {
  let connectionString = dsn;
  let sslmode: string | null = null;

  try {
    const url = new URL(dsn);
    sslmode = url.searchParams.get("sslmode");
    if (sslmode) {
      url.searchParams.delete("sslmode");
      connectionString = url.toString();
    }
  } catch {
    // Nicht als URL lesbar - dann unveraendert verwenden.
  }

  if (sslmode === "disable") {
    return { connectionString, ssl: false };
  }

  // Supabase erzwingt TLS. Die Zertifikatspruefung ist standardmaessig
  // entschaerft, weil die Kette von Supabases eigener CA stammt und nicht im
  // Truststore von Node liegt. Die Uebertragung bleibt verschluesselt. Mit
  // DATABASE_SSL_STRICT=true laesst sich die volle Pruefung einschalten - dann
  // muss die Supabase-CA im Truststore hinterlegt sein.
  return {
    connectionString,
    ssl: { rejectUnauthorized: process.env.DATABASE_SSL_STRICT === "true" },
  };
}

function createPool(): pg.Pool {
  const { connectionString: dsn, ssl } = buildConnectionConfig(requireConnection());
  return new Pool({
    connectionString: dsn,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
}

export function getPool(): pg.Pool {
  if (!globalForPg.__poiPgPool) {
    globalForPg.__poiPgPool = createPool();
  }
  return globalForPg.__poiPgPool;
}

/**
 * Weiterleitung auf den erst bei Bedarf erzeugten Pool, damit die vorhandenen
 * Aufrufstellen (pool.query, pool.connect, pool.end) unveraendert bleiben und
 * das Modul trotzdem ohne gesetzte Verbindung geladen werden kann.
 */
export const pool = new Proxy({} as pg.Pool, {
  get(_target, property) {
    const instance = getPool() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/**
 * Uebersetzt SQLite-Platzhalter (`?`) in die Postgres-Form (`$1`, `$2`, ...).
 * Zeichenketten, Bezeichner in Anfuehrungszeichen und Kommentare werden dabei
 * uebersprungen, damit ein Fragezeichen im Text nicht faelschlich ersetzt wird.
 */
export function toPositionalParams(sql: string): string {
  let out = "";
  let index = 0;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];

    if (char === "'" || char === '"') {
      const quote = char;
      out += char;
      i += 1;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === quote) {
          // Verdoppeltes Anfuehrungszeichen ist ein Escape, kein Ende.
          if (sql[i + 1] === quote) {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (char === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        out += sql[i];
        i += 1;
      }
      continue;
    }

    if (char === "/" && sql[i + 1] === "*") {
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out += sql[i];
        i += 1;
      }
      out += sql.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (char === "?") {
      index += 1;
      out += `$${index}`;
      i += 1;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

export type QueryParam = string | number | boolean | null | undefined;

export interface RunResult {
  changes: number;
}

export interface Statement {
  all<T = unknown>(...params: QueryParam[]): Promise<T[]>;
  get<T = unknown>(...params: QueryParam[]): Promise<T | undefined>;
  run(...params: QueryParam[]): Promise<RunResult>;
}

/**
 * Duenner Ersatz fuer die `node:sqlite`-API. Die Aufrufform
 * `db.prepare(sql).all(...)` bleibt erhalten, die Rueckgabe ist jetzt ein Promise.
 */
export const db = {
  prepare(sql: string): Statement {
    const text = toPositionalParams(sql);
    return {
      async all<T>(...params: QueryParam[]): Promise<T[]> {
        const result = await pool.query(text, params as unknown[]);
        return result.rows as T[];
      },
      async get<T>(...params: QueryParam[]): Promise<T | undefined> {
        const result = await pool.query(text, params as unknown[]);
        return result.rows[0] as T | undefined;
      },
      async run(...params: QueryParam[]): Promise<RunResult> {
        const result = await pool.query(text, params as unknown[]);
        return { changes: result.rowCount ?? 0 };
      },
    };
  },

  async exec(sql: string): Promise<void> {
    await pool.query(sql);
  },
};
