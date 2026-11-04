import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findForbiddenMoneyPhrases } from "@/domain/copy";

function files(target: string): string[] {
  if (!statSync(target).isDirectory()) return target.endsWith(".ts") || target.endsWith(".tsx") ? [target] : [];
  return readdirSync(target).flatMap((name) => files(path.join(target, name)));
}

describe("money language", () => {
  it("keeps shop-facing copy on the calculation side", () => {
    const roots = ["src/app", "src/components", "src/domain/emails.ts", "src/content"].filter((dir) => {
      try {
        statSync(dir);
        return true;
      } catch {
        return false;
      }
    });
    const hits = roots.flatMap(files).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return findForbiddenMoneyPhrases(text).map((phrase) => `${file}: ${phrase}`);
    });
    expect(hits).toEqual([]);
  });
});
