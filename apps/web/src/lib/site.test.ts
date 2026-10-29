import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS, siteUrl } from "./site";

describe("siteUrl", () => {
  it("returns undefined when the variable is missing or blank", () => {
    expect(siteUrl(undefined)).toBeUndefined();
    expect(siteUrl("")).toBeUndefined();
    expect(siteUrl("   ")).toBeUndefined();
  });

  it("rejects values that are not http or https URLs", () => {
    expect(siteUrl("not a url")).toBeUndefined();
    expect(siteUrl("ftp://example.org")).toBeUndefined();
    expect(siteUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("accepts http and https URLs", () => {
    expect(siteUrl("https://example.org")?.origin).toBe("https://example.org");
    expect(siteUrl(" http://localhost:3000 ")?.origin).toBe("http://localhost:3000");
  });
});

describe("PUBLIC_PATHS", () => {
  it("lists only root-relative paths without duplicates", () => {
    expect(PUBLIC_PATHS.every((path) => path.startsWith("/"))).toBe(true);
    expect(new Set(PUBLIC_PATHS).size).toBe(PUBLIC_PATHS.length);
  });
});
