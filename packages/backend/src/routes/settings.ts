import type { FastifyInstance } from "fastify";
import { getLetterhead, updateLetterhead } from "../repositories/companyLetterheadRepository.js";
import { requireRole } from "../authorization.js";

export async function settingsRoutes(server: FastifyInstance): Promise<void> {
  server.addHook("preHandler", server.authenticate);

  server.get("/api/settings/letterhead", async () => {
    return getLetterhead();
  });

  server.put<{
    Body: {
      firmaName?: string;
      adresseZeile1?: string;
      plzOrt?: string;
      telefon?: string;
      fax?: string;
      email?: string;
      geschaeftsfuehrer?: string;
      sitzGesellschaft?: string;
      handelsregister?: string;
      ustIdnr?: string;
    };
  }>("/api/settings/letterhead", { preHandler: requireRole(["admin"]) }, async (request) => {
    const b = request.body;
    return updateLetterhead({
      firma_name: b.firmaName,
      adresse_zeile1: b.adresseZeile1,
      plz_ort: b.plzOrt,
      telefon: b.telefon,
      fax: b.fax,
      email: b.email,
      geschaeftsfuehrer: b.geschaeftsfuehrer,
      sitz_gesellschaft: b.sitzGesellschaft,
      handelsregister: b.handelsregister,
      ust_idnr: b.ustIdnr,
    });
  });
}
