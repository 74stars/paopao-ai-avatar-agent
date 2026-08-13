export type EntryStatus =
  | "stored" | "processing" | "retry_wait" | "needs_review" | "ready"
  | "failed_final" | "deleting" | "purged";

export type JobStatus =
  | "queued" | "running" | "retry_wait" | "waiting_for_network"
  | "waiting_for_configuration" | "succeeded" | "failed_final" | "cancelled";

const entryTransitions: Record<EntryStatus, readonly EntryStatus[]> = {
  stored: ["processing", "deleting"],
  processing: ["ready", "retry_wait", "needs_review", "failed_final", "deleting"],
  retry_wait: ["processing", "deleting"],
  needs_review: ["processing", "ready", "deleting"],
  ready: ["deleting"],
  failed_final: ["processing", "deleting"],
  deleting: ["purged"],
  purged: [],
};

const jobTransitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "retry_wait", "waiting_for_network", "waiting_for_configuration", "failed_final"],
  retry_wait: ["running", "cancelled"],
  waiting_for_network: ["queued", "cancelled"],
  waiting_for_configuration: ["queued", "cancelled"],
  succeeded: [],
  failed_final: [],
  cancelled: [],
};

export function canTransitionEntry(from: EntryStatus, to: EntryStatus): boolean {
  return entryTransitions[from]?.includes(to) ?? false;
}

export function transitionEntryStatus(from: EntryStatus, to: EntryStatus): EntryStatus {
  if (!canTransitionEntry(from, to)) throw new Error(`Invalid entry status transition: ${from} -> ${to}`);
  return to;
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return jobTransitions[from]?.includes(to) ?? false;
}

export function transitionJobStatus(from: JobStatus, to: JobStatus): JobStatus {
  if (!canTransitionJob(from, to)) throw new Error(`Invalid job status transition: ${from} -> ${to}`);
  return to;
}

export function assertEntryStatusTransition(from: EntryStatus, to: EntryStatus): asserts to is EntryStatus {
  transitionEntryStatus(from, to);
}

export function assertJobStatusTransition(from: JobStatus, to: JobStatus): asserts to is JobStatus {
  transitionJobStatus(from, to);
}

export function isTerminalEntryStatus(status: EntryStatus): boolean {
  return status === "purged";
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed_final" || status === "cancelled";
}
