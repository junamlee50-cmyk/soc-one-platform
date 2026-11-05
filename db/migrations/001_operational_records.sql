-- Migration bridge preserving existing SOC IDs and records byte-for-field.
-- JSONB is paired with actual PostgreSQL transactions and uniqueness constraints;
-- this is not a claim that every domain has been normalized into a separate table.
CREATE TABLE IF NOT EXISTS soc_records (
 path text PRIMARY KEY,
 collection text GENERATED ALWAYS AS (split_part(path,'/',1)) STORED,
 value jsonb NOT NULL CHECK (jsonb_typeof(value)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (path ~ '^[a-z][a-z0-9-]*/[^/]+[.]json$'),
 CHECK (collection <> 'registrations' OR
   (value ?& ARRAY['id','userId','tournamentId','divisionId','status','amount'] AND
    jsonb_typeof(value->'amount')='number' AND (value->>'amount')::numeric >= 0))
);
CREATE INDEX IF NOT EXISTS soc_records_collection ON soc_records(collection,path);
CREATE INDEX IF NOT EXISTS soc_records_data ON soc_records USING gin(value jsonb_path_ops);
CREATE UNIQUE INDEX IF NOT EXISTS soc_unique_email ON soc_records(lower(value->>'email')) WHERE collection='users';
CREATE UNIQUE INDEX IF NOT EXISTS soc_unique_soc_id ON soc_records((value->>'socId')) WHERE collection='users';
CREATE UNIQUE INDEX IF NOT EXISTS soc_active_registration ON soc_records((value->>'userId'),(value->>'tournamentId'),(value->>'divisionId')) WHERE collection='registrations' AND value->>'status' NOT IN ('CANCELED','REFUNDED');
CREATE UNIQUE INDEX IF NOT EXISTS soc_published_bracket ON soc_records((value->>'tournamentId'),(value->>'divisionKey')) WHERE collection='brackets' AND value->>'status'='PUBLISHED';
CREATE UNIQUE INDEX IF NOT EXISTS soc_ranking_award ON soc_records((value->>'athleteUserId'),(value->>'tournamentId'),(value->>'type'),(CASE WHEN value->>'type'='PARTICIPATION' THEN '' ELSE coalesce(value->>'matchId',value->>'id') END)) WHERE collection='ranking-events';
CREATE UNIQUE INDEX IF NOT EXISTS soc_medal ON soc_records((value->>'athleteUserId'),(value->>'tournamentId'),(value->>'divisionKey'),(value->>'medal')) WHERE collection='medals';
CREATE TABLE IF NOT EXISTS soc_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS soc_auth_attempts (
 bucket text PRIMARY KEY CHECK (length(bucket)=64),
 attempts integer NOT NULL CHECK (attempts>0),
 reset_at timestamptz NOT NULL
);
INSERT INTO soc_migrations(id) VALUES ('001_operational_records') ON CONFLICT DO NOTHING;
