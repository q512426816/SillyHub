/**
 * 知识注入作用域维护（2026-10-23-knowledge-scope-maintenance）前端用例。
 *
 * ① knowledgeEntryMatchesScope：筛选档矩阵（all/always/repo/module/keyword）
 * ② ScopeMaintainDialog：目标节切换回填当前档位、module 显示域输入并解析逗号域、
 *    保存调用 updateKnowledgeScope 后 onSaved/onClose 触发
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  knowledgeEntryMatchesScope,
  type KnowledgeEntryWithScopes,
} from "@/lib/knowledge";

const updateKnowledgeScope = vi.fn();
vi.mock("@/lib/knowledge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/knowledge")>("@/lib/knowledge");
  return {
    ...actual,
    updateKnowledgeScope: (...args: unknown[]) => updateKnowledgeScope(...args),
  };
});
vi.mock("@/lib/errors", () => ({
  errMessage: (e: unknown) => String(e),
  useNotify: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

import { ScopeMaintainDialog } from "@/components/knowledge/scope-maintain-dialog";

const item = (sections: KnowledgeEntryWithScopes["sections"]): KnowledgeEntryWithScopes =>
  ({ zone: "top", filename: "conventions.md", path: "", sections }) as KnowledgeEntryWithScopes;

describe("knowledgeEntryMatchesScope", () => {
  it("all 恒真；keyword=无任何节级标记", () => {
    expect(knowledgeEntryMatchesScope(item([]), "all")).toBe(true);
    expect(knowledgeEntryMatchesScope(item([]), "keyword")).toBe(true);
    expect(knowledgeEntryMatchesScope(item([]), "always")).toBe(false);
    expect(
      knowledgeEntryMatchesScope(item([{ heading: "A", scope: "always", domains: [] }]), "keyword"),
    ).toBe(false);
  });

  it("按节档位命中（module 含域）", () => {
    const withModule = item([
      { heading: "A", scope: "module", domains: ["cli-entry"] },
    ]);
    expect(knowledgeEntryMatchesScope(withModule, "module")).toBe(true);
    expect(knowledgeEntryMatchesScope(withModule, "always")).toBe(false);
    expect(
      knowledgeEntryMatchesScope(item([{ heading: "B", scope: "repo", domains: [] }]), "repo"),
    ).toBe(true);
  });
});

describe("ScopeMaintainDialog", () => {
  it("切换目标节回填当前档位；module 输入解析逗号域并提交", async () => {
    updateKnowledgeScope.mockResolvedValue({});
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <ScopeMaintainDialog
        workspaceId="ws-1"
        filename="conventions.md"
        headings={["工具中立性", "本仓发布纪律"]}
        sections={[{ heading: "工具中立性", scope: "always", domains: [] }]}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    // 首个节=always 已回填
    expect((screen.getByTestId("scope-radio-always") as HTMLInputElement).checked).toBe(true);

    // 切到无标记节 → 关键词档
    fireEvent.change(screen.getByTestId("scope-heading-select"), {
      target: { value: "本仓发布纪律" },
    });
    expect((screen.getByTestId("scope-radio-keyword") as HTMLInputElement).checked).toBe(true);

    // 选 module → 出现域输入 → 填写并保存
    fireEvent.click(screen.getByTestId("scope-radio-module"));
    fireEvent.change(screen.getByTestId("scope-domains-input"), {
      target: { value: "cli-entry, core-engine" },
    });
    fireEvent.click(screen.getByTestId("scope-save-button"));

    await waitFor(() => expect(updateKnowledgeScope).toHaveBeenCalledTimes(1));
    expect(updateKnowledgeScope).toHaveBeenCalledWith("ws-1", {
      filename: "conventions.md",
      heading: "本仓发布纪律",
      scope: "module",
      domains: ["cli-entry", "core-engine"],
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("关键词档提交 domains 为空（移除标记语义）", async () => {
    updateKnowledgeScope.mockClear();
    updateKnowledgeScope.mockResolvedValue({});
    render(
      <ScopeMaintainDialog
        workspaceId="ws-1"
        filename="patterns.md"
        headings={["既有"]}
        sections={[{ heading: "既有", scope: "repo", domains: [] }]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // repo 回填 → 改关键词档 → 保存
    expect((screen.getByTestId("scope-radio-repo") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("scope-radio-keyword"));
    fireEvent.click(screen.getByTestId("scope-save-button"));
    await waitFor(() => expect(updateKnowledgeScope).toHaveBeenCalledTimes(1));
    expect(updateKnowledgeScope).toHaveBeenCalledWith("ws-1", {
      filename: "patterns.md",
      heading: "既有",
      scope: "keyword",
      domains: [],
    });
  });
});
