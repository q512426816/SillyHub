/**
 * workspace-tabs.test.tsx — 页签高亮唯一性（双亮回归钉）
 * 2026-10-08 实证：/knowledge/graph 下「知识库」与「知识图谱」同时点亮——
 * 根因是 isActive 的目录前缀匹配（startsWith(full+"/")）让父路径页签也命中。
 * 修复=最长匹配胜出（R-04 升级）；本文件钉死嵌套页签只亮最长者。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "../workspace-tabs";

const state = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

const setup = (path: string) => {
  state.pathname = path;
  return render(
    <WorkspaceTabs workspaceId="ws-1">
      <div />
    </WorkspaceTabs>,
  );
};

const activeTabs = () =>
  screen
    .getAllByRole("link")
    .filter((el) => el.getAttribute("aria-current") === "page")
    .map((el) => el.textContent?.trim());

describe("WorkspaceTabs 页签高亮唯一性", () => {
  it("知识图谱子路径只亮「知识图谱」，父级「知识库」不亮（双亮回归）", () => {
    setup("/workspaces/ws-1/knowledge/graph");
    expect(activeTabs()).toEqual(["知识图谱"]);
  });

  it("知识库自身路径只亮「知识库」", () => {
    setup("/workspaces/ws-1/knowledge");
    expect(activeTabs()).toEqual(["知识库"]);
  });

  it("工作区概览（base 精确）只亮「概览」", () => {
    setup("/workspaces/ws-1");
    expect(activeTabs()).toEqual(["概览"]);
  });

  it("带尾斜杠的图谱路径仍只亮「知识图谱」", () => {
    setup("/workspaces/ws-1/knowledge/graph/");
    expect(activeTabs()).toEqual(["知识图谱"]);
  });
});
