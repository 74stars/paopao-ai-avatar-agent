import { z } from "zod";
import {
  BackupListResponseV1Schema,
  BackupListRequestV1Schema,
  BackupRestoreReceiptV1Schema,
  BackupRestoreRequestV1Schema,
  BackupRestoreStatusV1Schema,
  BackupRestoreStatusRequestV1Schema,
  DiagnosticsExportCreateRequestV1Schema,
  DiagnosticsExportReceiptV1Schema,
  DiagnosticsExportStatusV1Schema,
  EntryDeleteReceiptV1Schema,
  EntryDeleteRequestV1Schema,
  ExportCreateRequestV1Schema,
  ExportReceiptV1Schema,
  ExportStatusV1Schema
} from "@paopao/contracts";

const uuid = z.string().uuid();
const request = <T extends z.ZodRawShape>(shape: T) => z.object({ version: z.literal(1), ...shape }).strict();

export {
  BackupListRequestV1Schema,
  BackupListResponseV1Schema,
  BackupRestoreReceiptV1Schema,
  BackupRestoreRequestV1Schema,
  BackupRestoreStatusRequestV1Schema,
  BackupRestoreStatusV1Schema,
  DiagnosticsExportCreateRequestV1Schema,
  DiagnosticsExportReceiptV1Schema,
  DiagnosticsExportStatusV1Schema,
  EntryDeleteReceiptV1Schema,
  EntryDeleteRequestV1Schema,
  ExportCreateRequestV1Schema,
  ExportReceiptV1Schema,
  ExportStatusV1Schema
};
export const ExportGetRequestV1Schema = request({ exportId: uuid });
export const DiagnosticsExportGetRequestV1Schema = request({ diagnosticExportId: uuid });

export type ExportGetRequestV1 = z.infer<typeof ExportGetRequestV1Schema>;
export type DiagnosticsExportGetRequestV1 = z.infer<typeof DiagnosticsExportGetRequestV1Schema>;
export type BackupListRequestV1 = z.infer<typeof BackupListRequestV1Schema>;
export type BackupRestoreStatusRequestV1 = z.infer<typeof BackupRestoreStatusRequestV1Schema>;
