// task-07 / FR-09 / D-001@v1 / D-002@v1：tool-kind-meta 单测。
// 校验：14 枚举全部有徽标 + null/undefined/未知 → 灰色兜底 + 字段完整性。
// 枚举与 backend TOOL_KIND_VALUES 严格对齐（修改须两端同步）。
import { describe, it, expect } from "vitest";
import { TOOL_KIND_META, toolKindMeta } from "../tool-kind-meta";

const EXPECTED_KINDS = [
  "sillyspec", "skill", "bash", "read", "write",
  "search", "task", "web", "todo", "plan",
  "ask", "schedule", "mcp", "other",
] as const;

describe("TOOL_KIND_META", () => {
  it("覆盖全部 14 枚举（与 backend TOOL_KIND_VALUES 对齐）", () => {
    for (const kind of EXPECTED_KINDS) {
      expect(TOOL_KIND_META[kind], `missing kind: ${kind}`).toBeDefined();
    }
    expect(Object.keys(TOOL_KIND_META).sort()).toEqual([...EXPECTED_KINDS].sort());
  });

  it("每条元数据 中文 label ≤3 字 / 有 Icon / badgeClass 三段式", () => {
    // SillySpec / MCP 是英文品牌名（design 明示允许，非中文 label 不受 ≤3 字约束）
    const asciiLabelWhitelist = new Set(["sillyspec", "mcp"]);
    for (const kind of EXPECTED_KINDS) {
      const meta = TOOL_KIND_META[kind];
      expect(meta, `${kind} 必须有元数据`).toBeDefined();
      if (!meta) continue;
      if (!asciiLabelWhitelist.has(kind)) {
        expect(meta.label.length, `${kind} 中文 label ≤3`).toBeLessThanOrEqual(3);
      }
      expect(meta.Icon, `${kind} Icon`).toBeDefined();
      expect(meta.badgeClass, `${kind} badgeClass`).toMatch(/border-\w+-200/);
      expect(meta.badgeClass, `${kind} badgeClass`).toMatch(/bg-\w+-50/);
      expect(meta.badgeClass, `${kind} badgeClass`).toMatch(/text-\w+-700/);
    }
  });
});

describe("toolKindMeta", () => {
  it("null/undefined → 灰色兜底「工具」", () => {
    for (const input of [null, undefined]) {
      const meta = toolKindMeta(input);
      expect(meta.label).toBe("工具");
      expect(meta.badgeClass).toContain("text-zinc-500");
      expect(meta.badgeClass).toContain("bg-zinc-50");
    }
  });

  it("未知 kind → 灰色兜底「工具」", () => {
    const meta = toolKindMeta("totally-unknown-kind");
    expect(meta.label).toBe("工具");
    expect(meta.badgeClass).toContain("text-zinc-500");
  });

  it("已知 kind → 对应徽标（非灰色兜底）", () => {
    for (const kind of EXPECTED_KINDS) {
      const meta = toolKindMeta(kind);
      const expected = TOOL_KIND_META[kind];
      expect(expected, `${kind} 必须有元数据`).toBeDefined();
      expect(meta.label, `${kind}`).toBe(expected?.label);
      // 已知 kind 不应是兜底（text-zinc-500 是兜底专属）
      expect(meta.badgeClass, `${kind} 不应兜底`).not.toContain("text-zinc-500");
    }
  });

  it("空字符串 → 灰色兜底", () => {
    expect(toolKindMeta("").label).toBe("工具");
  });

  it("大小写敏感（未知大写 kind 走兜底，不误匹配）", () => {
    // tool_kind 来自 backend 严格小写枚举，前端不做归一化，大写视为未知
    expect(toolKindMeta("BASH").label).toBe("工具");
  });
});
