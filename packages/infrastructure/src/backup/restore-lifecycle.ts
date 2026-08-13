import type { RestoreLifecyclePort } from "./backup-service.js";
import { BackupListRequestV1Schema, BackupListResponseV1Schema, BackupRestoreRequestV1Schema, BackupRestoreReceiptV1Schema, BackupRestoreStatusRequestV1Schema, BackupRestoreStatusV1Schema } from "@paopao/contracts";
import type { BackupService } from "./backup-service.js";

export type DataAvailability = "available" | "restoring" | "unavailable";

export interface DesktopRestoreLifecycle extends RestoreLifecyclePort {
  availability(): DataAvailability;
  assertCaptureAvailable(): void;
}

export class CaptureUnavailableDuringRestoreError extends Error {
  readonly code = "DATABASE_UNAVAILABLE" as const;
  constructor() { super("Capture is unavailable while the database is being restored"); }
}

export function createDesktopRestoreLifecycle(dependencies: {
  stopWorkers(): Promise<void>;
  closeDatabase(): Promise<void> | void;
  reopenDatabase(): Promise<void>;
  startWorkers(): Promise<void> | void;
  availabilityChanged?(availability: DataAvailability): Promise<void> | void;
}): DesktopRestoreLifecycle {
  let state: DataAvailability = "available";
  const set = async (next: DataAvailability) => {
    state = next;
    try { await dependencies.availabilityChanged?.(next); } catch { /* Availability state remains authoritative. */ }
  };
  return {
    availability: () => state,
    assertCaptureAvailable() { if (state !== "available") throw new CaptureUnavailableDuringRestoreError(); },
    async quiesceForRestore() {
      await set("restoring");
      try {
        await dependencies.stopWorkers();
        await dependencies.closeDatabase();
      } catch (error) {
        await set("unavailable");
        throw error;
      }
    },
    async resumeAfterDatabaseOpen() {
      try {
        await dependencies.reopenDatabase();
        await dependencies.startWorkers();
        await set("available");
      } catch (error) {
        await set("unavailable");
        throw error;
      }
    },
    async remainUnavailable() { await set("unavailable"); },
  };
}

export function createBackupFacade(service: BackupService) {
  return {
    async list(input: unknown) {
      BackupListRequestV1Schema.parse(input);
      return BackupListResponseV1Schema.parse(await service.list());
    },
    async restore(input: unknown) {
      const request = BackupRestoreRequestV1Schema.parse(input);
      return BackupRestoreReceiptV1Schema.parse(await service.restore(request));
    },
    async status(input: unknown) {
      const request = BackupRestoreStatusRequestV1Schema.parse(input);
      return BackupRestoreStatusV1Schema.parse(await service.status(request.restoreId));
    },
  };
}
