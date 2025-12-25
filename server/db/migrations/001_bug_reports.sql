-- Migration: Create bug_reports table
-- Run this manually if automatic migration fails

CREATE TABLE IF NOT EXISTS bug_reports (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  console_logs JSONB NOT NULL DEFAULT '[]',
  network_errors JSONB NOT NULL DEFAULT '[]',
  user_note TEXT,
  screenshot TEXT, -- base64, nullable
  project_id TEXT DEFAULT 'default', -- for multi-project support
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_project_id ON bug_reports(project_id);

-- Optional: Add a comment describing the table
COMMENT ON TABLE bug_reports IS 'Stores browser bug reports captured by the Chrome extension';
