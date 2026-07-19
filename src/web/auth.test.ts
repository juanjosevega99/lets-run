import { describe, expect, it } from "vitest";
import { isAuthorized } from "./auth.js";

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

describe("isAuthorized", () => {
  it("accepts the correct password with any username", () => {
    expect(isAuthorized(basic("juan", "s3cret"), "s3cret")).toBe(true);
    expect(isAuthorized(basic("", "s3cret"), "s3cret")).toBe(true);
  });

  it("rejects a wrong password, missing header, and non-Basic schemes", () => {
    expect(isAuthorized(basic("juan", "nope"), "s3cret")).toBe(false);
    expect(isAuthorized(undefined, "s3cret")).toBe(false);
    expect(isAuthorized("Bearer abc", "s3cret")).toBe(false);
    expect(isAuthorized("Basic not-base64!!", "s3cret")).toBe(false);
  });

  it("handles passwords containing colons (split on first colon only)", () => {
    expect(isAuthorized(basic("juan", "a:b:c"), "a:b:c")).toBe(true);
  });
});
