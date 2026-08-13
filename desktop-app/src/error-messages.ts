import type { ErrorCode } from "@paopao/contracts";

export type ErrorContext = "capture" | "library" | "settings" | "data" | "entry" | "general";

const messages: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "输入内容有误，请检查后再试。",
  NOT_FOUND: "没有找到这项内容，它可能已被移除。",
  REVISION_CONFLICT: "内容已在其他位置更新，请刷新后再试。",
  ALREADY_DELETED: "这项内容已经删除。",
  DATABASE_UNAVAILABLE: "操作暂时无法完成，请稍后重试。",
  NETWORK_OFFLINE: "当前网络不可用，请检查连接后重试。",
  SAFE_STORAGE_UNAVAILABLE: "系统暂时无法安全保存凭据，请稍后重试。",
  JOB_NOT_RETRYABLE: "这项整理任务当前无法重试。",
  AI_NOT_CONFIGURED: "请先在设置中完成 AI 配置。",
  AI_AUTH_FAILED: "AI 凭据验证失败，请检查后重新保存。",
  AI_NETWORK_ERROR: "暂时无法连接 AI 服务，请稍后重试。",
  AI_TIMEOUT: "AI 服务响应超时，请稍后重试。",
  AI_RATE_LIMITED: "AI 服务请求过于频繁，请稍后重试。",
  AI_SAFETY_BLOCKED: "这项内容无法由 AI 继续处理。",
  AI_INPUT_TOO_LARGE: "内容过长，暂时无法由 AI 处理。",
  AI_INVALID_OUTPUT: "AI 返回的结果无法使用，请重新整理。",
  AI_FAILED_FINAL: "这次整理未能完成，可以稍后重新运行。",
  FEISHU_NOT_CONFIGURED: "请先在设置中完成飞书配置。",
  FEISHU_AUTH_FAILED: "飞书凭据验证失败，请检查后重新保存。",
  FEISHU_NOT_CONNECTED: "飞书当前未连接，请连接后重试。",
  FEISHU_NOT_BOUND: "飞书账号尚未绑定。",
  FEISHU_PERMISSION_DENIED: "飞书权限不足，请检查应用权限。",
  BINDING_CODE_INVALID: "绑定码无效，请重新生成。",
  BINDING_CODE_EXPIRED: "绑定码已过期，请重新生成。",
  BINDING_CODE_CONSUMED: "绑定码已经使用，请重新生成。",
  BINDING_RATE_LIMITED: "绑定尝试过于频繁，请稍后再试。",
  DELIVERY_AMBIGUOUS: "发送结果暂时无法确认，请在发送记录中处理。",
  DELIVERY_FAILED_FINAL: "消息发送失败，请在发送记录中处理。",
  BACKUP_INVALID: "这个备份无法使用，请选择其他备份。",
  RESTORE_FAILED: "备份恢复失败，原有数据未显示为恢复成功。",
  EXPORT_FAILED: "数据导出失败，请稍后重试。",
  DIAGNOSTICS_EXPORT_FAILED: "诊断导出失败，请稍后重试。",
  INTERNAL_ERROR: "操作未能完成，请稍后重试。",
};

const unavailableByContext: Record<ErrorContext, string> = {
  capture: "暂时无法保存，输入内容仍保留，请稍后重试。",
  library: "书房暂时无法读取，请稍后重试。",
  settings: "设置暂时无法读取，请稍后重试。",
  data: "数据操作暂时无法完成，请稍后重试。",
  entry: "这项操作暂时无法完成，请稍后重试。",
  general: messages.DATABASE_UNAVAILABLE,
};

export function userErrorMessage(error: { code: ErrorCode }, context: ErrorContext = "general"): string {
  return error.code === "DATABASE_UNAVAILABLE" ? unavailableByContext[context] : messages[error.code];
}
