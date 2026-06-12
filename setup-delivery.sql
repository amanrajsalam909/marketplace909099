-- ============================================================================
--  RajkotMarket — Delivery partner panel
--  Safe to re-run: yes
-- ============================================================================

-- Platform-level key/value settings (delivery PIN, future: business info)
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default delivery PIN — CHANGE IT from Admin Panel → Settings
INSERT INTO platform_settings (key, value) VALUES ('delivery_pin', '5678')
ON CONFLICT DO NOTHING;

SELECT (SELECT count(*) FROM platform_settings) AS settings_rows;
