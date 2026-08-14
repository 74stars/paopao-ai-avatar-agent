import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BubbleLife } from "../src/components/BubbleLife";

describe("desktop bubble visual", () => {
  it("renders a state-aware vector without the legacy raster asset", () => {
    const markup = renderToStaticMarkup(BubbleLife({ state: "thinking", compact: true }));

    expect(markup).toContain("data-pet-state=\"thinking\"");
    expect(markup).toContain("class=\"bubble-character\"");
    expect(markup).toContain("class=\"bubble-shell\"");
    expect(markup).toContain("class=\"bubble-signal\"");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("paopao.webp");
  });
});
