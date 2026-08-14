import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  aiProviderSummaryLabel,
  applyDirectProviderPreset,
  buildDeliveryResolutionRequest,
  buildSaveAiProviderRequest,
  connectionLabel,
  createDirectProviderDraft,
  deliveryIssueErrorLabel,
  directProviderPresetUsesCompactForm,
  inferDirectProviderPreset,
  probeStatusLabel,
  reasoningEffortLabel,
  settingsResourceView,
  SettingsPanel,
} from "../src/components/SettingsPanel.js";

const requestId = "10000000-0000-4000-8000-000000000001";
const issue = { messageKey: "feishu:canonical:test-message", phase: "ack" as const };

describe("Wave 3 settings policy", () => {
  it("maps manual issue actions to their exact confirmations", () => {
    expect(buildDeliveryResolutionRequest("assume_sent", requestId, issue)).toEqual({
      version: 1,
      requestId,
      ...issue,
      action: "assume_sent",
      confirmation: "ASSUME_SENT",
    });
    expect(buildDeliveryResolutionRequest("retry_once", requestId, issue)).toEqual({
      version: 1,
      requestId,
      ...issue,
      action: "retry_once",
      confirmation: "RETRY_MAY_DUPLICATE",
    });
  });

  it("renders stable redacted connection diagnostics", () => {
    expect(connectionLabel("error", "FEISHU_AUTH_FAILED")).toBe("凭据错误");
    expect(connectionLabel("error", "FEISHU_PERMISSION_DENIED")).toBe("权限不足");
    expect(connectionLabel("error", "NETWORK_OFFLINE")).toBe("网络离线");
    expect(connectionLabel("reconnecting")).toBe("重连中");
    expect(connectionLabel("connected")).toBe("已连接");
  });
});

describe("AI Provider V2 settings policy", () => {
  const directId = "10000000-0000-4000-8000-000000000010";

  it("builds a direct save request with trimmed fields and a write-only credential", () => {
    const request = buildSaveAiProviderRequest({
      kind: "direct",
      id: directId,
      name: "  Office proxy  ",
      providerId: "  office ",
      protocol: "openai_responses",
      baseUrl: "https://proxy.example.com/v1/",
      model: " model-a ",
      authMode: "bearer",
      authHeaderName: "x-api-key",
      structuredOutput: "json_schema",
      timeoutMs: 30_000,
      credential: "  sk-secret  ",
    });
    expect(request).toEqual({
      version: 2,
      credential: "sk-secret",
      profile: {
        id: directId,
        kind: "direct",
        name: "Office proxy",
        providerId: "office",
        protocol: "openai_responses",
        baseUrl: "https://proxy.example.com/v1",
        model: "model-a",
        authMode: "bearer",
        authHeaderName: null,
        structuredOutput: "json_schema",
        timeoutMs: 30_000,
      },
    });
  });

  it("omits the credential and header name when auth does not need them", () => {
    const request = buildSaveAiProviderRequest({
      kind: "direct",
      id: directId,
      name: "Local",
      providerId: "local",
      protocol: "openai_chat_completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model",
      authMode: "none",
      authHeaderName: "",
      structuredOutput: "prompt_json",
      timeoutMs: 20_000,
      credential: "should-not-be-sent",
    });
    expect(request).toEqual({
      version: 2,
      profile: {
        id: directId,
        kind: "direct",
        name: "Local",
        providerId: "local",
        protocol: "openai_chat_completions",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "local-model",
        authMode: "none",
        authHeaderName: null,
        structuredOutput: "prompt_json",
        timeoutMs: 20_000,
      },
    });
    expect("credential" in request).toBe(false);
  });

  it("maps known suppliers to complete direct-provider defaults", () => {
    expect(createDirectProviderDraft("deepseek", directId)).toMatchObject({
      id: directId,
      name: "DeepSeek",
      providerId: "deepseek",
      protocol: "openai_chat_completions",
      baseUrl: "https://api.deepseek.com/v1",
      authMode: "bearer",
      structuredOutput: "prompt_json",
      model: "",
    });
    expect(createDirectProviderDraft("local", directId)).toMatchObject({
      providerId: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      authMode: "none",
    });
  });

  it("switches preset defaults without discarding the user model", () => {
    const openAi = { ...createDirectProviderDraft("openai", directId), model: "gpt-5" };
    expect(applyDirectProviderPreset(openAi, "openai", "deepseek")).toMatchObject({
      id: directId,
      name: "DeepSeek",
      providerId: "deepseek",
      model: "gpt-5",
    });

    const named = { ...openAi, name: "工作账号" };
    expect(applyDirectProviderPreset(named, "openai", "openrouter").name).toBe("工作账号");
  });

  it("uses compact fields for presets and preserves unmatched profiles as custom", () => {
    expect(directProviderPresetUsesCompactForm("openai")).toBe(true);
    expect(directProviderPresetUsesCompactForm("local")).toBe(true);
    expect(directProviderPresetUsesCompactForm("custom")).toBe(false);

    const existing = {
      id: directId,
      kind: "direct" as const,
      name: "Office proxy",
      providerId: "office",
      protocol: "openai_responses" as const,
      baseUrl: "https://proxy.example.com/v1",
      model: "model-a",
      authMode: "api_key_header" as const,
      authHeaderName: "x-api-key",
      structuredOutput: "json_schema" as const,
      timeoutMs: 30_000,
      credentialConfigured: true,
      revision: 1,
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    expect(inferDirectProviderPreset(existing)).toBe("custom");
    const openAi = {
      ...existing,
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1/",
      protocol: "openai_responses" as const,
      authMode: "bearer" as const,
      authHeaderName: null,
      structuredOutput: "json_schema" as const,
      timeoutMs: 60_000,
    };
    expect(inferDirectProviderPreset(openAi)).toBe("openai");
    expect(inferDirectProviderPreset({ ...openAi, protocol: "openai_chat_completions" })).toBe("custom");
  });

  it("builds a codex save request with optional fields mapped to null", () => {
    const request = buildSaveAiProviderRequest({
      kind: "codex",
      id: "10000000-0000-4000-8000-000000000011",
      name: "  Codex current ",
      profile: "",
      model: "",
      reasoningEffort: "",
      codexHome: "",
    });
    expect(request).toEqual({
      version: 2,
      profile: {
        id: "10000000-0000-4000-8000-000000000011",
        kind: "codex",
        name: "Codex current",
        profile: null,
        model: null,
        reasoningEffort: null,
        codexHome: null,
      },
    });
  });

  it("renders compact provider summary labels", () => {
    const direct = {
      id: directId,
      kind: "direct" as const,
      name: "Office",
      providerId: "office",
      protocol: "openai_responses" as const,
      baseUrl: "https://proxy.example.com/v1",
      model: "model-a",
      authMode: "bearer" as const,
      authHeaderName: null,
      structuredOutput: "json_schema" as const,
      timeoutMs: 30_000,
      credentialConfigured: true,
      revision: 1,
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    expect(aiProviderSummaryLabel(direct)).toBe("model-a");
    const codex = {
      id: "10000000-0000-4000-8000-000000000011",
      kind: "codex" as const,
      name: "Codex",
      profile: null,
      model: "gpt-5",
      reasoningEffort: "high",
      codexHome: null,
      credentialConfigured: true,
      revision: 1,
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    expect(aiProviderSummaryLabel(codex)).toBe("gpt-5");
    expect(aiProviderSummaryLabel({ ...codex, model: null })).toBe("默认模型");
  });

  it("uses localized labels for user-visible service details", () => {
    expect(reasoningEffortLabel("minimal")).toBe("最低");
    expect(reasoningEffortLabel("high")).toBe("较高");
    expect(deliveryIssueErrorLabel("DELIVERY_AMBIGUOUS")).toBe("发送结果暂时无法确认，请选择处理方式。");
  });

  it("keeps loading, first-load errors, stale data, and empty data distinct", () => {
    expect(settingsResourceView("loading", false)).toBe("loading");
    expect(settingsResourceView("error", false)).toBe("error");
    expect(settingsResourceView("ready", true)).toBe("ready");
    expect(settingsResourceView("ready", false)).toBe("ready");
    expect(settingsResourceView("error", true)).toBe("ready");
  });

  it("renders a modal settings shell without showing business empty states while loading", () => {
    const markup = renderToStaticMarkup(createElement(SettingsPanel, { onClose() {} }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("正在读取 AI 服务配置");
    expect(markup).toContain("正在读取飞书设置");
    expect(markup).toContain("正在读取投递异常");
    expect(markup).not.toContain("尚未选择 AI 服务");
    expect(markup).not.toContain("未配置飞书应用");
    expect(markup).not.toContain("当前没有需要人工处理的投递");
  });

  it("keeps internal implementation names out of the default settings view", () => {
    const markup = renderToStaticMarkup(createElement(SettingsPanel, { onClose() {} }));
    expect(markup).toContain("AI 服务");
    expect(markup).toContain("飞书连接");
    expect(markup).not.toContain("AI Provider");
    expect(markup).not.toContain("Direct 字段");
    expect(markup).not.toContain("Reasoning Effort");
    expect(markup).not.toContain("实验性增量");
    expect(markup).not.toContain("safeStorage");
    expect(markup).not.toContain("SQLite");
  });

  it("maps probe statuses to stable redacted labels", () => {
    expect(probeStatusLabel("ready")).toBe("连接正常");
    expect(probeStatusLabel("not_configured")).toBe("未配置凭据");
    expect(probeStatusLabel("unavailable")).toBe("服务不可用");
    expect(probeStatusLabel("auth_failed")).toBe("认证失败");
    expect(probeStatusLabel("model_unavailable")).toBe("模型不可用");
    expect(probeStatusLabel("invalid_output")).toBe("返回内容异常");
    expect(probeStatusLabel("timeout")).toBe("连接超时");
  });
});
