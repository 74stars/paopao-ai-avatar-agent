import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  AiProviderAuthModeV2,
  AiProviderProfileV2,
  AiProviderProfilesV2,
  AiProviderProtocolV2,
  AiStructuredOutputModeV2,
  DomainEventV1,
  FeishuDeliveryIssueV1,
  SaveAiProviderProfileRequestV2,
} from "@paopao/contracts";
import { DataManagement } from "./DataManagement";
import { userErrorMessage } from "../error-messages";

type PublicSettings = Extract<Awaited<ReturnType<NonNullable<typeof window.paopao>["settings"]["getPublic"]>>, { ok: true }>["data"];
type FeishuStatusEvent = Extract<DomainEventV1, { type: "feishu:status" }>;
type AiProviderProbeResultV2 = Extract<Awaited<ReturnType<NonNullable<typeof window.paopao>["aiProviders"]["probe"]>>, { ok: true }>["data"];
type AiProviderProbeStatusV2 = AiProviderProbeResultV2["status"];
type CodexDiscoveryV2 = Extract<Awaited<ReturnType<NonNullable<typeof window.paopao>["aiProviders"]["discoverCodex"]>>, { ok: true }>["data"];

interface PendingResolution {
  issueKey: string;
  action: "assume_sent" | "retry_once";
  requestId: string;
}

type AiProviderReasoningEffortV2 = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

interface DirectDraft {
  kind: "direct";
  id: string;
  name: string;
  providerId: string;
  protocol: AiProviderProtocolV2;
  baseUrl: string;
  model: string;
  authMode: AiProviderAuthModeV2;
  authHeaderName: string;
  structuredOutput: AiStructuredOutputModeV2;
  timeoutMs: string;
}

interface CodexDraft {
  kind: "codex";
  id: string;
  name: string;
  profile: string;
  model: string;
  reasoningEffort: AiProviderReasoningEffortV2 | "";
  codexHome: string;
}

type AiDraft = DirectDraft | CodexDraft;

const AUTH_MODE_TEXT: Record<AiProviderAuthModeV2, string> = {
  bearer: "Bearer",
  api_key_header: "API Key Header",
  none: "无认证",
};

const REASONING_EFFORTS: readonly AiProviderReasoningEffortV2[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export function SettingsPanel({
  onClose,
  onOpenEntry,
  latestFeishuStatus,
}: {
  onClose(): void;
  onOpenEntry?(entryId: string): void;
  latestFeishuStatus?: FeishuStatusEvent | null;
}) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [message, setMessage] = useState("凭据保存后不会显示或读回。");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<"feishu" | null>(null);
  const [bindingCode, setBindingCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [issues, setIssues] = useState<FeishuDeliveryIssueV1[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const issuesLoadingRef = useRef(false);
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const [statusEvent, setStatusEvent] = useState<FeishuStatusEvent | null>(latestFeishuStatus ?? null);

  const [aiProfiles, setAiProfiles] = useState<AiProviderProfilesV2 | null>(null);
  const [aiTab, setAiTab] = useState<"direct" | "codex">("direct");
  const [aiDraft, setAiDraft] = useState<AiDraft>(() => blankDirectDraft());
  const [editingProfile, setEditingProfile] = useState<AiProviderProfileV2 | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [probeResults, setProbeResults] = useState<Record<string, AiProviderProbeResultV2>>({});
  const [codexDiscovery, setCodexDiscovery] = useState<CodexDiscoveryV2 | null>(null);
  const [confirmingDeleteProfile, setConfirmingDeleteProfile] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!window.paopao) return;
    const result = await window.paopao.settings.getPublic({ version: 1 });
    if (result.ok) setSettings(result.data);
    else setMessage(userErrorMessage(result.error, "settings"));
  }, []);

  const loadIssues = useCallback(async (cursor?: string) => {
    if (!window.paopao || issuesLoadingRef.current) return;
    issuesLoadingRef.current = true;
    setIssuesLoading(true);
    try {
      const result = await window.paopao.feishu.listDeliveryIssues({ version: 1, limit: 50, ...(cursor ? { cursor } : {}) });
      if (!result.ok) {
        setMessage(userErrorMessage(result.error, "settings"));
        return;
      }
      setIssues((current) => cursor ? [...current, ...result.data.items] : result.data.items);
      setNextCursor(result.data.nextCursor);
    } finally {
      issuesLoadingRef.current = false;
      setIssuesLoading(false);
    }
  }, []);

  const loadAiProviders = useCallback(async () => {
    const api = window.paopao?.aiProviders;
    if (!api) return;
    const result = await api.list({ version: 2 });
    if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
    else setAiProfiles(result.data);
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadIssues();
    void loadAiProviders();
    const refresh = window.setInterval(() => { void loadSettings(); void loadIssues(); void loadAiProviders(); }, 15_000);
    return () => window.clearInterval(refresh);
  }, [loadAiProviders]); // Queries are intentionally run once when the panel opens.

  useEffect(() => window.paopao?.onDomainEvent((event) => {
    if (event.type === "feishu:status") {
      setStatusEvent(event);
      void loadSettings();
    }
    if (event.type === "feishu:delivery-issue") {
      void loadSettings();
      void loadIssues();
    }
  }), [loadIssues, loadSettings]);

  async function saveFeishu(event: FormEvent) {
    event.preventDefault();
    if (!window.paopao || busy || !appId.trim() || !appSecret.trim()) return;
    setBusy("feishu-save");
    setBindingCode(null);
    setMessage("正在加密保存飞书凭据...");
    try {
      const result = await window.paopao.settings.saveFeishuCredential({ version: 1, appId: appId.trim(), appSecret: appSecret.trim() });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else {
        setAppId("");
        setConfirmingDelete(null);
        setMessage("飞书凭据已保存，可建立长连接。");
        await loadSettings();
      }
    } finally {
      setAppSecret("");
      setBusy(null);
    }
  }

  async function removeCredential() {
    if (!window.paopao || busy) return;
    if (confirmingDelete !== "feishu") {
      setConfirmingDelete("feishu");
      setMessage("再次点击确认删除飞书凭据。");
      return;
    }
    setBusy("feishu-delete");
    try {
      const result = await window.paopao.settings.deleteFeishuCredential({ version: 1 });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else {
        setBindingCode(null);
        setConfirmingDelete(null);
        setMessage("飞书凭据已删除。");
        await loadSettings();
      }
    } finally {
      setAppSecret("");
      setBusy(null);
    }
  }

  async function setConnection(action: "connect" | "disconnect") {
    if (!window.paopao || busy) return;
    setBusy(`feishu-${action}`);
    setBindingCode(null);
    try {
      const result = action === "connect"
        ? await window.paopao.feishu.connect({ version: 1 })
        : await window.paopao.feishu.disconnect({ version: 1 });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else setMessage(action === "connect" ? "正在建立飞书长连接。" : "飞书已离线。关闭应用期间不会接收消息。");
      await loadSettings();
    } finally {
      setBusy(null);
    }
  }

  async function createBindingCode() {
    if (!window.paopao || busy) return;
    setBusy("binding-code");
    setBindingCode(null);
    try {
      const result = await window.paopao.feishu.createBindingCode({ version: 1 });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else {
        setBindingCode(result.data);
        setMessage("已生成新的绑定码，旧码立即失效。");
      }
    } finally {
      setBusy(null);
    }
  }

  async function updateReplyMode(mode: "ack_only" | "insight") {
    if (!window.paopao || busy || settings?.feishu.replyMode === mode) return;
    setBusy("reply-mode");
    try {
      const result = await window.paopao.settings.updatePublic({ version: 1, feishuReplyMode: mode });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else {
        setSettings(result.data);
        setMessage(mode === "ack_only" ? "飞书只发送保存确认。" : "后续飞书文字会生成并发送洞察。");
      }
    } finally {
      setBusy(null);
    }
  }

  function prepareResolution(issue: FeishuDeliveryIssueV1, action: PendingResolution["action"]) {
    setPendingResolution({ issueKey: issueKey(issue), action, requestId: globalThis.crypto.randomUUID() });
  }

  async function resolveIssue(issue: FeishuDeliveryIssueV1) {
    if (!window.paopao || busy || !pendingResolution || pendingResolution.issueKey !== issueKey(issue)) return;
    setBusy(`issue-${pendingResolution.issueKey}`);
    try {
      const result = await window.paopao.feishu.resolveDeliveryIssue(buildDeliveryResolutionRequest(pendingResolution.action, pendingResolution.requestId, issue));
      if (!result.ok) {
        setMessage(userErrorMessage(result.error, "settings"));
        return;
      }
      setMessage(result.data.status === "pending" ? "已安排一次人工重试。" : "已标记为已发送。");
      setPendingResolution(null);
      await Promise.all([loadSettings(), loadIssues()]);
    } finally {
      setBusy(null);
    }
  }

  function switchAiTab(kind: "direct" | "codex") {
    setAiTab(kind);
    setEditingProfile(null);
    setAiDraft(kind === "direct" ? blankDirectDraft() : blankCodexDraft());
    setApiKey("");
    setCodexDiscovery(null);
    setConfirmingDeleteProfile(null);
  }

  function startEdit(profile: AiProviderProfileV2) {
    setEditingProfile(profile);
    setAiDraft(profileToDraft(profile));
    setApiKey("");
    setCodexDiscovery(null);
    setConfirmingDeleteProfile(null);
  }

  function startNewDraft() {
    setEditingProfile(null);
    setAiDraft(aiTab === "direct" ? blankDirectDraft() : blankCodexDraft());
    setApiKey("");
    setCodexDiscovery(null);
    setConfirmingDeleteProfile(null);
  }

  function updateDirect<K extends keyof DirectDraft>(key: K, value: DirectDraft[K]) {
    setAiDraft((current) => current?.kind === "direct" ? { ...current, [key]: value } : current);
  }

  function updateCodex<K extends keyof CodexDraft>(key: K, value: CodexDraft[K]) {
    setAiDraft((current) => current?.kind === "codex" ? { ...current, [key]: value } : current);
  }

  async function saveAiProfile(event: FormEvent) {
    event.preventDefault();
    const api = window.paopao?.aiProviders;
    if (!api || busy || !aiDraft) return;
    if (aiDraft.kind === "direct") {
      const timeoutMs = Number(aiDraft.timeoutMs);
      if (!aiDraft.name.trim() || !aiDraft.providerId.trim() || !aiDraft.baseUrl.trim() || !aiDraft.model.trim() || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
        setMessage("请补全 Direct 字段，超时需在 1000–300000 毫秒之间。");
        return;
      }
    } else if (!aiDraft.name.trim()) {
      setMessage("请填写 Codex 配置名称。");
      return;
    }
    setBusy("ai-save");
    setMessage(aiDraft.kind === "direct" ? "正在保存 Provider 配置..." : "正在保存 Codex 配置...");
    try {
      const request = aiDraft.kind === "direct"
        ? buildSaveAiProviderRequest({ ...aiDraft, timeoutMs: Number(aiDraft.timeoutMs), credential: apiKey })
        : buildSaveAiProviderRequest(aiDraft);
      const result = await api.save(request);
      if (!result.ok) {
        setMessage(userErrorMessage(result.error, "settings"));
        return;
      }
      setEditingProfile(result.data.profile);
      setAiDraft(profileToDraft(result.data.profile));
      setConfirmingDeleteProfile(null);
      setMessage(result.data.profile.kind === "direct"
        ? result.data.profile.credentialConfigured
          ? "Provider 配置已保存，API Key 保存后立即清空，不会回显。"
          : "Provider 配置已保存，但当前缺少凭据；地址或认证方式变化后需重新输入 API Key。"
        : "Codex 配置已保存。");
      await loadAiProviders();
    } finally {
      setApiKey("");
      setBusy(null);
    }
  }

  async function runProbe(profile: AiProviderProfileV2) {
    const api = window.paopao?.aiProviders;
    if (!api || busy) return;
    setBusy(`ai-probe-${profile.id}`);
    setMessage(`正在测试“${profile.name}”，这可能产生真实 Provider 调用...`);
    try {
      const result = await api.probe({ version: 2, profileId: profile.id });
      if (!result.ok) {
        setMessage(userErrorMessage(result.error, "settings"));
        return;
      }
      setProbeResults((current) => ({ ...current, [profile.id]: result.data }));
      setMessage(`连接测试完成：${probeStatusLabel(result.data.status)}。测试可能已产生真实调用。`);
    } finally {
      setBusy(null);
    }
  }

  async function activateProfile(profile: AiProviderProfileV2) {
    const api = window.paopao?.aiProviders;
    if (!api || busy) return;
    setBusy(`ai-activate-${profile.id}`);
    try {
      const result = await api.activate({ version: 2, profileId: profile.id });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else {
        setAiProfiles(result.data);
        setMessage(`已激活“${profile.name}”，后续 AI 任务将使用该配置。`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function deleteProfile(profile: AiProviderProfileV2) {
    const api = window.paopao?.aiProviders;
    if (!api || busy) return;
    if (confirmingDeleteProfile !== profile.id) {
      setConfirmingDeleteProfile(profile.id);
      setMessage(`再次点击确认删除“${profile.name}”。`);
      return;
    }
    setBusy(`ai-delete-${profile.id}`);
    try {
      const result = await api.delete({ version: 2, profileId: profile.id });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else {
        setConfirmingDeleteProfile(null);
        setProbeResults((current) => {
          const next = { ...current };
          delete next[profile.id];
          return next;
        });
        if (editingProfile?.id === profile.id) startNewDraft();
        setMessage(`已删除“${profile.name}”。`);
        await loadAiProviders();
      }
    } finally {
      setBusy(null);
    }
  }

  async function runDiscoverCodex() {
    const api = window.paopao?.aiProviders;
    if (!api || busy || !aiDraft || aiDraft.kind !== "codex") return;
    setBusy("ai-discover");
    setCodexDiscovery(null);
    setMessage("正在发现本机 Codex 环境（只运行本地命令，不会调用远端 Provider）...");
    try {
      const result = await api.discoverCodex({
        version: 2,
        ...(aiDraft.codexHome.trim() ? { codexHome: aiDraft.codexHome.trim() } : {}),
        ...(aiDraft.profile.trim() ? { profile: aiDraft.profile.trim() } : {}),
      });
      if (!result.ok) {
        setMessage(userErrorMessage(result.error, "settings"));
        return;
      }
      setCodexDiscovery(result.data);
      setMessage(result.data.installed && result.data.authenticated ? "Codex 环境可用。" : "Codex 环境发现完成，请查看下方状态。");
    } finally {
      setBusy(null);
    }
  }

  const connectionStatus = settings && !settings.feishu.configured
    ? "not_configured"
    : statusEvent?.status ?? settings?.feishu.status ?? "not_configured";
  const connectionError = connectionStatus === "error" && statusEvent?.status === "error" ? statusEvent.errorCode : undefined;
  const activeProfile = aiProfiles?.profiles.find((profile) => profile.id === aiProfiles.activeProfileId) ?? null;
  const visibleProfiles = (aiProfiles?.profiles ?? []).filter((profile) => profile.kind === aiTab);

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="settings-panel" aria-label="设置" data-testid="settings-panel">
        <header className="settings-header">
          <strong>设置</strong>
          <button className="icon-command" type="button" aria-label="关闭设置" title="关闭" onClick={onClose}>x</button>
        </header>

        <section className="settings-section ai-providers-settings" data-testid="ai-providers-settings">
          <div className="settings-section-heading">
            <h2>AI Provider</h2>
            <span data-testid="ai-providers-count">{aiProfiles === null ? "读取中" : `${aiProfiles.profiles.length} 个配置`}</span>
          </div>

          <p className="settings-status" data-testid="ai-provider-active-status">
            {aiProfiles === null ? "读取中..." : activeProfile ? `当前激活：${aiProviderSummaryLabel(activeProfile)}（${activeProfile.kind === "codex" ? "复用 Codex" : "通用 Provider"}）` : "未激活任何 Provider"}
          </p>

          <div className="settings-control-row">
            <span>配置类型</span>
            <div className="segmented-control" role="group" aria-label="AI Provider 类型">
              <button type="button" className={aiTab === "direct" ? "active" : ""} disabled={Boolean(busy)} onClick={() => switchAiTab("direct")} data-testid="ai-provider-tab-direct">通用 Provider</button>
              <button type="button" className={aiTab === "codex" ? "active" : ""} disabled={Boolean(busy)} onClick={() => switchAiTab("codex")} data-testid="ai-provider-tab-codex">复用 Codex</button>
            </div>
          </div>

          <p className="settings-note">连接测试会向已保存的 Provider 发起真实请求，可能产生调用费用；Codex 发现只运行本机命令。</p>

          <div className="ai-provider-list" data-testid="ai-provider-list">
            {visibleProfiles.length === 0 && <p className="settings-note">还没有{aiTab === "direct" ? "通用 Provider" : "Codex"}配置，可在下方新建。</p>}
            {visibleProfiles.map((profile) => {
              const isActive = profile.id === aiProfiles?.activeProfileId;
              const probeResult = probeResults[profile.id];
              const confirming = confirmingDeleteProfile === profile.id;
              return (
                <article className={`ai-provider-row${isActive ? " active" : ""}`} key={profile.id} data-testid={`ai-provider-profile-${profile.id}`}>
                  <div className="ai-provider-row-heading">
                    <strong>{profile.name}</strong>
                    <span className={`ai-provider-badge ${isActive && profile.credentialConfigured ? "active" : profile.credentialConfigured ? "configured" : "missing"}`} data-testid={`ai-provider-state-${profile.id}`}>
                      {isActive
                        ? profile.credentialConfigured ? "当前激活 · 可用" : "当前激活 · 缺少凭据"
                        : profile.credentialConfigured ? "凭据已配置" : "缺少凭据"}
                    </span>
                  </div>
                  <p className="ai-provider-row-summary">{aiProviderSummaryLabel(profile)}{profile.kind === "direct" ? ` · ${AUTH_MODE_TEXT[profile.authMode]}` : ""}</p>
                  <div className="ai-provider-row-actions">
                    <button type="button" disabled={Boolean(busy)} onClick={() => startEdit(profile)}>编辑</button>
                    <button type="button" title="可能产生真实 Provider 调用" disabled={Boolean(busy)} onClick={() => void runProbe(profile)} data-testid={`ai-provider-test-${profile.id}`}>测试连接</button>
                    {!isActive && <button type="button" disabled={Boolean(busy)} onClick={() => void activateProfile(profile)} data-testid={`ai-provider-activate-${profile.id}`}>激活</button>}
                    <button type="button" className={confirming ? "danger" : ""} disabled={Boolean(busy)} onClick={() => void deleteProfile(profile)} data-testid={`ai-provider-delete-${profile.id}`}>{confirming ? "确认删除" : "删除"}</button>
                  </div>
                  {probeResult && (
                    <p className={`probe-result ${probeResult.status === "ready" ? "ready" : probeResult.status === "not_configured" ? "warning" : "error"}`} data-testid={`ai-provider-probe-${profile.id}`}>
                      {probeStatusLabel(probeResult.status)}{probeResult.latencyMs !== null ? ` · ${probeResult.latencyMs}ms` : ""}{probeResult.status === "ready" && probeResult.model ? ` · ${probeResult.model}` : ""}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          {aiDraft && (
            <div className="ai-provider-editor" data-testid="ai-provider-editor">
              <div className="settings-section-heading ai-provider-editor-heading">
                <strong>{editingProfile ? `编辑：${editingProfile.name}` : "新建配置"}</strong>
              </div>
              <form className="settings-form" onSubmit={(event) => void saveAiProfile(event)}>
                {aiDraft.kind === "direct" ? (
                  <>
                    <label>名称<input data-testid="ai-provider-name" autoComplete="off" maxLength={80} value={aiDraft.name} disabled={Boolean(busy)} onChange={(event) => updateDirect("name", event.target.value)} /></label>
                    <label>Provider ID<input data-testid="ai-provider-provider-id" autoComplete="off" maxLength={100} value={aiDraft.providerId} disabled={Boolean(busy)} onChange={(event) => updateDirect("providerId", event.target.value)} placeholder="例如 openai" /></label>
                    <label>协议<select data-testid="ai-provider-protocol" value={aiDraft.protocol} disabled={Boolean(busy)} onChange={(event) => updateDirect("protocol", event.target.value as AiProviderProtocolV2)}>
                      <option value="openai_responses">OpenAI Responses</option>
                      <option value="openai_chat_completions">OpenAI Chat Completions</option>
                    </select></label>
                    <label>Base URL<input data-testid="ai-provider-base-url" autoComplete="off" maxLength={1000} value={aiDraft.baseUrl} disabled={Boolean(busy)} onChange={(event) => updateDirect("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></label>
                    <label>模型<input data-testid="ai-provider-model" autoComplete="off" maxLength={200} value={aiDraft.model} disabled={Boolean(busy)} onChange={(event) => updateDirect("model", event.target.value)} /></label>
                    <label>认证模式<select data-testid="ai-provider-auth-mode" value={aiDraft.authMode} disabled={Boolean(busy)} onChange={(event) => updateDirect("authMode", event.target.value as AiProviderAuthModeV2)}>
                      <option value="bearer">Bearer Token</option>
                      <option value="api_key_header">API Key Header</option>
                      <option value="none">无认证</option>
                    </select></label>
                    {aiDraft.authMode === "api_key_header" && <label>认证 Header<input data-testid="ai-provider-auth-header" autoComplete="off" maxLength={100} value={aiDraft.authHeaderName} disabled={Boolean(busy)} onChange={(event) => updateDirect("authHeaderName", event.target.value)} placeholder="例如 x-api-key" /></label>}
                    {aiDraft.authMode !== "none" && <label>API Key（保存后立即清空，不回显）<input type="password" data-testid="ai-provider-api-key" autoComplete="off" maxLength={4096} value={apiKey} disabled={Boolean(busy)} onChange={(event) => setApiKey(event.target.value)} placeholder="留空表示保留已保存凭据" /></label>}
                    <label>结构化输出<select data-testid="ai-provider-structured-output" value={aiDraft.structuredOutput} disabled={Boolean(busy)} onChange={(event) => updateDirect("structuredOutput", event.target.value as AiStructuredOutputModeV2)}>
                      <option value="json_schema">JSON Schema</option>
                      <option value="json_object">JSON Object</option>
                      <option value="prompt_json">Prompt JSON</option>
                    </select></label>
                    <label>超时（毫秒）<input type="number" data-testid="ai-provider-timeout" min={1000} max={300000} step={1000} value={aiDraft.timeoutMs} disabled={Boolean(busy)} onChange={(event) => updateDirect("timeoutMs", event.target.value)} /></label>
                  </>
                ) : (
                  <>
                    <label>名称<input data-testid="ai-provider-name" autoComplete="off" maxLength={80} value={aiDraft.name} disabled={Boolean(busy)} onChange={(event) => updateCodex("name", event.target.value)} /></label>
                    <label>Profile<input data-testid="ai-provider-codex-profile" autoComplete="off" maxLength={100} value={aiDraft.profile} disabled={Boolean(busy)} onChange={(event) => updateCodex("profile", event.target.value)} placeholder="可选，例如 default" /></label>
                    <label>模型<input data-testid="ai-provider-codex-model" autoComplete="off" maxLength={200} value={aiDraft.model} disabled={Boolean(busy)} onChange={(event) => updateCodex("model", event.target.value)} placeholder="可选，留空使用 Codex 默认" /></label>
                    <label>Reasoning Effort<select data-testid="ai-provider-codex-reasoning" value={aiDraft.reasoningEffort} disabled={Boolean(busy)} onChange={(event) => updateCodex("reasoningEffort", event.target.value as AiProviderReasoningEffortV2 | "")}>
                      <option value="">默认</option>
                      {REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                    </select></label>
                    <label>Codex Home<input data-testid="ai-provider-codex-home" autoComplete="off" maxLength={1000} value={aiDraft.codexHome} disabled={Boolean(busy)} onChange={(event) => updateCodex("codexHome", event.target.value)} placeholder="可选，例如 ~/.codex" /></label>
                  </>
                )}
                <div className="settings-actions">
                  <button className="primary" type="submit" disabled={Boolean(busy)} data-testid="ai-provider-save">保存配置</button>
                  {editingProfile && <button type="button" disabled={Boolean(busy)} onClick={startNewDraft}>取消编辑</button>}
                </div>
              </form>
              {aiDraft.kind === "codex" && (
                <>
                  <div className="settings-actions ai-provider-discover-actions">
                    <button type="button" disabled={Boolean(busy)} onClick={() => void runDiscoverCodex()} data-testid="ai-provider-discover">发现本机 Codex</button>
                  </div>
                  {codexDiscovery && (
                    <div className={`codex-discovery ${codexDiscovery.errorCode ? (codexDiscovery.errorCode === "CODEX_NOT_INSTALLED" ? "error" : "warning") : ""}`} data-testid="codex-discovery">
                      <dl>
                        <div><dt>已安装</dt><dd>{codexDiscovery.installed ? "是" : "否"}</dd></div>
                        <div><dt>已认证</dt><dd>{codexDiscovery.authenticated ? "是" : "否"}</dd></div>
                        <div><dt>CLI 版本</dt><dd>{codexDiscovery.cliVersion ?? "未知"}</dd></div>
                        <div><dt>认证方式</dt><dd>{codexDiscovery.authMode ?? "未知"}</dd></div>
                      </dl>
                      {codexDiscovery.errorCode && <p className="settings-note" data-testid="codex-discovery-error">{codexDiscoveryErrorLabel(codexDiscovery.errorCode)}</p>}
                      {codexDiscovery.models.length > 0 && (
                        <ul className="codex-models" data-testid="codex-models">
                          {codexDiscovery.models.slice(0, 12).map((model) => (
                            <li key={model.id}>
                              <span>{model.displayName ?? model.id}{model.isDefault ? "（默认）" : ""}</span>
                              <small>{model.defaultReasoningEffort ?? ""}</small>
                            </li>
                          ))}
                        </ul>
                      )}
                      {codexDiscovery.models.length > 12 && <p className="settings-note">共 {codexDiscovery.models.length} 个模型，仅显示前 12 个。</p>}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section className="settings-section feishu-settings" data-testid="feishu-settings">
          <div className="settings-section-heading">
            <h2>飞书连接 · 实验性增量</h2>
            <span className={`connection-state ${connectionStatus}`} data-testid="feishu-connection-status">{connectionLabel(connectionStatus, connectionError)}</span>
          </div>
          <p className="settings-status" data-testid="feishu-config-status">
            {settings?.feishu.configured ? `已配置：${settings.feishu.appIdMasked}` : "未配置飞书应用"}
          </p>
          <form className="settings-form" onSubmit={(event) => void saveFeishu(event)}>
            <label>App ID<input autoComplete="off" maxLength={200} value={appId} disabled={Boolean(busy)} onChange={(event) => setAppId(event.target.value)} data-testid="feishu-app-id" /></label>
            <label>App Secret<input type="password" autoComplete="off" maxLength={512} value={appSecret} disabled={Boolean(busy)} onChange={(event) => setAppSecret(event.target.value)} data-testid="feishu-app-secret" /></label>
            <div className="settings-actions">
              <button className="primary" type="submit" disabled={Boolean(busy) || !appId.trim() || !appSecret.trim()} data-testid="feishu-credential-save">保存凭据</button>
              <button type="button" disabled={Boolean(busy) || !settings?.feishu.configured} onClick={() => void removeCredential()} data-testid="feishu-credential-delete">{confirmingDelete === "feishu" ? "确认删除" : "删除凭据"}</button>
            </div>
          </form>
          <div className="settings-actions connection-actions">
            <button className="primary" type="button" disabled={Boolean(busy) || !settings?.feishu.configured || connectionStatus === "connected" || connectionStatus === "connecting"} onClick={() => void setConnection("connect")} data-testid="feishu-connect">连接</button>
            <button type="button" disabled={Boolean(busy) || connectionStatus === "disconnected" || connectionStatus === "not_configured"} onClick={() => void setConnection("disconnect")} data-testid="feishu-disconnect">断开</button>
          </div>

          <div className="settings-control-row">
            <span>回复模式</span>
            <div className="segmented-control" role="group" aria-label="飞书回复模式">
              <button type="button" className={settings?.feishu.replyMode === "ack_only" ? "active" : ""} disabled={Boolean(busy)} onClick={() => void updateReplyMode("ack_only")} data-testid="feishu-mode-ack-only">仅确认</button>
              <button type="button" className={settings?.feishu.replyMode === "insight" ? "active" : ""} disabled={Boolean(busy)} onClick={() => void updateReplyMode("insight")} data-testid="feishu-mode-insight">确认 + 洞察</button>
            </div>
          </div>

          <div className="binding-row">
            <button type="button" disabled={Boolean(busy) || connectionStatus !== "connected"} onClick={() => void createBindingCode()} data-testid="feishu-create-binding-code">生成绑定码</button>
            {bindingCode && <div className="binding-code" data-testid="feishu-binding-code"><strong>{bindingCode.code}</strong><span>{formatExpiry(bindingCode.expiresAt)} 失效</span></div>}
            {!bindingCode && <span className={`binding-state ${settings?.feishu.bound ? "bound" : ""}`} data-testid="feishu-binding-status">{settings?.feishu.bound ? "已绑定" : "未绑定"}</span>}
          </div>
        </section>

        <section className="settings-section delivery-issues" data-testid="feishu-delivery-issues">
          <div className="settings-section-heading"><h2>投递异常</h2><span>{settings?.feishu.deliveryIssueCount ?? issues.length}</span></div>
          {issues.length === 0 && <p className="settings-note">当前没有需要人工处理的投递。</p>}
          {issues.map((issue) => {
            const key = issueKey(issue);
            const pending = pendingResolution?.issueKey === key ? pendingResolution : null;
            return <article className="delivery-issue" key={key} data-testid={`delivery-issue-${issue.phase}`}>
              <div className="delivery-issue-heading"><strong>{issue.phase === "ack" ? "保存确认" : "洞察结果"}</strong><span>{issue.status === "ambiguous" ? "发送结果未知" : "最终失败"}</span></div>
              <dl><div><dt>错误</dt><dd>{issue.errorCode}</dd></div><div><dt>尝试</dt><dd>{issue.attempts}</dd></div><div><dt>时间</dt><dd>{formatTime(issue.updatedAt)}</dd></div></dl>
              {issue.entryId && onOpenEntry && <button className="entry-link" type="button" onClick={() => onOpenEntry(issue.entryId!)}>查看对应记录</button>}
              {pending && <p className={`resolution-warning ${pending.action}`} role="alert">{pending.action === "retry_once" ? "再次发送可能产生重复回复。确认后只重试一次。" : "确认将此投递视为已发送，不会再次自动发送。"}</p>}
              <div className="issue-actions">
                <button type="button" disabled={Boolean(busy)} onClick={() => pending?.action === "assume_sent" ? void resolveIssue(issue) : prepareResolution(issue, "assume_sent")} data-testid="delivery-assume-sent">{pending?.action === "assume_sent" ? "确认已发送" : "标记已发送"}</button>
                <button type="button" disabled={Boolean(busy) || !issue.manualRetryAvailable} onClick={() => pending?.action === "retry_once" ? void resolveIssue(issue) : prepareResolution(issue, "retry_once")} data-testid="delivery-retry-once">{pending?.action === "retry_once" ? "确认重试一次" : "重试一次"}</button>
                {pending && <button type="button" disabled={Boolean(busy)} onClick={() => setPendingResolution(null)}>取消</button>}
              </div>
            </article>;
          })}
          {nextCursor && <button className="load-more" type="button" disabled={issuesLoading} onClick={() => void loadIssues(nextCursor)}>{issuesLoading ? "读取中..." : "加载更多"}</button>}
        </section>

        <p className="settings-note">safeStorage 只保护凭据；SQLite 中的原文未做整库加密。</p>
        <footer role="status" className="settings-message" data-testid="settings-message">{message}</footer>
        <DataManagement />
      </aside>
    </div>
  );
}

function issueKey(issue: FeishuDeliveryIssueV1) {
  return `${issue.messageKey}:${issue.phase}`;
}

function blankDirectDraft(): DirectDraft {
  return {
    kind: "direct",
    id: globalThis.crypto.randomUUID(),
    name: "",
    providerId: "",
    protocol: "openai_responses",
    baseUrl: "",
    model: "",
    authMode: "bearer",
    authHeaderName: "",
    structuredOutput: "json_schema",
    timeoutMs: "60000",
  };
}

function blankCodexDraft(): CodexDraft {
  return {
    kind: "codex",
    id: globalThis.crypto.randomUUID(),
    name: "",
    profile: "",
    model: "",
    reasoningEffort: "",
    codexHome: "",
  };
}

function profileToDraft(profile: AiProviderProfileV2): AiDraft {
  if (profile.kind === "codex") {
    return {
      kind: "codex",
      id: profile.id,
      name: profile.name,
      profile: profile.profile ?? "",
      model: profile.model ?? "",
      reasoningEffort: profile.reasoningEffort ?? "",
      codexHome: profile.codexHome ?? "",
    };
  }
  return {
    kind: "direct",
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
    authMode: profile.authMode,
    authHeaderName: profile.authHeaderName ?? "",
    structuredOutput: profile.structuredOutput,
    timeoutMs: String(profile.timeoutMs),
  };
}

function codexDiscoveryErrorLabel(errorCode: NonNullable<CodexDiscoveryV2["errorCode"]>): string {
  if (errorCode === "CODEX_NOT_INSTALLED") return "未检测到 Codex CLI，请先安装并确保其位于 PATH。";
  if (errorCode === "CODEX_NOT_AUTHENTICATED") return "Codex 已安装但尚未登录，请先完成登录。";
  return "Codex 环境发现失败，请检查路径后重试。";
}

export type DirectAiProviderDraftInput = {
  kind: "direct";
  id: string;
  name: string;
  providerId: string;
  protocol: AiProviderProtocolV2;
  baseUrl: string;
  model: string;
  authMode: AiProviderAuthModeV2;
  authHeaderName: string;
  structuredOutput: AiStructuredOutputModeV2;
  timeoutMs: number;
  credential?: string;
};

export type CodexAiProviderDraftInput = {
  kind: "codex";
  id: string;
  name: string;
  profile?: string;
  model?: string;
  reasoningEffort?: AiProviderReasoningEffortV2 | "";
  codexHome?: string;
};

export function buildSaveAiProviderRequest(input: DirectAiProviderDraftInput | CodexAiProviderDraftInput): SaveAiProviderProfileRequestV2 {
  if (input.kind === "direct") {
    const profile = {
      id: input.id,
      kind: "direct" as const,
      name: input.name.trim(),
      providerId: input.providerId.trim(),
      protocol: input.protocol,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      model: input.model.trim(),
      authMode: input.authMode,
      authHeaderName: input.authMode === "api_key_header" ? input.authHeaderName.trim() : null,
      structuredOutput: input.structuredOutput,
      timeoutMs: input.timeoutMs,
    };
    const credential = input.authMode === "none" ? undefined : input.credential?.trim();
    return credential ? { version: 2, profile, credential } : { version: 2, profile };
  }
  const profile = {
    id: input.id,
    kind: "codex" as const,
    name: input.name.trim(),
    profile: optionalDraftText(input.profile),
    model: optionalDraftText(input.model),
    reasoningEffort: input.reasoningEffort || null,
    codexHome: optionalDraftText(input.codexHome),
  };
  return { version: 2, profile };
}

function optionalDraftText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function aiProviderSummaryLabel(profile: AiProviderProfileV2): string {
  if (profile.kind === "codex") return profile.model ? `Codex · ${profile.model}` : "Codex · 默认模型";
  return `${profile.providerId} / ${profile.model}`;
}

export function probeStatusLabel(status: AiProviderProbeStatusV2): string {
  return ({ ready: "连接正常", not_configured: "未配置凭据", unavailable: "服务不可用", auth_failed: "认证失败", model_unavailable: "模型不可用", invalid_output: "返回格式异常", timeout: "连接超时" } as const)[status];
}

export function buildDeliveryResolutionRequest(action: PendingResolution["action"], requestId: string, issue: Pick<FeishuDeliveryIssueV1, "messageKey" | "phase">) {
  const base = { version: 1 as const, requestId, messageKey: issue.messageKey, phase: issue.phase };
  return action === "assume_sent"
    ? { ...base, action: "assume_sent" as const, confirmation: "ASSUME_SENT" as const }
    : { ...base, action: "retry_once" as const, confirmation: "RETRY_MAY_DUPLICATE" as const };
}

export function connectionLabel(status: PublicSettings["feishu"]["status"], errorCode?: string) {
  if (status === "error") {
    if (errorCode === "FEISHU_AUTH_FAILED") return "凭据错误";
    if (errorCode === "FEISHU_PERMISSION_DENIED") return "权限不足";
    if (errorCode === "NETWORK_OFFLINE") return "网络离线";
    return "连接异常";
  }
  return ({ not_configured: "未配置", disconnected: "已断开", connecting: "连接中", connected: "已连接", reconnecting: "重连中" } as const)[status];
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
