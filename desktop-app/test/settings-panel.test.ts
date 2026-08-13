import { describe, expect, it } from "vitest";
import {
  aiProviderSummaryLabel,
  buildDeliveryResolutionRequest,
  buildSaveAiProviderRequest,
  connectionLabel,
  probeStatusLabel,
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
    expect(aiProviderSummaryLabel(direct)).toBe("office / model-a");
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
    expect(aiProviderSummaryLabel(codex)).toBe("Codex · gpt-5");
    expect(aiProviderSummaryLabel({ ...codex, model: null })).toBe("Codex · 默认模型");
  });

  it("maps probe statuses to stable redacted labels", () => {
    expect(probeStatusLabel("ready")).toBe("连接正常");
    expect(probeStatusLabel("not_configured")).toBe("未配置凭据");
    expect(probeStatusLabel("unavailable")).toBe("服务不可用");
    expect(probeStatusLabel("auth_failed")).toBe("认证失败");
    expect(probeStatusLabel("model_unavailable")).toBe("模型不可用");
    expect(probeStatusLabel("invalid_output")).toBe("返回格式异常");
    expect(probeStatusLabel("timeout")).toBe("连接超时");
  });
});
