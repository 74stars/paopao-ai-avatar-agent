CREATE TABLE binding_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  open_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE INDEX binding_attempts_actor_time
  ON binding_attempts(app_id, open_id, attempted_at);

ALTER TABLE binding_operations ADD COLUMN app_id TEXT;
ALTER TABLE binding_operations ADD COLUMN tenant_key TEXT;
ALTER TABLE binding_operations ADD COLUMN open_id TEXT;

ALTER TABLE external_messages ADD COLUMN ack_manual_attempt_active INTEGER NOT NULL DEFAULT 0
  CHECK (ack_manual_attempt_active IN (0, 1));
ALTER TABLE external_messages ADD COLUMN result_manual_attempt_active INTEGER NOT NULL DEFAULT 0
  CHECK (result_manual_attempt_active IN (0, 1));

CREATE TABLE external_delivery_operations (
  request_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  message_key TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('ack', 'result')),
  action TEXT NOT NULL CHECK (action IN ('assume_sent', 'retry_once')),
  outcome_status TEXT NOT NULL CHECK (outcome_status IN ('sent_assumed', 'pending')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (provider, message_key) REFERENCES external_messages(provider, message_key)
);

CREATE INDEX external_messages_ack_due
  ON external_messages(ack_status, ack_next_run_at, updated_at);
CREATE INDEX external_messages_result_due
  ON external_messages(result_status, result_next_run_at, updated_at);

UPDATE external_messages SET ack_status = 'ack_' || ack_status
  WHERE ack_status IN ('waiting', 'pending', 'sending', 'retry_wait', 'sent', 'sent_assumed', 'ambiguous', 'failed_final');
UPDATE external_messages SET result_status = 'result_' || result_status
  WHERE result_status IN ('not_required', 'waiting', 'pending', 'sending', 'retry_wait', 'sent', 'sent_assumed', 'ambiguous', 'failed_final');
