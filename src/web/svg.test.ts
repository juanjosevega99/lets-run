import { describe, expect, it } from "vitest";
import { barChart } from "./svg.js";

describe("barChart", () => {
  it("renders one rect per bar", () => {
    const svg = barChart({
      bars: [
        { label: "w1", value: 10 },
        { label: "w2", value: 20 },
        { label: "w3", value: 0 },
      ],
      valueUnit: "km",
    });
    expect(svg.match(/<rect/g)).toHaveLength(3);
  });

  it("scales to the reference line when it exceeds every bar", () => {
    const svg = barChart({
      bars: [{ label: "w1", value: 10 }],
      refLine: { value: 40, label: "peak 40" },
      valueUnit: "km",
    });
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("peak 40");
    expect(svg).toContain(">40<"); // y-axis max reflects the ref line, not the max bar
  });

  it("renders an explicit empty state for zero bars", () => {
    const svg = barChart({ bars: [], valueUnit: "km" });
    expect(svg).toContain("no data");
    expect(svg).not.toContain("<rect");
  });

  it("escapes labels", () => {
    const svg = barChart({ bars: [{ label: "<x>", value: 1 }], valueUnit: "km" });
    expect(svg).toContain("&lt;x&gt;");
  });
});
