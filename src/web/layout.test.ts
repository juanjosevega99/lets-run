import { describe, expect, it } from "vitest";
import { layout } from "./layout.js";

describe("dashboard layout", () => {
  it("emits valid inline JavaScript", () => {
    const html = layout("test", "/", "<p>body</p>");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it("marks the active navigation tab for assistive technology", () => {
    const html = layout("test", "/week", "<p>body</p>");
    expect(html).toContain('<a href="/week" class="active" aria-current="page">Plan</a>');
  });
});
