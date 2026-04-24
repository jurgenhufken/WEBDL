-- src/db/schema.sql — PostgreSQL schema voor WebDL-Hub.
-- Idempotent; kan meerdere keren uitgevoerd worden.
-- De placeholder "__SCHEMA__" wordt door migrate.js vervangen door config.dbSchema.

CREATE SCHEMA IF NOT EXISTS __SCHEMA__;

CREATE TABLE IF NOT EXISTS __SCHEMA__.jobs (
  id            BIGSERIAL PRIMARY KEY,
  url           TEXT        NOT NULL,
  adapter       TEXT        NOT NULL,
  status        TEXT        NOT NULL
                CHECK (status IN ('queued','running','done','failed','cancelled')),
  priority      INT         NOT NULL DEFAULT 0,
  options       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  progress_pct  REAL        NOT NULL DEFAULT 0,
  attempts      INT         NOT NULL DEFAULT 0,
  max_attempts  INT         NOT NULL DEFAULT 3,
  locked_by     TEXT,
  locked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error         TEXT,
  -- Lane voor concurrency-buckets:
  --  'process-video': video + ffmpeg merge (YouTube enz.), max 1 tegelijk
  --  'video':         directe video download zonder merge, max 2 tegelijk
  --  'image':         images/attachments, max 6 tegelijk
  lane          TEXT        NOT NULL DEFAULT 'video'
);

-- Voor oudere databases zonder 'lane' kolom:
ALTER TABLE __SCHEMA__.jobs ADD COLUMN IF NOT EXISTS lane TEXT NOT NULL DEFAULT 'video';

CREATE INDEX IF NOT EXISTS idx_jobs_status_prio
  ON __SCHEMA__.jobs (status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_jobs_lane_status
  ON __SCHEMA__.jobs (lane, status, priority DESC, created_at ASC);

-- Voor URL-dedupe: snel bestaande actieve/klare job vinden per URL.
CREATE INDEX IF NOT EXISTS idx_jobs_url ON __SCHEMA__.jobs (url);

CREATE TABLE IF NOT EXISTS __SCHEMA__.files (
  id          BIGSERIAL PRIMARY KEY,
  job_id      BIGINT NOT NULL REFERENCES __SCHEMA__.jobs(id) ON DELETE CASCADE,
  path        TEXT   NOT NULL,
  size        BIGINT,
  mime        TEXT,
  checksum    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_job ON __SCHEMA__.files(job_id);

CREATE TABLE IF NOT EXISTS __SCHEMA__.logs (
  id      BIGSERIAL PRIMARY KEY,
  job_id  BIGINT NOT NULL REFERENCES __SCHEMA__.jobs(id) ON DELETE CASCADE,
  ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
  level   TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  msg     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_job_ts ON __SCHEMA__.logs(job_id, ts DESC);
