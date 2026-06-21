import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, "data");
const rawLogPath = join(dataDir, "raw-events.jsonl");
const selfModelPath = join(dataDir, "self-model.json");

export async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
}

export async function appendRawEvent(event) {
  await ensureStore();
  const line = JSON.stringify({ ...event, stored_at: new Date().toISOString() });
  await appendFile(rawLogPath, `${line}\n`, "utf8");
}

export async function readSelfModel() {
  await ensureStore();
  try {
    return JSON.parse(await readFile(selfModelPath, "utf8"));
  } catch {
    return {
      identity_direction: "七年跃迁中的高能量创造者、领导者、财富与认知增长者",
      values: ["力量", "自由", "影响力", "深刻理解世界", "现实结果"],
      ambitions: ["赚很多钱", "做领袖", "拥有作品", "进入更大的世界"],
      growth_axes: ["认知", "财富", "领导力", "身体", "审美", "表达", "社交", "旅行"],
      preferred_tone: "正向、清醒、鼓励、带推动力",
      anti_patterns: ["被人格标签框定", "只谈情绪", "过度抒情", "空泛鸡汤"],
      ideals: [],
      goals: [],
      books: [],
    };
  }
}

export async function writeSelfModel(model) {
  await ensureStore();
  await writeFile(selfModelPath, JSON.stringify(model, null, 2), "utf8");
}

export async function updateSelfModel(mutator) {
  const model = await readSelfModel();
  const next = await mutator(model);
  await writeSelfModel(next);
  return next;
}

