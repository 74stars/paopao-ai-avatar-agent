import { useEffect, useState } from "react";
import type { BackupRestoreStatusV1, DiagnosticsExportStatusV1, ExportStatusV1 } from "@paopao/contracts";
import { userErrorMessage } from "../error-messages";

type OperationStatus = ExportStatusV1["status"] | DiagnosticsExportStatusV1["status"] | BackupRestoreStatusV1["status"];

const operationStatusLabels: Record<OperationStatus, string> = {
  queued: "等待处理",
  running: "正在处理",
  ready: "已完成",
  validating: "正在检查备份",
  quiescing: "正在准备恢复",
  replacing: "正在恢复",
  reopening: "即将完成",
  succeeded: "恢复完成",
  failed: "处理失败",
  failed_invalid: "备份无法使用",
  failed_rolled_back: "恢复失败，原有数据已保留",
  failed_unavailable: "恢复失败，请重新启动泡泡",
};

export function DataManagement() {
  const [format, setFormat] = useState<"json" | "markdown">("json");
  const [exportStatus, setExportStatus] = useState<ExportStatusV1 | null>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<DiagnosticsExportStatusV1 | null>(null);
  const [backups, setBackups] = useState<Array<{ backupId: string; createdAt: string; reason: string; sizeBytes: number }>>([]);
  const [restoreStatus, setRestoreStatus] = useState<BackupRestoreStatusV1 | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => { void loadBackups(); }, []);
  useEffect(() => {
    if (!window.paopao || !exportStatus || !["queued", "running"].includes(exportStatus.status)) return;
    const timer = window.setTimeout(async () => { const result = await window.paopao!.exports.get({ version: 1, exportId: exportStatus.exportId }); if (result.ok) setExportStatus(result.data); }, 800);
    return () => window.clearTimeout(timer);
  }, [exportStatus]);
  useEffect(() => {
    if (!window.paopao || !diagnosticsStatus || !["queued", "running"].includes(diagnosticsStatus.status)) return;
    const timer = window.setTimeout(async () => { const result = await window.paopao!.diagnostics.getExport({ version: 1, diagnosticExportId: diagnosticsStatus.diagnosticExportId }); if (result.ok) setDiagnosticsStatus(result.data); }, 800);
    return () => window.clearTimeout(timer);
  }, [diagnosticsStatus]);
  useEffect(() => {
    if (!window.paopao || !restoreStatus || !["queued", "validating", "quiescing", "replacing", "reopening"].includes(restoreStatus.status)) return;
    const timer = window.setTimeout(async () => { const result = await window.paopao!.backups.status({ version: 1, restoreId: restoreStatus.restoreId }); if (result.ok) setRestoreStatus(result.data); }, 500);
    return () => window.clearTimeout(timer);
  }, [restoreStatus]);

  async function loadBackups() { const result = await window.paopao?.backups.list({ version: 1 }); if (result?.ok) setBackups(result.data.backups); else if (result) setMessage(userErrorMessage(result.error, "data")); }
  async function createExport() { const result = await window.paopao?.exports.create({ version: 1, requestId: crypto.randomUUID(), format, includeDeleted: false }); if (!result) return; if (!result.ok) return setMessage(userErrorMessage(result.error, "data")); setExportStatus({ exportId: result.data.exportId, status: "queued", path: null, sha256: null, errorCode: null }); }
  async function createDiagnostics() { const result = await window.paopao?.diagnostics.createExport({ version: 1, requestId: crypto.randomUUID(), includeDays: 7 }); if (!result) return; if (!result.ok) return setMessage(userErrorMessage(result.error, "data")); setDiagnosticsStatus({ diagnosticExportId: result.data.diagnosticExportId, status: "queued", path: null, sha256: null, errorCode: null }); }
  async function restore(backupId: string) { if (restoreCandidate !== backupId) { setRestoreCandidate(backupId); setMessage("再次点击确认恢复。恢复期间将暂停记录。"); return; } const result = await window.paopao?.backups.restore({ version: 1, requestId: crypto.randomUUID(), backupId, confirmation: "RESTORE" }); setRestoreCandidate(null); if (!result) return; if (!result.ok) return setMessage(userErrorMessage(result.error, "data")); setRestoreStatus({ restoreId: result.data.restoreId, backupId, status: "queued", errorCode: null, updatedAt: new Date().toISOString() }); }

  return <section className="settings-section data-management" data-testid="data-management">
    <h2>数据管理</h2>
    <div className="data-row"><select value={format} onChange={(event) => setFormat(event.target.value as "json" | "markdown")}><option value="json">JSON</option><option value="markdown">Markdown</option></select><button type="button" onClick={() => void createExport()}>创建导出</button></div>
    {exportStatus && <StatusLine label="数据导出" status={exportStatus.status} failed={exportStatus.status === "failed"} detail={exportStatus.status === "ready" ? `${exportStatus.path} · ${exportStatus.sha256}` : undefined} />}
    <button type="button" onClick={() => void createDiagnostics()}>导出脱敏诊断</button>
    {diagnosticsStatus && <StatusLine label="诊断导出" status={diagnosticsStatus.status} failed={diagnosticsStatus.status === "failed"} detail={diagnosticsStatus.status === "ready" ? `${diagnosticsStatus.path} · ${diagnosticsStatus.sha256}` : undefined} />}
    <div className="data-heading"><strong>备份</strong><button type="button" onClick={() => void loadBackups()}>刷新</button></div>
    {backups.length === 0 ? <p className="settings-note">暂无可用备份。</p> : backups.map((backup) => <div className="backup-row" key={backup.backupId}><span>{new Date(backup.createdAt).toLocaleString("zh-CN")} · {formatBytes(backup.sizeBytes)}</span><button type="button" onClick={() => void restore(backup.backupId)}>{restoreCandidate === backup.backupId ? "确认恢复" : "恢复"}</button></div>)}
    {restoreStatus && <StatusLine label="恢复记录" status={restoreStatus.status} failed={restoreStatus.status.startsWith("failed")} />}
    {message && <p className="settings-message" role="status">{message}</p>}
  </section>;
}

function StatusLine({ label, status, failed, detail }: { label: string; status: OperationStatus; failed: boolean; detail?: string }) { const succeeded = status === "ready" || status === "succeeded"; return <div className={`operation-status ${failed ? "failed" : succeeded ? "succeeded" : "pending"}`}><strong>{label}</strong><span>{operationStatusLabel(status)}</span>{detail && <small>{detail}</small>}</div>; }
export function operationStatusLabel(status: OperationStatus) { return operationStatusLabels[status]; }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
