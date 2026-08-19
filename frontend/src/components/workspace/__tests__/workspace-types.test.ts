/**
 * lib/workspace-types 词表 helper 测试（change 2026-08-18-workspace-role-type task-08）。
 *
 * 覆盖 task-05 词表契约（design §5.1/§5.4 / FR-01 / FR-04 / D-002@v1）：
 *  - WORKSPACE_TYPE_OPTIONS：8 项、value 唯一且全为合法词表值、每项带中文 label+badgeClass；
 *  - UNCLASSIFIED_OPTION：value=null 的「未分类」展示项；
 *  - workspaceTypeBadge：词表值→中文标签+词表配色；NULL/undefined/空串→「未分类」灰；
 *    未知非空值（存量脏数据 / 废弃旧值如 daemon-client）→ 原值+灰徽标，不抛错。
 *
 * 纯逻辑无 DOM——vitest.config.ts environmentMatchGlobs 只对 src/lib 白名单切
 * node，本文件在 components 目录下走默认 jsdom，同样只做纯断言。
 */
import { describe, expect, it } from "vitest";

import {
  UNCLASSIFIED_OPTION,
  WORKSPACE_TYPE_OPTIONS,
  workspaceTypeBadge,
} from "@/lib/workspace-types";

describe("WORKSPACE_TYPE_OPTIONS（8 值受控词表）", () => {
  it("恰好 8 项，value 与后端词表逐字对齐", () => {
    expect(WORKSPACE_TYPE_OPTIONS).toHaveLength(8);
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

  it("每项带中文 label 与 badgeClass 配色（非空、无重复）", () => {
    const badgeClasses = new Set<string>();
    for (const option of WORKSPACE_TYPE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.badgeClass.length).toBeGreaterThan(0);
      badgeClasses.add(option.badgeClass);
    }
    // 8 色错开（task-05 配色策略），无两项共用同一配色
    expect(badgeClasses.size).toBe(WORKSPACE_TYPE_OPTIONS.length);
  });

  it("不含废弃旧值 daemon-client / web / service", () => {
    const values = WORKSPACE_TYPE_OPTIONS.map((o) => o.value);
    expect(values).not.toContain("daemon-client");
    expect(values).not.toContain("web");
    expect(values).not.toContain("service");
  });
});

describe("UNCLASSIFIED_OPTION（未分类展示项）", () => {
  it("value=null，label「未分类」，灰阶兜底配色", () => {
    expect(UNCLASSIFIED_OPTION.value).toBeNull();
    expect(UNCLASSIFIED_OPTION.label).toBe("未分类");
    expect(UNCLASSIFIED_OPTION.badgeClass).toContain("text-zinc-500");
  });
});

describe("workspaceTypeBadge（徽标渲染统一入口）", () => {
  it("8 值词表内 → 对应中文标签 + 词表配色", () => {
    for (const option of WORKSPACE_TYPE_OPTIONS) {
      const view = workspaceTypeBadge(option.value);
      expect(view.label).toBe(option.label);
      expect(view.className).toBe(option.badgeClass);
    }
  });

  it("null / undefined / 空串 → 「未分类」灰（空串视同未填）", () => {
    for (const empty of [null, undefined, ""]) {
      const view = workspaceTypeBadge(empty);
      expect(view.label).toBe("未分类");
      expect(view.className).toBe(UNCLASSIFIED_OPTION.badgeClass);
    }
  });

  it("未知非空值 → 原值 + 灰徽标，不抛错（存量脏数据兜底）", () => {
    // daemon-client / web 是本变更废弃的旧值，存量行可能仍带
    for (const legacy of ["daemon-client", "web"]) {
      const view = workspaceTypeBadge(legacy);
      expect(view.label).toBe(legacy);
      expect(view.className).toBe(UNCLASSIFIED_OPTION.badgeClass);
    }
    // 任意未知值同样不崩
    expect(() => workspaceTypeBadge("whatever-legacy")).not.toThrow();
    expect(workspaceTypeBadge("whatever-legacy").label).toBe("whatever-legacy");
  });
});
