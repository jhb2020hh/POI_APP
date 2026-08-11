const UMLAUT_MAP: Record<string, string> = {
  Ä: "AE",
  Ö: "OE",
  Ü: "UE",
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

const FALLBACK_CATEGORY_CODE = "ALLG";
const MAX_LENGTH = 12;

// Leitet aus einem Kategorienamen einen kompakten, WinAnsi-sicheren Kurzcode fuer
// Ticket-IDs ab (z.B. "Mängel" -> "MAENGEL"), falls kein manueller Kurzcode gepflegt ist.
export function deriveShortCode(name: string): string {
  const transliterated = name.replace(/[ÄÖÜäöü ß]/g, (ch) => UMLAUT_MAP[ch] ?? ch);
  const cleaned = transliterated.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, MAX_LENGTH) || FALLBACK_CATEGORY_CODE;
}

export function resolveCategoryCode(category: { short_code: string | null; name: string } | undefined): string {
  if (!category) return FALLBACK_CATEGORY_CODE;
  return category.short_code || deriveShortCode(category.name);
}
