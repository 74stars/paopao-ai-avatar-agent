CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('desktop', 'feishu')),
  source_key TEXT NOT NULL UNIQUE,
  modality TEXT NOT NULL CHECK (modality = 'text'),
  raw_text TEXT,
  raw_checksum TEXT,
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('remember', 'think')),
  status TEXT NOT NULL CHECK (status IN ('stored','processing','retry_wait','needs_review','ready','failed_final','deleting','purged')),
  current_text_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_text_revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  purged_at TEXT,
  last_error_code TEXT
);

CREATE TABLE entry_text_revisions (
  entry_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  text TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'system')),
  operation_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, revision),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('analyze_entry','generate_insight','purge_entry','create_export','create_diagnostics_export')),
  entry_id TEXT,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','retry_wait','waiting_for_network','waiting_for_configuration','succeeded','failed_final','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  next_run_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL
);

CREATE INDEX jobs_due ON jobs(status, next_run_at, created_at, id);
CREATE INDEX jobs_entry ON jobs(entry_id, status);

CREATE TABLE derivations (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('classification','summary','entities','goals','next_actions','insight_reply')),
  value_json TEXT NOT NULL,
  text_revision INTEGER NOT NULL CHECK (text_revision > 0),
  artifact_revision INTEGER NOT NULL CHECK (artifact_revision > 0),
  supersedes_id TEXT,
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  created_by TEXT NOT NULL CHECK (created_by IN ('ai', 'user')),
  prompt_version TEXT,
  schema_version TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_id) REFERENCES derivations(id)
);

CREATE UNIQUE INDEX derivations_one_current ON derivations(entry_id, kind) WHERE is_current = 1;

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('diary','thought','person','reading','goal','other')),
  summary TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  classification_derivation_id TEXT NOT NULL,
  summary_derivation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (classification_derivation_id) REFERENCES derivations(id),
  FOREIGN KEY (summary_derivation_id) REFERENCES derivations(id)
);

CREATE TABLE artifact_sources (
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('derivation', 'memory')),
  artifact_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  quote TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_type, artifact_id, entry_id, quote),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  input_tokens INTEGER,
  output_tokens INTEGER,
  provider_request_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE feishu_bindings (
  id TEXT PRIMARY KEY,
  singleton_scope INTEGER NOT NULL DEFAULT 1 CHECK (singleton_scope = 1),
  app_id TEXT NOT NULL,
  tenant_key TEXT NOT NULL,
  open_id TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  bound_at TEXT NOT NULL,
  unbound_at TEXT,
  UNIQUE (app_id, tenant_key, open_id)
);

CREATE UNIQUE INDEX feishu_single_active ON feishu_bindings(singleton_scope) WHERE active = 1;

CREATE TABLE binding_codes (
  id TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX binding_codes_one_active ON binding_codes((1)) WHERE consumed_at IS NULL;

CREATE TABLE binding_operations (
  operation_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('bind', 'unbind')),
  outcome TEXT NOT NULL,
  binding_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (binding_id) REFERENCES feishu_bindings(id)
);

CREATE TABLE processed_events (
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  message_key TEXT,
  control_kind TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'completed')),
  outcome TEXT,
  processed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_key)
);

CREATE TABLE external_messages (
  provider TEXT NOT NULL,
  message_key TEXT NOT NULL,
  message_kind TEXT NOT NULL CHECK (message_kind IN ('capture', 'control')),
  entry_id TEXT,
  recipient_json TEXT,
  control_status TEXT,
  control_outcome TEXT,
  control_lease_owner TEXT,
  control_lease_expires_at TEXT,
  control_fencing_token INTEGER NOT NULL DEFAULT 0,
  control_reply_code TEXT,
  ack_status TEXT NOT NULL,
  ack_reply_id TEXT,
  ack_attempts INTEGER NOT NULL DEFAULT 0,
  ack_next_run_at TEXT,
  ack_lease_owner TEXT,
  ack_lease_expires_at TEXT,
  ack_fencing_token INTEGER NOT NULL DEFAULT 0,
  ack_manual_retry_used INTEGER NOT NULL DEFAULT 0 CHECK (ack_manual_retry_used IN (0, 1)),
  ack_last_error_code TEXT,
  result_status TEXT NOT NULL,
  result_reply_id TEXT,
  result_derivation_id TEXT,
  result_attempts INTEGER NOT NULL DEFAULT 0,
  result_next_run_at TEXT,
  result_lease_owner TEXT,
  result_lease_expires_at TEXT,
  result_fencing_token INTEGER NOT NULL DEFAULT 0,
  result_manual_retry_used INTEGER NOT NULL DEFAULT 0 CHECK (result_manual_retry_used IN (0, 1)),
  result_last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, message_key),
  FOREIGN KEY (entry_id) REFERENCES entries(id),
  FOREIGN KEY (result_derivation_id) REFERENCES derivations(id)
);

CREATE UNIQUE INDEX external_messages_one_per_entry ON external_messages(entry_id) WHERE entry_id IS NOT NULL;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE governance_operations (
  operation_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('revise_text', 'correct')),
  request_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('json', 'markdown')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  relative_path TEXT,
  sha256 TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE diagnostic_exports (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  include_days INTEGER NOT NULL CHECK (include_days BETWEEN 1 AND 7),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  relative_path TEXT,
  sha256 TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE entry_search USING fts5(
  entry_id UNINDEXED,
  current_text,
  summary,
  entities,
  goals,
  actions,
  tokenize = 'trigram'
);
