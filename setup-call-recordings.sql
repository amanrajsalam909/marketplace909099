-- Call recordings (security feature).
--
-- In-app voice calls are recorded CLIENT-SIDE (the caller's browser records the
-- mixed local+remote audio), then the audio file is uploaded to Google Drive
-- via api/feedback?action=call-recording. This table is the index of those
-- recordings; the audio itself lives in Drive (private). Retention = 1 year:
-- the nightly cleanup job (lib/cleanup.js) deletes the Drive file and this row
-- once expires_at has passed.
--
-- DPDP Act 2023: both parties are told the call is recorded and must consent
-- before it connects (see public/call.js consent gate + public/privacy.html).

CREATE TABLE IF NOT EXISTS call_recordings (
  id            BIGSERIAL PRIMARY KEY,
  room          TEXT NOT NULL,                 -- = order_id the call belonged to
  drive_file_id TEXT,                          -- Google Drive file id (for deletion)
  web_view_link TEXT,                          -- admin-openable Drive link
  recorded_by   TEXT,                          -- 'partner' | 'customer' (which side uploaded)
  duration_secs INT,
  bytes         INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '365 days')
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_room    ON call_recordings(room);
CREATE INDEX IF NOT EXISTS idx_call_recordings_expires ON call_recordings(expires_at);
