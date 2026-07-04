/**
 * task-09: parseDetails 单测。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-04-fix-frontend-type-divergence/tasks/task-09.md
 *
 * 覆盖:
 *   1. 合法 JSON 字符串 → 对应对象
 *   2. null → null
 *   3. 空字符串 → null
 *   4. 非法 JSON 字符串 → null(不抛异常)
 *   5. 含 error 关键字的合法 JSON → 解析成功(配合 page.tsx 搜索语义)
 */
import { describe, expect, it } from "vitest";

import { parseDetails } from "./page";

describe("parseDetails", () => {
  it("合法 JSON 字符串解析为对象", () => {
    const parsed = parseDetails('{"foo":"bar","n":1}');
    expect(parsed).toEqual({ foo: "bar", n: 1 });
  });

  it("null 入参返回 null", () => {
    expect(parseDetails(null)).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(parseDetails("")).toBeNull();
  });

  it("非法 JSON 字符串兜底为 null(不抛异常)", () => {
    expect(parseDetails("not a json")).toBeNull();
    expect(parseDetails("{broken")).toBeNull();
  });

  it("含 error value 的 JSON 字符串可正常解析", () => {
    const parsed = parseDetails('{"error":"boom"}');
    expect(parsed).toEqual({ error: "boom" });
  });
});
