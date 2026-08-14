import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  AiProviderAuthModeV2,
  AiProviderProfileV2,
  AiProviderProfilesV2,
  AiProviderProtocolV2,
  AiStructuredOutputModeV2,
  DomainEventV1,
  ErrorCode,
  FeishuDeliveryIssueV1,
  SaveAiProviderProfileRequestV2,
} from "@paopao/contracts";
import { DataManagement } from "./DataManagement";
import { userErrorMessage } from "../error-messages";
import { useModalFocus } from "./modal-focus";

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

export interface DirectDraft {
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

export type DirectProviderPresetId = "openai" | "deepseek" | "openrouter" | "local" | "custom";

type DirectProviderPresetDefaults = Pick<DirectDraft, "name" | "providerId" | "protocol" | "baseUrl" | "authMode" | "authHeaderName" | "structuredOutput" | "timeoutMs">;

export interface DirectProviderPreset {
  id: DirectProviderPresetId;
  label: string;
  modelPlaceholder: string;
  defaults: DirectProviderPresetDefaults;
}

export const DIRECT_PROVIDER_PRESETS: readonly DirectProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    modelPlaceholder: "例如 gpt-5",
    defaults: { name: "OpenAI", providerId: "openai", protocol: "openai_responses", baseUrl: "https://api.openai.com/v1", authMode: "bearer", authHeaderName: "", structuredOutput: "json_schema", timeoutMs: "60000" },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    modelPlaceholder: "例如 deepseek-chat",
    defaults: { name: "DeepSeek", providerId: "deepseek", protocol: "openai_chat_completions", baseUrl: "https://api.deepseek.com/v1", authMode: "bearer", authHeaderName: "", structuredOutput: "prompt_json", timeoutMs: "60000" },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    modelPlaceholder: "例如 openai/gpt-4.1",
    defaults: { name: "OpenRouter", providerId: "openrouter", protocol: "openai_chat_completions", baseUrl: "https://openrouter.ai/api/v1", authMode: "bearer", authHeaderName: "", structuredOutput: "prompt_json", timeoutMs: "60000" },
  },
  {
    id: "local",
    label: "本地兼容服务",
    modelPlaceholder: "例如 qwen2.5:7b",
    defaults: { name: "本地服务", providerId: "local", protocol: "openai_chat_completions", baseUrl: "http://127.0.0.1:11434/v1", authMode: "none", authHeaderName: "", structuredOutput: "prompt_json", timeoutMs: "60000" },
  },
  {
    id: "custom",
    label: "自定义服务商",
    modelPlaceholder: "输入服务商支持的模型 ID",
    defaults: { name: "自定义服务商", providerId: "", protocol: "openai_responses", baseUrl: "", authMode: "bearer", authHeaderName: "", structuredOutput: "json_schema", timeoutMs: "60000" },
  },
];

const DEFAULT_DIRECT_PROVIDER_PRESET_ID: DirectProviderPresetId = "openai";

function directProviderPreset(presetId: DirectProviderPresetId): DirectProviderPreset {
  return DIRECT_PROVIDER_PRESETS.find((preset) => preset.id === presetId)!;
}

const AUTH_MODE_TEXT: Record<AiProviderAuthModeV2, string> = {
  bearer: "Bearer 令牌",
  api_key_header: "API Key 请求头",
  none: "无需认证",
};

const REASONING_EFFORTS: readonly AiProviderReasoningEffortV2[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export type SettingsResourceStatus = "loading" | "ready" | "error";

type SettingsResourceLoadState = {
  status: SettingsResourceStatus;
  error: string | null;
};

const INITIAL_RESOURCE_LOAD_STATE: SettingsResourceLoadState = { status: "loading", error: null };

export function settingsResourceView(status: SettingsResourceStatus, hasData: boolean): "loading" | "error" | "ready" {
  if (status === "loading" && !hasData) return "loading";
  if (status === "error" && !hasData) return "error";
  return "ready";
}

export function SettingsPanel({
  onClose,
  onOpenEntry,
  latestFeishuStatus,
}: {
  onClose(): void;
  onOpenEntry?(entryId: string): void;
  latestFeishuStatus?: FeishuStatusEvent | null;
}) {
  const panelRef = useModalFocus<HTMLElement>(onClose);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [settingsLoadState, setSettingsLoadState] = useState<SettingsResourceLoadState>(INITIAL_RESOURCE_LOAD_STATE);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<"feishu" | null>(null);
  const [bindingCode, setBindingCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [issues, setIssues] = useState<FeishuDeliveryIssueV1[] | null>(null);
  const [issuesLoadState, setIssuesLoadState] = useState<SettingsResourceLoadState>(INITIAL_RESOURCE_LOAD_STATE);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const issuesLoadingRef = useRef(false);
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const [statusEvent, setStatusEvent] = useState<FeishuStatusEvent | null>(latestFeishuStatus ?? null);

  const [aiProfiles, setAiProfiles] = useState<AiProviderProfilesV2 | null>(null);
  const [aiProfilesLoadState, setAiProfilesLoadState] = useState<SettingsResourceLoadState>(INITIAL_RESOURCE_LOAD_STATE);
  const [aiTab, setAiTab] = useState<"direct" | "codex">("direct");
  const [directPresetId, setDirectPresetId] = useState<DirectProviderPresetId>(DEFAULT_DIRECT_PROVIDER_PRESET_ID);
  const [aiDraft, setAiDraft] = useState<AiDraft>(() => blankDirectDraft());
  const [editingProfile, setEditingProfile] = useState<AiProviderProfileV2 | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [probeResults, setProbeResults] = useState<Record<string, AiProviderProbeResultV2>>({});
  const [codexDiscovery, setCodexDiscovery] = useState<CodexDiscoveryV2 | null>(null);
  const [confirmingDeleteProfile, setConfirmingDeleteProfile] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const api = window.paopao?.settings;
    if (!api) {
      setSettingsLoadState({ status: "error", error: "设置服务暂时不可用，请重新打开设置后再试。" });
      return;
    }
    const result = await api.getPublic({ version: 1 });
    if (result.ok) {
      setSettings(result.data);
      setSettingsLoadState({ status: "ready", error: null });
    } else {
      setSettingsLoadState({ status: "error", error: userErrorMessage(result.error, "settings") });
    }
  }, []);

  const loadIssues = useCallback(async (cursor?: string) => {
    const api = window.paopao?.feishu;
    if (!api) {
      setIssuesLoadState({ status: "error", error: "投递异常服务暂时不可用，请稍后重试。" });
      return;
    }
    if (issuesLoadingRef.current) return;
    issuesLoadingRef.current = true;
    setIssuesLoading(true);
    setIssuesLoadState((current) => current.status === "ready" ? current : { status: "loading", error: null });
    try {
      const result = await api.listDeliveryIssues({ version: 1, limit: 50, ...(cursor ? { cursor } : {}) });
      if (!result.ok) {
        setIssuesLoadState({ status: "error", error: userErrorMessage(result.error, "settings") });
        return;
      }
      setIssues((current) => cursor ? [...(current ?? []), ...result.data.items] : result.data.items);
      setNextCursor(result.data.nextCursor);
      setIssuesLoadState({ status: "ready", error: null });
    } finally {
      issuesLoadingRef.current = false;
      setIssuesLoading(false);
    }
  }, []);

  const loadAiProviders = useCallback(async () => {
    const api = window.paopao?.aiProviders;
    if (!api) {
      setAiProfilesLoadState({ status: "error", error: "AI 服务配置暂时不可用，请稍后重试。" });
      return;
    }
    const result = await api.list({ version: 2 });
    if (result.ok) {
      setAiProfiles(result.data);
      setAiProfilesLoadState({ status: "ready", error: null });
    } else {
      setAiProfilesLoadState({ status: "error", error: userErrorMessage(result.error, "settings") });
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadIssues();
    void loadAiProviders();
    const refresh = window.setInterval(() => { void loadSettings(); void loadIssues(); void loadAiProviders(); }, 15_000);
    return () => window.clearInterval(refresh);
  }, [loadAiProviders, loadIssues, loadSettings]);

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
    setMessage("正在保存飞书凭据…");
    try {
      const result = await window.paopao.settings.saveFeishuCredential({ version: 1, appId: appId.trim(), appSecret: appSecret.trim() });
      if (!result.ok) setMessage(userErrorMessage(result.error, "settings"));
      else {
        setAppId("");
        setConfirmingDelete(null);
        setMessage("飞书凭据已保存。");
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
      else setMessage(action === "connect" ? "正在连接飞书…" : "飞书已断开。");
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
    if (kind === "direct") setDirectPresetId(DEFAULT_DIRECT_PROVIDER_PRESET_ID);
    setAiDraft(kind === "direct" ? blankDirectDraft() : blankCodexDraft());
    setApiKey("");
    setCodexDiscovery(null);
    setConfirmingDeleteProfile(null);
  }

  function startEdit(profile: AiProviderProfileV2) {
    setEditingProfile(profile);
    if (profile.kind === "direct") setDirectPresetId(inferDirectProviderPreset(profile));
    setAiDraft(profileToDraft(profile));
    setApiKey("");
    setCodexDiscovery(null);
    setConfirmingDeleteProfile(null);
  }

  function startNewDraft() {
    setEditingProfile(null);
    if (aiTab === "direct") setDirectPresetId(DEFAULT_DIRECT_PROVIDER_PRESET_ID);
    setAiDraft(aiTab === "direct" ? blankDirectDraft() : blankCodexDraft());
    setApiKey("");
    setCodexDiscovery(null);
    setConfirmingDeleteProfile(null);
  }

  function updateDirect<K extends keyof DirectDraft>(key: K, value: DirectDraft[K]) {
    setAiDraft((current) => current?.kind === "direct" ? { ...current, [key]: value } : current);
  }

  function chooseDirectProviderPreset(nextPresetId: DirectProviderPresetId) {
    if (nextPresetId === directPresetId) return;
    setAiDraft((current) => current.kind === "direct"
      ? applyDirectProviderPreset(current, directPresetId, nextPresetId)
      : current);
    setDirectPresetId(nextPresetId);
    setApiKey("");
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
        setMessage("请填写完整的 AI 服务配置；超时时间须为 1,000 至 300,000 毫秒。");
        return;
      }
    } else if (!aiDraft.name.trim()) {
      setMessage("请填写 Codex 配置名称。");
      return;
    }
    setBusy("ai-save");
    setMessage(aiDraft.kind === "direct" ? "正在保存 AI 服务配置…" : "正在保存 Codex 配置…");
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
          ? "AI 服务配置已保存。"
          : "AI 服务配置已保存，但当前缺少访问凭据。"
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
    setMessage(`正在测试“${profile.name}”的连接…`);
    try {
      const result = await api.probe({ version: 2, profileId: profile.id });
      if (!result.ok) {
        setMessage(userErrorMessage(result.error, "settings"));
        return;
      }
      setProbeResults((current) => ({ ...current, [profile.id]: result.data }));
      setMessage(`连接测试完成：${probeStatusLabel(result.data.status)}。`);
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
        setMessage(`已切换至“${profile.name}”。`);
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
    setMessage("正在检查本机 Codex…");
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

  const settingsView = settingsResourceView(settingsLoadState.status, settings !== null);
  const aiProfilesView = settingsResourceView(aiProfilesLoadState.status, aiProfiles !== null);
  const issuesView = settingsResourceView(issuesLoadState.status, issues !== null);
  const issueItems = issues ?? [];
  const connectionStatus = settings && !settings.feishu.configured
    ? "not_configured"
    : statusEvent?.status ?? settings?.feishu.status ?? "not_configured";
  const connectionError = connectionStatus === "error" && statusEvent?.status === "error" ? statusEvent.errorCode : undefined;
  const activeProfile = aiProfiles?.profiles.find((profile) => profile.id === aiProfiles.activeProfileId) ?? null;
  const visibleProfiles = (aiProfiles?.profiles ?? []).filter((profile) => profile.kind === aiTab);
  const selectedDirectPreset = directProviderPreset(directPresetId);
  const directTechnicalFields = aiDraft.kind === "direct" ? (
    <>
      <label>服务标识<input data-testid="ai-provider-provider-id" autoComplete="off" maxLength={100} value={aiDraft.providerId} disabled={Boolean(busy)} onChange={(event) => updateDirect("providerId", event.target.value)} placeholder="例如 openai" /></label>
      <label>协议<select data-testid="ai-provider-protocol" value={aiDraft.protocol} disabled={Boolean(busy)} onChange={(event) => updateDirect("protocol", event.target.value as AiProviderProtocolV2)}>
        <option value="openai_responses">OpenAI Responses</option>
        <option value="openai_chat_completions">OpenAI Chat Completions</option>
      </select></label>
      <label>服务地址<input data-testid="ai-provider-base-url" autoComplete="off" maxLength={1000} value={aiDraft.baseUrl} disabled={Boolean(busy)} onChange={(event) => updateDirect("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></label>
      <label>认证模式<select data-testid="ai-provider-auth-mode" value={aiDraft.authMode} disabled={Boolean(busy)} onChange={(event) => updateDirect("authMode", event.target.value as AiProviderAuthModeV2)}>
        <option value="bearer">Bearer 令牌</option>
        <option value="api_key_header">API Key 请求头</option>
        <option value="none">无需认证</option>
      </select></label>
      {aiDraft.authMode === "api_key_header" && <label>认证请求头<input data-testid="ai-provider-auth-header" autoComplete="off" maxLength={100} value={aiDraft.authHeaderName} disabled={Boolean(busy)} onChange={(event) => updateDirect("authHeaderName", event.target.value)} placeholder="例如 x-api-key" /></label>}
      <label>结构化输出<select data-testid="ai-provider-structured-output" value={aiDraft.structuredOutput} disabled={Boolean(busy)} onChange={(event) => updateDirect("structuredOutput", event.target.value as AiStructuredOutputModeV2)}>
        <option value="json_schema">严格结构化输出</option>
        <option value="json_object">JSON 对象</option>
        <option value="prompt_json">提示词约束</option>
      </select></label>
      <label>超时时间（毫秒）<input type="number" data-testid="ai-provider-timeout" min={1000} max={300000} step={1000} value={aiDraft.timeoutMs} disabled={Boolean(busy)} onChange={(event) => updateDirect("timeoutMs", event.target.value)} /></label>
    </>
  ) : null;

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="settings-panel" role="dialog" aria-modal="true" aria-label="设置" tabIndex={-1} ref={panelRef} data-testid="settings-panel">
        <header className="settings-header">
          <strong>设置</strong>
          <button className="icon-command" type="button" aria-label="关闭设置" title="关闭" onClick={onClose}>×</button>
        </header>

        <section className="settings-section ai-providers-settings" data-testid="ai-providers-settings">
          <div className="settings-section-heading">
            <h2>AI 服务</h2>
            <span data-testid="ai-providers-count">{aiProfilesView === "loading" ? "读取中…" : aiProfilesView === "error" ? "读取失败" : `${aiProfiles?.profiles.length ?? 0} 项配置`}</span>
          </div>

          <SettingsResourceNotice state={aiProfilesLoadState} hasData={aiProfiles !== null} loadingLabel="正在读取 AI 服务配置…" onRetry={() => void loadAiProviders()} testId="ai-providers-resource-state" />
          {aiProfilesView === "ready" && <>
          <p className="settings-status" data-testid="ai-provider-active-status">
            {aiProfiles === null ? "读取中…" : activeProfile ? `当前使用：${activeProfile.name} · ${aiProviderSummaryLabel(activeProfile)}` : "尚未选择 AI 服务"}
          </p>

          <div className="settings-control-row">
            <span>接入方式</span>
            <div className="segmented-control" role="group" aria-label="AI 服务接入方式">
              <button type="button" className={aiTab === "direct" ? "active" : ""} disabled={Boolean(busy)} onClick={() => switchAiTab("direct")} data-testid="ai-provider-tab-direct">模型服务</button>
              <button type="button" className={aiTab === "codex" ? "active" : ""} disabled={Boolean(busy)} onClick={() => switchAiTab("codex")} data-testid="ai-provider-tab-codex">本机 Codex</button>
            </div>
          </div>

          {aiTab === "direct" && <p className="settings-note">测试模型服务连接时可能产生调用费用。</p>}

          <div className="ai-provider-list" data-testid="ai-provider-list">
            {visibleProfiles.length === 0 && <p className="settings-note">还没有{aiTab === "direct" ? "模型服务" : "Codex"}配置。</p>}
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
                        ? profile.credentialConfigured ? "当前使用 · 可用" : "当前使用 · 缺少凭据"
                        : profile.credentialConfigured ? "凭据已配置" : "缺少凭据"}
                    </span>
                  </div>
                  <p className="ai-provider-row-summary">{aiProviderSummaryLabel(profile)}{profile.kind === "direct" ? ` · ${AUTH_MODE_TEXT[profile.authMode]}` : ""}</p>
                  <div className="ai-provider-row-actions">
                    <button type="button" disabled={Boolean(busy)} onClick={() => startEdit(profile)}>编辑</button>
                    <button type="button" title="测试可能产生调用费用" disabled={Boolean(busy)} onClick={() => void runProbe(profile)} data-testid={`ai-provider-test-${profile.id}`}>测试连接</button>
                    {!isActive && <button type="button" disabled={Boolean(busy)} onClick={() => void activateProfile(profile)} data-testid={`ai-provider-activate-${profile.id}`}>使用</button>}
                    <button type="button" className={confirming ? "danger" : ""} disabled={Boolean(busy)} onClick={() => void deleteProfile(profile)} data-testid={`ai-provider-delete-${profile.id}`}>{confirming ? "确认删除" : "删除"}</button>
                  </div>
                  {probeResult && (
                    <p className={`probe-result ${probeResult.status === "ready" ? "ready" : probeResult.status === "not_configured" ? "warning" : "error"}`} data-testid={`ai-provider-probe-${profile.id}`}>
                      {probeStatusLabel(probeResult.status)}{probeResult.latencyMs !== null ? ` · ${probeResult.latencyMs} 毫秒` : ""}{probeResult.status === "ready" && probeResult.model ? ` · ${probeResult.model}` : ""}
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
                    <label>服务商<select data-testid="ai-provider-preset" value={directPresetId} disabled={Boolean(busy)} onChange={(event) => chooseDirectProviderPreset(event.target.value as DirectProviderPresetId)}>
                      {DIRECT_PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </select></label>
                    <label>配置名称<input data-testid="ai-provider-name" autoComplete="off" maxLength={80} value={aiDraft.name} disabled={Boolean(busy)} onChange={(event) => updateDirect("name", event.target.value)} /></label>
                    {directPresetId === "custom" && <div className="ai-provider-technical-fields" data-testid="ai-provider-custom-fields">{directTechnicalFields}</div>}
                    <label>模型<input data-testid="ai-provider-model" autoComplete="off" maxLength={200} value={aiDraft.model} disabled={Boolean(busy)} onChange={(event) => updateDirect("model", event.target.value)} placeholder={selectedDirectPreset.modelPlaceholder} /></label>
                    {aiDraft.authMode !== "none" && <label>API Key<input type="password" data-testid="ai-provider-api-key" autoComplete="off" maxLength={4096} value={apiKey} disabled={Boolean(busy)} onChange={(event) => setApiKey(event.target.value)} placeholder="留空表示保留已保存凭据" /></label>}
                    {directProviderPresetUsesCompactForm(directPresetId) && (
                      <details className="ai-provider-advanced" data-testid="ai-provider-advanced">
                        <summary>高级设置</summary>
                        <div className="ai-provider-technical-fields">{directTechnicalFields}</div>
                      </details>
                    )}
                  </>
                ) : (
                  <>
                    <label>名称<input data-testid="ai-provider-name" autoComplete="off" maxLength={80} value={aiDraft.name} disabled={Boolean(busy)} onChange={(event) => updateCodex("name", event.target.value)} /></label>
                    <label>Codex 配置档案<input data-testid="ai-provider-codex-profile" autoComplete="off" maxLength={100} value={aiDraft.profile} disabled={Boolean(busy)} onChange={(event) => updateCodex("profile", event.target.value)} placeholder="可选，例如 default" /></label>
                    <label>模型<input data-testid="ai-provider-codex-model" autoComplete="off" maxLength={200} value={aiDraft.model} disabled={Boolean(busy)} onChange={(event) => updateCodex("model", event.target.value)} placeholder="可选，留空使用 Codex 默认" /></label>
                    <label>推理强度<select data-testid="ai-provider-codex-reasoning" value={aiDraft.reasoningEffort} disabled={Boolean(busy)} onChange={(event) => updateCodex("reasoningEffort", event.target.value as AiProviderReasoningEffortV2 | "")}>
                      <option value="">默认</option>
                      {REASONING_EFFORTS.map((effort) => <option key={effort} value={effort}>{reasoningEffortLabel(effort)}</option>)}
                    </select></label>
                    <label>Codex 配置目录<input data-testid="ai-provider-codex-home" autoComplete="off" maxLength={1000} value={aiDraft.codexHome} disabled={Boolean(busy)} onChange={(event) => updateCodex("codexHome", event.target.value)} placeholder="可选，例如 ~/.codex" /></label>
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
                    <button type="button" disabled={Boolean(busy)} onClick={() => void runDiscoverCodex()} data-testid="ai-provider-discover">检查本机 Codex</button>
                  </div>
                  {codexDiscovery && (
                    <div className={`codex-discovery ${codexDiscovery.errorCode ? (codexDiscovery.errorCode === "CODEX_NOT_INSTALLED" ? "error" : "warning") : ""}`} data-testid="codex-discovery">
                      <dl>
                        <div><dt>安装状态</dt><dd>{codexDiscovery.installed ? "已安装" : "未安装"}</dd></div>
                        <div><dt>登录状态</dt><dd>{codexDiscovery.authenticated ? "已登录" : "未登录"}</dd></div>
                      </dl>
                      {codexDiscovery.errorCode && <p className="settings-note" data-testid="codex-discovery-error">{codexDiscoveryErrorLabel(codexDiscovery.errorCode)}</p>}
                      {codexDiscovery.models.length > 0 && (
                        <ul className="codex-models" data-testid="codex-models">
                          {codexDiscovery.models.slice(0, 12).map((model) => (
                            <li key={model.id}>
                              <span>{model.displayName ?? model.id}{model.isDefault ? "（默认）" : ""}</span>
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
          </>}
        </section>

        <section className="settings-section feishu-settings" data-testid="feishu-settings">
          <div className="settings-section-heading">
            <h2>飞书连接</h2>
            {settingsView === "ready"
              ? <span className={`connection-state ${connectionStatus}`} data-testid="feishu-connection-status">{connectionLabel(connectionStatus, connectionError)}</span>
              : <span className={`connection-state ${settingsView}`} data-testid="feishu-connection-status">{settingsView === "loading" ? "读取中" : "读取失败"}</span>}
          </div>
          <SettingsResourceNotice state={settingsLoadState} hasData={settings !== null} loadingLabel="正在读取飞书设置…" onRetry={() => void loadSettings()} testId="public-settings-resource-state" />
          {settingsView === "ready" && settings && <>
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
            {!bindingCode && <span className={`binding-state ${settings.feishu.bound ? "bound" : ""}`} data-testid="feishu-binding-status">{settings.feishu.bound ? "已绑定" : "未绑定"}</span>}
          </div>
          </>}
        </section>

        <section className="settings-section delivery-issues" data-testid="feishu-delivery-issues">
          <div className="settings-section-heading"><h2>投递异常</h2><span>{issuesView === "loading" ? "读取中…" : issuesView === "error" ? "读取失败" : settings?.feishu.deliveryIssueCount ?? issueItems.length}</span></div>
          <SettingsResourceNotice state={issuesLoadState} hasData={issues !== null} loadingLabel="正在读取投递异常…" onRetry={() => void loadIssues()} testId="delivery-issues-resource-state" />
          {issuesView === "ready" && <>
          {issueItems.length === 0 && <p className="settings-note">当前没有需要人工处理的投递。</p>}
          {issueItems.map((issue) => {
            const key = issueKey(issue);
            const pending = pendingResolution?.issueKey === key ? pendingResolution : null;
            return <article className="delivery-issue" key={key} data-testid={`delivery-issue-${issue.phase}`}>
              <div className="delivery-issue-heading"><strong>{issue.phase === "ack" ? "保存确认" : "洞察结果"}</strong><span>{issue.status === "ambiguous" ? "发送结果未知" : "最终失败"}</span></div>
              <dl><div><dt>原因</dt><dd>{deliveryIssueErrorLabel(issue.errorCode)}</dd></div><div><dt>时间</dt><dd>{formatTime(issue.updatedAt)}</dd></div></dl>
              {issue.entryId && onOpenEntry && <button className="entry-link" type="button" onClick={() => onOpenEntry(issue.entryId!)}>查看对应记录</button>}
              {pending && <p className={`resolution-warning ${pending.action}`} role="alert">{pending.action === "retry_once" ? "再次发送可能产生重复回复。确认后只重试一次。" : "确认将此投递视为已发送，不会再次自动发送。"}</p>}
              <div className="issue-actions">
                <button type="button" disabled={Boolean(busy)} onClick={() => pending?.action === "assume_sent" ? void resolveIssue(issue) : prepareResolution(issue, "assume_sent")} data-testid="delivery-assume-sent">{pending?.action === "assume_sent" ? "确认已发送" : "标记已发送"}</button>
                <button type="button" disabled={Boolean(busy) || !issue.manualRetryAvailable} onClick={() => pending?.action === "retry_once" ? void resolveIssue(issue) : prepareResolution(issue, "retry_once")} data-testid="delivery-retry-once">{pending?.action === "retry_once" ? "确认重试一次" : "重试一次"}</button>
                {pending && <button type="button" disabled={Boolean(busy)} onClick={() => setPendingResolution(null)}>取消</button>}
              </div>
            </article>;
          })}
          {nextCursor && <button className="load-more" type="button" disabled={issuesLoading} onClick={() => void loadIssues(nextCursor)}>{issuesLoading ? "读取中…" : "加载更多"}</button>}
          </>}
        </section>

        <p className="settings-note">账号凭据会加密保存；记录内容目前不会加密存储。</p>
        <footer role="status" className="settings-message" data-testid="settings-message">{message}</footer>
        <DataManagement />
      </aside>
    </div>
  );
}

function SettingsResourceNotice({
  state,
  hasData,
  loadingLabel,
  onRetry,
  testId,
}: {
  state: SettingsResourceLoadState;
  hasData: boolean;
  loadingLabel: string;
  onRetry(): void;
  testId: string;
}) {
  const view = settingsResourceView(state.status, hasData);
  if (view === "loading") {
    return <div className="settings-resource-state loading" role="status" data-testid={testId}><p>{loadingLabel}</p></div>;
  }
  if (!state.error) return null;
  return (
    <div className="settings-resource-state error" role="alert" data-testid={testId}>
      <p>{state.error}</p>
      <button type="button" onClick={onRetry}>重试</button>
    </div>
  );
}

function issueKey(issue: FeishuDeliveryIssueV1) {
  return `${issue.messageKey}:${issue.phase}`;
}

export function createDirectProviderDraft(
  presetId: DirectProviderPresetId,
  id: string = globalThis.crypto.randomUUID(),
): DirectDraft {
  const preset = directProviderPreset(presetId);
  return {
    kind: "direct",
    id,
    ...preset.defaults,
    model: "",
  };
}

export function applyDirectProviderPreset(
  draft: DirectDraft,
  previousPresetId: DirectProviderPresetId,
  nextPresetId: DirectProviderPresetId,
): DirectDraft {
  if (previousPresetId === nextPresetId) return draft;
  const previousPreset = directProviderPreset(previousPresetId);
  const nextDraft = createDirectProviderDraft(nextPresetId, draft.id);
  const shouldReplaceName = !draft.name.trim() || draft.name.trim() === previousPreset.defaults.name;
  return { ...nextDraft, name: shouldReplaceName ? nextDraft.name : draft.name, model: draft.model };
}

export function inferDirectProviderPreset(
  profile: Extract<AiProviderProfileV2, { kind: "direct" }>,
): DirectProviderPresetId {
  const providerId = profile.providerId.trim().toLowerCase();
  const baseUrl = profile.baseUrl.trim().replace(/\/+$/, "");
  const match = DIRECT_PROVIDER_PRESETS.find((preset) => preset.id !== "custom"
    && preset.defaults.providerId.toLowerCase() === providerId
    && preset.defaults.baseUrl.replace(/\/+$/, "") === baseUrl
    && preset.defaults.protocol === profile.protocol
    && preset.defaults.authMode === profile.authMode
    && preset.defaults.authHeaderName === (profile.authHeaderName ?? "")
    && preset.defaults.structuredOutput === profile.structuredOutput
    && preset.defaults.timeoutMs === String(profile.timeoutMs));
  return match?.id ?? "custom";
}

export function directProviderPresetUsesCompactForm(presetId: DirectProviderPresetId): boolean {
  return presetId !== "custom";
}

function blankDirectDraft(): DirectDraft {
  return createDirectProviderDraft(DEFAULT_DIRECT_PROVIDER_PRESET_ID);
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
  if (errorCode === "CODEX_NOT_INSTALLED") return "未检测到 Codex，请先完成安装。";
  if (errorCode === "CODEX_NOT_AUTHENTICATED") return "Codex 尚未登录，请先完成登录。";
  return "无法检查 Codex，请核对配置目录后重试。";
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
  if (profile.kind === "codex") return profile.model ?? "默认模型";
  return profile.model;
}

export function reasoningEffortLabel(effort: AiProviderReasoningEffortV2): string {
  return ({ none: "关闭", minimal: "最低", low: "较低", medium: "中等", high: "较高", xhigh: "很高", max: "最高", ultra: "极高" } as const)[effort];
}

export function probeStatusLabel(status: AiProviderProbeStatusV2): string {
  return ({ ready: "连接正常", not_configured: "未配置凭据", unavailable: "服务不可用", auth_failed: "认证失败", model_unavailable: "模型不可用", invalid_output: "返回内容异常", timeout: "连接超时" } as const)[status];
}

export function buildDeliveryResolutionRequest(action: PendingResolution["action"], requestId: string, issue: Pick<FeishuDeliveryIssueV1, "messageKey" | "phase">) {
  const base = { version: 1 as const, requestId, messageKey: issue.messageKey, phase: issue.phase };
  return action === "assume_sent"
    ? { ...base, action: "assume_sent" as const, confirmation: "ASSUME_SENT" as const }
    : { ...base, action: "retry_once" as const, confirmation: "RETRY_MAY_DUPLICATE" as const };
}

export function deliveryIssueErrorLabel(errorCode: ErrorCode): string {
  return userErrorMessage({ code: errorCode }, "settings");
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
