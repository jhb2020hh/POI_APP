-- Selbstregistrierung: Konten muessen von einem Admin freigeschaltet werden,
-- bevor sie die Anwendung nutzen koennen.
--
-- Standard ist 0 (gesperrt), damit ein neu angelegtes Konto niemals versehentlich
-- offen ist. Bestehende Nutzer werden anschliessend freigeschaltet - sonst
-- wuerden sich mit dieser Migration alle aussperren, einschliesslich der Admins.
ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;

UPDATE users SET approved = 1;
