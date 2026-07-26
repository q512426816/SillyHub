import { describe, expect, it } from "vitest";

import { normalizeClientPath } from "@/lib/client-path";

describe("normalizeClientPath", () => {
  it("Windows 盘符路径统一为反斜杠", () => {
    expect(normalizeClientPath("C:/Users/qinyi/IdeaProjects/happy")).toBe(
      "C:\\Users\\qinyi\\IdeaProjects\\happy",
    );
    expect(normalizeClientPath("C:\\Users\\qinyi\\IdeaProjects\\happy")).toBe(
      "C:\\Users\\qinyi\\IdeaProjects\\happy",
    );
  });

  it("POSIX 路径统一为正斜杠", () => {
    expect(normalizeClientPath("/home/user\\proj")).toBe("/home/user/proj");
  });
});
