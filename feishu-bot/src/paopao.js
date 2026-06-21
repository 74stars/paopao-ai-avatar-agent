import { readSelfModel, updateSelfModel } from "./store.js";

export async function processUserInput(input) {
  const text = input.text.trim();
  if (!text) {
    return "我收到了。等你把材料发完整，我会把它写进你的长期记忆。";
  }

  if (text.startsWith("/profile")) {
    const model = await readSelfModel();
    return formatProfile(model);
  }

  if (text.startsWith("/goal")) {
    const goal = text.replace(/^\/goal\s*/u, "").trim();
    const model = await updateSelfModel((current) => ({
      ...current,
      goals: [...(current.goals || []), { goal, created_at: new Date().toISOString() }],
    }));
    return `已写入目标系统。\n\n${goal}\n\n我会把它纳入你的七年跃迁路线，而不是让它停在一句愿望里。当前目标数：${model.goals.length}`;
  }

  if (text.startsWith("/ideal")) {
    const ideal = text.replace(/^\/ideal\s*/u, "").trim();
    const model = await updateSelfModel((current) => ({
      ...current,
      ideals: [...(current.ideals || []), { ideal, created_at: new Date().toISOString() }],
    }));
    return `已加入理想自我素材库。\n\n${ideal}\n\n我会抽取其中值得吸收的能力结构，而不是让你机械模仿任何人。当前素材数：${model.ideals.length}`;
  }

  if (text.startsWith("/book")) {
    const book = text.replace(/^\/book\s*/u, "").trim();
    const model = await updateSelfModel((current) => ({
      ...current,
      books: [...(current.books || []), { book, created_at: new Date().toISOString() }],
    }));
    return `已写入阅读与认知系统。\n\n${book}\n\n我会提醒你把阅读转成判断力、表达力和现实行动。当前阅读线索数：${model.books.length}`;
  }

  return composePositiveReply(text);
}

function composePositiveReply(text) {
  const lower = text.toLowerCase();
  if (text.includes("钱") || text.includes("赚钱") || lower.includes("money")) {
    return "我收到了：这是财富线索，不只是情绪记录。\n\n下一步，把它拆成三个问题：你要通过什么能力赚钱？服务谁？如何在 30 天内验证一个最小现金流？";
  }
  if (text.includes("想要") || text.includes("欲望") || text.includes("野心")) {
    return "我收到了：这是欲望材料。泡泡不会压低它，会把它转成路径。\n\n请继续补一句：这个欲望如果被显化，最先出现的现实证据是什么？";
  }
  if (text.includes("书") || text.includes("阅读") || text.includes("认知")) {
    return "我收到了：这是认知增长线索。\n\n读书不只是获得观点，而是升级你看世界、看人性、看利益结构的模型。把这条材料继续发给我，我会沉淀成你的认知资产。";
  }
  return "我收到了，并已放入长期记忆入口。\n\n我会把这条材料视为你数字分身的一部分：它可能关联你的目标、欲望、判断、人物、地点或未来行动。现在给你一个推进问题：这件事下一步能变成什么现实动作？";
}

function formatProfile(model) {
  return [
    "泡泡当前对你的理解：",
    "",
    `方向：${model.identity_direction}`,
    `价值：${(model.values || []).join(" / ")}`,
    `野心：${(model.ambitions || []).join(" / ")}`,
    `成长轴：${(model.growth_axes || []).join(" / ")}`,
    `语气：${model.preferred_tone}`,
    "",
    `目标数：${(model.goals || []).length}`,
    `理想自我素材：${(model.ideals || []).length}`,
    `阅读线索：${(model.books || []).length}`,
  ].join("\n");
}

export function morningMessage() {
  return "早上好。今天不是普通的一天，是你七年跃迁系统里的一个节点。\n\n先做一件能产生复利的事：读一点硬书、推进一个目标、联系一个关键人，或把一个欲望写成计划。";
}

export function nightlyMessage() {
  return "今天收束。请发我三件事：\n\n1. 今天推进了什么现实结果？\n2. 今天看清了什么人性或世界规则？\n3. 明天最值得优先推进的一步是什么？";
}

