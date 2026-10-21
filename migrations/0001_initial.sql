-- Batch 1 initial additive schema. Real people and vault values are created
-- idempotently at runtime from deployment secrets, never embedded here.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  student_id_hash TEXT NOT NULL UNIQUE,
  student_id_ciphertext TEXT NOT NULL,
  student_id_iv TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_key TEXT NOT NULL CHECK (length(name_key) > 0),
  role TEXT NOT NULL CHECK (role IN ('volunteer', 'admin')),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX people_name_key_idx ON people(name_key);
CREATE INDEX people_role_idx ON people(role);

CREATE TABLE vault (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_ciphertext TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL CHECK (auth_version >= 1),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX sessions_person_id_idx ON sessions(person_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE login_limits (
  bucket_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  expires_at INTEGER NOT NULL
);

CREATE INDEX login_limits_expires_at_idx ON login_limits(expires_at);
