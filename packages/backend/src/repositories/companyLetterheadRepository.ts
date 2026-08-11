import { db } from "../db/connection.js";

export interface CompanyLetterhead {
  id: number;
  firma_name: string;
  adresse_zeile1: string;
  plz_ort: string;
  telefon: string;
  fax: string;
  email: string;
  geschaeftsfuehrer: string;
  sitz_gesellschaft: string;
  handelsregister: string;
  ust_idnr: string;
}

export async function getLetterhead(): Promise<CompanyLetterhead> {
  return (await db
    .prepare("SELECT * FROM company_letterhead WHERE id = 1")
    .get<CompanyLetterhead>())!;
}

export async function updateLetterhead(
  input: Partial<Omit<CompanyLetterhead, "id">>
): Promise<CompanyLetterhead> {
  const current = await getLetterhead();
  const definedInput = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  const merged = { ...current, ...definedInput };
  await db
    .prepare(
      `UPDATE company_letterhead SET
         firma_name = ?, adresse_zeile1 = ?, plz_ort = ?, telefon = ?, fax = ?,
         email = ?, geschaeftsfuehrer = ?, sitz_gesellschaft = ?, handelsregister = ?, ust_idnr = ?
       WHERE id = 1`
    )
    .run(
      merged.firma_name,
      merged.adresse_zeile1,
      merged.plz_ort,
      merged.telefon,
      merged.fax,
      merged.email,
      merged.geschaeftsfuehrer,
      merged.sitz_gesellschaft,
      merged.handelsregister,
      merged.ust_idnr
    );
  return getLetterhead();
}
