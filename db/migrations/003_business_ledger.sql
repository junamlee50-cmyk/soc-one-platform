CREATE UNIQUE INDEX IF NOT EXISTS soc_business_evidence ON soc_records((value->>'evidenceKey')) WHERE collection='business-ledger';
CREATE OR REPLACE FUNCTION soc_protect_business_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.collection='business-ledger' THEN
  RAISE EXCEPTION 'business ledger is append-only' USING ERRCODE='23514';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS soc_business_ledger_immutable ON soc_records;
CREATE TRIGGER soc_business_ledger_immutable BEFORE UPDATE OR DELETE ON soc_records FOR EACH ROW EXECUTE FUNCTION soc_protect_business_ledger();
INSERT INTO soc_migrations(id) VALUES ('003_business_ledger') ON CONFLICT DO NOTHING;
