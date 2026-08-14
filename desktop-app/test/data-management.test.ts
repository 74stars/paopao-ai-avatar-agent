import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataManagement, EXPORT_SNAPSHOT_NOTICE, exportLocationDetail, operationStatusLabel } from "../src/components/DataManagement.js";

describe("data management product status", () => {
  it("maps internal restore states to user-facing language", () => {
    expect(operationStatusLabel("queued")).toBe("等待处理");
    expect(operationStatusLabel("replacing")).toBe("正在恢复");
    expect(operationStatusLabel("failed_rolled_back")).toBe("恢复失败，原有数据已保留");
  });

  it("labels the export location without exposing the checksum", () => {
    const detail = exportLocationDetail({ status: "ready", path: "exports/record.json", sha256: "CHECKSUM_CANARY" });
    expect(detail).toBe("保存位置：exports/record.json");
    expect(detail).not.toContain("CHECKSUM_CANARY");
  });

  it("explains that copied exports are independent snapshots", () => {
    const markup = renderToStaticMarkup(createElement(DataManagement));
    expect(markup).toContain(EXPORT_SNAPSHOT_NOTICE);
    expect(EXPORT_SNAPSHOT_NOTICE).toContain("不会改写");
  });
});
