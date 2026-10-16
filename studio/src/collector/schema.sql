-- Datenbank des Live-View-Dienstes (Cloudflare D1). Keine personenbezogenen Daten im Klartext.
CREATE TABLE IF NOT EXISTS events (ts INTEGER NOT NULL, type TEXT NOT NULL, visitor TEXT, product_id TEXT, product_title TEXT, country TEXT, path TEXT);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS views (day TEXT NOT NULL, product_id TEXT NOT NULL, title TEXT, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, product_id));
CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
