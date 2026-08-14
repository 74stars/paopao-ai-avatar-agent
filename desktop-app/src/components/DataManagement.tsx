import { useEffect, useState } from "react";
import type { BackupRestoreStatusV1, DiagnosticsExportStatusV1, ExportStatusV1 } from "@paopao/contracts";
import { userErrorMessage } from "../error-messages";

type OperationStatus = ExportStatusV1["status"] | DiagnosticsExportStatusV1["status"] | BackupRestoreStatusV1["status"];

export const EXPORT_SNAPSHOT_NOTICE = "导出是独立副本；之后删除记录不会改写已经复制到其他位置的旧导出。";

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
  const [exportPollError, setExportPollError] = useState("");
  const [diagnosticsPollError, setDiagnosticsPollError] = useState("");
  const [restorePollError, setRestorePollError] = useState("");

  useEffect(() => { void loadBackups(); }, []);
  useEffect(() => {
    if (!window.paopao || !exportStatus || !["queued", "running"].includes(exportStatus.status)) return;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await window.paopao!.exports.get({ version: 1, exportId: exportStatus.exportId });
        if (result.ok) {
          setExportPollError("");
          setExportStatus(result.data);
        } else {
          setExportPollError(userErrorMessage(result.error, "data"));
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void poll(); }, 800);
    return () => window.clearInterval(timer);
  }, [exportStatus?.exportId, exportStatus?.status]);
  useEffect(() => {
    if (!window.paopao || !diagnosticsStatus || !["queued", "running"].includes(diagnosticsStatus.status)) return;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await window.paopao!.diagnostics.getExport({ version: 1, diagnosticExportId: diagnosticsStatus.diagnosticExportId });
        if (result.ok) {
          setDiagnosticsPollError("");
          setDiagnosticsStatus(result.data);
        } else {
          setDiagnosticsPollError(userErrorMessage(result.error, "data"));
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void poll(); }, 800);
    return () => window.clearInterval(timer);
  }, [diagnosticsStatus?.diagnosticExportId, diagnosticsStatus?.status]);
  useEffect(() => {
    if (!window.paopao || !restoreStatus || !restoreInProgress(restoreStatus.status)) return;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await window.paopao!.backups.status({ version: 1, restoreId: restoreStatus.restoreId });
        if (result.ok) {
          setRestorePollError("");
          setRestoreStatus(result.data);
          if (!restoreInProgress(result.data.status)) await loadBackups();
        } else {
          setRestorePollError(userErrorMessage(result.error, "data"));
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void poll(); }, 500);
    return () => window.clearInterval(timer);
  }, [restoreStatus?.restoreId, restoreStatus?.status]);

  async function loadBackups() { const result = await window.paopao?.backups.list({ version: 1 }); if (result?.ok) setBackups(result.data.backups); else if (result) setMessage(userErrorMessage(result.error, "data")); }
  async function createExport() { setMessage(""); setExportPollError(""); const result = await window.paopao?.exports.create({ version: 1, requestId: crypto.randomUUID(), format, includeDeleted: false }); if (!result) return; if (!result.ok) return setMessage(userErrorMessage(result.error, "data")); setExportStatus({ exportId: result.data.exportId, status: "queued", path: null, sha256: null, errorCode: null }); }
  async function createDiagnostics() { setMessage(""); setDiagnosticsPollError(""); const result = await window.paopao?.diagnostics.createExport({ version: 1, requestId: crypto.randomUUID(), includeDays: 7 }); if (!result) return; if (!result.ok) return setMessage(userErrorMessage(result.error, "data")); setDiagnosticsStatus({ diagnosticExportId: result.data.diagnosticExportId, status: "queued", path: null, sha256: null, errorCode: null }); }
  async function restore(backupId: string) {
    if (restoreCandidate !== backupId) {
      setRestoreCandidate(backupId);
      setMessage("");
      return;
    }
    setRestoreCandidate(null);
    setMessage("");
    setRestorePollError("");
    const result = await window.paopao?.backups.restore({ version: 1, requestId: crypto.randomUUID(), backupId, confirmation: "RESTORE" });
    if (!result) return;
    if (!result.ok) return setMessage(userErrorMessage(result.error, "data"));
    setRestoreStatus({ restoreId: result.data.restoreId, backupId, status: "queued", errorCode: null, updatedAt: new Date().toISOString() });
  }

  const exportInProgress = Boolean(exportStatus && ["queued", "running"].includes(exportStatus.status));
  const diagnosticsInProgress = Boolean(diagnosticsStatus && ["queued", "running"].includes(diagnosticsStatus.status));
  const restoreIsInProgress = Boolean(restoreStatus && restoreInProgress(restoreStatus.status));

  return <section className="settings-section data-management" data-testid="data-management">
    <h2>数据管理</h2>
    <div className="data-row"><select value={format} aria-label="导出格式" disabled={restoreIsInProgress || exportInProgress} onChange={(event) => setFormat(event.target.value as "json" | "markdown")}><option value="json">JSON 数据</option><option value="markdown">Markdown 文档</option></select><button type="button" disabled={restoreIsInProgress || exportInProgress} onClick={() => void createExport()}>导出个人数据</button></div>
    <p className="settings-note">{EXPORT_SNAPSHOT_NOTICE}</p>
    {exportStatus && <StatusLine label="个人数据导出" status={exportStatus.status} failed={exportStatus.status === "failed"} detail={exportLocationDetail(exportStatus)} />}
    {exportPollError && <p className="settings-message" role="alert">{exportPollError} 泡泡会继续检查导出状态。</p>}
    <button type="button" disabled={restoreIsInProgress || diagnosticsInProgress} onClick={() => void createDiagnostics()}>导出诊断信息</button>
    {diagnosticsStatus && <StatusLine label="诊断信息导出" status={diagnosticsStatus.status} failed={diagnosticsStatus.status === "failed"} detail={exportLocationDetail(diagnosticsStatus)} />}
    {diagnosticsPollError && <p className="settings-message" role="alert">{diagnosticsPollError} 泡泡会继续检查诊断导出状态。</p>}
    <div className="data-heading"><strong>备份</strong><button type="button" disabled={restoreIsInProgress} onClick={() => void loadBackups()}>刷新</button></div>
    {backups.length === 0 ? <p className="settings-note">暂无可用备份。</p> : backups.map((backup) => <div className="backup-row" key={backup.backupId}><span>{new Date(backup.createdAt).toLocaleString("zh-CN")} · {formatBytes(backup.sizeBytes)}</span><button type="button" disabled={restoreIsInProgress} onClick={() => void restore(backup.backupId)}>{restoreCandidate === backup.backupId ? "确认恢复" : "恢复"}</button></div>)}
    {restoreStatus && <StatusLine label="备份恢复" status={restoreStatus.status} failed={restoreStatus.status.startsWith("failed")} />}
    {restorePollError && <p className="settings-message" role="alert">{restorePollError} 泡泡会继续检查恢复状态。</p>}
    {restoreCandidate && !restoreIsInProgress && <div className="data-confirmation" role="status"><span>再次点击确认恢复。恢复期间将暂停记录。</span><button type="button" onClick={() => setRestoreCandidate(null)}>取消</button></div>}
    {message && <p className="settings-message" role="status">{message}</p>}
  </section>;
}

function StatusLine({ label, status, failed, detail }: { label: string; status: OperationStatus; failed: boolean; detail?: string }) { const succeeded = status === "ready" || status === "succeeded"; return <div className={`operation-status ${failed ? "failed" : succeeded ? "succeeded" : "pending"}`}><strong>{label}</strong><span>{operationStatusLabel(status)}</span>{detail && <small>{detail}</small>}</div>; }
export function operationStatusLabel(status: OperationStatus) { return operationStatusLabels[status]; }
export function exportLocationDetail(status: { status: OperationStatus; path: string | null; sha256?: string | null }): string | undefined { return status.status === "ready" && status.path ? `保存位置：${status.path}` : undefined; }
function restoreInProgress(status: BackupRestoreStatusV1["status"]) { return ["queued", "validating", "quiescing", "replacing", "reopening"].includes(status); }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
