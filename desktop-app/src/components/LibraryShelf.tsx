import type { MemoryType } from "@paopao/contracts";

export const shelfMeta: Record<MemoryType, { label: string }> = {
  diary: { label: "日记" },
  thought: { label: "思想" },
  person: { label: "人物" },
  reading: { label: "阅读" },
  goal: { label: "目标" },
  other: { label: "其他" }
};
export const shelfOrder = Object.keys(shelfMeta) as MemoryType[];
