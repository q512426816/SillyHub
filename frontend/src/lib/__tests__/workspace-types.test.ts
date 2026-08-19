/**
 * task-05 / 2026-08-18-workspace-role-type：工作区类型词表与徽标 helper 测试。
 *
 * 覆盖（design §5.4 / 验收 AC-05 前端面）：
 *   - 词表 8 项：value 与后端 constants.py WORKSPACE_TYPE_VALUES 逐字一致、
 *     每项有非空中文 label 与 badgeClass、无重复 value
 *   - 联合派生：WORKSPACE_TYPE_OPTIONS 的 value 值域能赋给 WorkspaceType
 *     （gen:types 漂移防护——后端加/删值不改 api-types 时此处类型即红）
 *   - workspaceTypeBadge：NULL/undefined/空串 → 「未分类」灰；已知 8 值 →
 *     词表项；未知非空值（含废弃旧值 daemon-client）→ 原值灰徽标；全程不抛错
 *
 * 注：components/workspace/__tests__/workspace-types.test.ts（task-08 的组件级
 * 测试位）与本文件是两处——本文件只测 lib 纯函数。
 *
 * author: qinyi  created_at: 2026-08-19  change: 2026-08-18-workspace-role-type（task-05）
 */
import { describe, expect, it } from "vitest";

import type { WorkspaceType } from "@/lib/workspace-types";
import {
  UNCLASSIFIED_OPTION,
  WORKSPACE_TYPE_OPTIONS,
  workspaceTypeBadge,
} from "@/lib/workspace-types";

describe("WORKSPACE_TYPE_OPTIONS 词表（8 值受控词表）", () => {
  it("恰好 8 项，value 与后端词表逐字一致且有序", () => {
    expect(WORKSPACE_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "frontend-code",
      "backend-code",
      "fullstack",
      "business-doc",
      "submodule",
      "deploy-ops",
      "design-asset",
      "other",
    ]);
  });

  it("每项有非空中文 label 与非空 badgeClass，且 value 无重复", () => {
    const seen = new Set<string>();
    for (const option of WORKSPACE_TYPE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.badgeClass.length).toBeGreaterThan(0);
      expect(seen.has(option.value)).toBe(false);
      seen.add(option.value);
    }
    expect(seen.size).toBe(8);
  });

  it("8 项 value 均可赋给 WorkspaceType（api-types 联合派生防漂移）", () => {
    // 编译期断言：若 api-types 的联合与词表 value 漂移，此赋值在 tsc 即红。
    const values: WorkspaceType[] = WORKSPACE_TYPE_OPTIONS.map((o) => o.value);
    expect(values).toHaveLength(8);
  });
});

describe("UNCLASSIFIED_OPTION 未分类展示项", () => {
  it("value 为 null，label 为「未分类」，badgeClass 非空", () => {
    expect(UNCLASSIFIED_OPTION.value).toBeNull();
    expect(UNCLASSIFIED_OPTION.label).toBe("未分类");
    expect(UNCLASSIFIED_OPTION.badgeClass.length).toBeGreaterThan(0);
  });
});

describe("workspaceTypeBadge 徽标渲染", () => {
  it("null / undefined / 空串 → 「未分类」灰徽标", () => {
    for (const empty of [null, undefined, ""] as const) {
      const view = workspaceTypeBadge(empty);
      expect(view.label).toBe("未分类");
      expect(view.className).toBe(UNCLASSIFIED_OPTION.badgeClass);
    }
  });

  it("已知 8 值 → 词表对应中文标签与配色", () => {
    for (const option of WORKSPACE_TYPE_OPTIONS) {
      const view = workspaceTypeBadge(option.value);
      expect(view.label).toBe(option.label);
      expect(view.className).toBe(option.badgeClass);
    }
  });

  it("未知非空值 → 原值 + 灰徽标（存量脏数据/废弃旧值不崩）", () => {
    for (const unknownValue of ["daemon-client", "web", "some-legacy-type"]) {
      const view = workspaceTypeBadge(unknownValue);
      expect(view.label).toBe(unknownValue);
      expect(view.className).toBe(UNCLASSIFIED_OPTION.badgeClass);
    }
  });

  it("任意输入不抛错（含类型字面量已越界的极端串）", () => {
    expect(() => workspaceTypeBadge(null)).not.toThrow();
    expect(() => workspaceTypeBadge(undefined)).not.toThrow();
    expect(() => workspaceTypeBadge("")).not.toThrow();
    expect(() => workspaceTypeBadge("other")).not.toThrow();
    expect(() => workspaceTypeBadge("backend/app")).not.toThrow();
  });
});
