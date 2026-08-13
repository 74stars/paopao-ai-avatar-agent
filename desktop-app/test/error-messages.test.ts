import { describe, expect, it } from "vitest";
import { ErrorCodeSchema } from "@paopao/contracts";
import { userErrorMessage } from "../src/error-messages.js";

describe("renderer error messages", () => {
  it("maps every contract error code to product language", () => {
    for (const code of ErrorCodeSchema.options) {
      const message = userErrorMessage({ code });
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(code);
    }
  });

  it("never renders the transport message or internal database details", () => {
    const internalError = {
      code: "DATABASE_UNAVAILABLE" as const,
      message: "database closed at /private/user-data/paopao.sqlite",
      retryable: true,
    };

    const message = userErrorMessage(internalError, "capture");

    expect(message).toBe("暂时无法保存，输入内容仍保留，请稍后重试。");
    expect(message).not.toContain(internalError.message);
    expect(message).not.toContain("数据库");
  });
});
