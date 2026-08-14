import { validateInsightReplyUserVisibleContent } from "@paopao/contracts";
import type { ClaimedExternalDelivery } from "@paopao/core";

const CONTROL_TEXT = {
  bound: "绑定成功。现在可以发送文字进行记录。",
  unbound: "已解除绑定。",
  binding_required: "尚未绑定。请先在桌面设置中生成绑定码，再发送 /bind 绑定码。",
  unsupported_message: "当前只支持文字消息。",
  p2p_only: "当前只支持与机器人的单聊。",
  help: "可用命令：/bind 绑定码、/unbind、/help。",
  binding_error: "绑定未完成。请检查绑定码是否正确且未过期，或稍后重试。",
} as const;

export function renderDeliveryText(delivery: ClaimedExternalDelivery): string {
  const payload = delivery.payload;
  if (payload.kind === "capture_ack") return "已保存。";
  if (payload.kind === "control") return CONTROL_TEXT[payload.replyCode];
  if (!validateInsightReplyUserVisibleContent(payload.reply)) return "洞察暂不可用，请在泡泡中重新生成。";

  const lines = [payload.reply.text];
  if (payload.reply.nextAction) lines.push(`下一步：${payload.reply.nextAction.title}`);
  if (payload.reply.citations.length > 0) {
    lines.push("来源：");
    for (const citation of payload.reply.citations) lines.push(`- ${citation.evidenceQuote}`);
  } else {
    lines.push("来源：未找到相关历史记录");
  }
  return lines.join("\n");
}
