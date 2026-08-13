import { describe, expect, it } from "vitest";
import { operationStatusLabel } from "../src/components/DataManagement.js";

describe("data management product status", () => {
  it("maps internal restore states to user-facing language", () => {
    expect(operationStatusLabel("queued")).toBe("等待处理");
    expect(operationStatusLabel("replacing")).toBe("正在恢复");
    expect(operationStatusLabel("failed_rolled_back")).toBe("恢复失败，原有数据已保留");
  });
});
