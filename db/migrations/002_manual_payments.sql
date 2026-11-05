-- Each verified bank transaction is entered once. Corrections append entries;
-- there is no API for silently editing/deleting the money history.
CREATE UNIQUE INDEX IF NOT EXISTS soc_payment_evidence ON soc_records((value->>'evidenceKey')) WHERE collection='payment-ledger';
CREATE UNIQUE INDEX IF NOT EXISTS soc_payment_registration_kind ON soc_records((value->>'registrationId'),(value->>'kind')) WHERE collection='payment-ledger';
CREATE UNIQUE INDEX IF NOT EXISTS soc_payment_refund ON soc_records((value->>'reverses')) WHERE collection='payment-ledger' AND value->>'kind'='REFUND';
CREATE OR REPLACE FUNCTION soc_protect_payment_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.collection='payment-ledger' THEN
    RAISE EXCEPTION 'payment ledger is append-only' USING ERRCODE='23514';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS soc_payment_ledger_immutable ON soc_records;
CREATE TRIGGER soc_payment_ledger_immutable BEFORE UPDATE OR DELETE ON soc_records FOR EACH ROW EXECUTE FUNCTION soc_protect_payment_ledger();
INSERT INTO soc_migrations(id) VALUES ('002_manual_payments') ON CONFLICT DO NOTHING;
