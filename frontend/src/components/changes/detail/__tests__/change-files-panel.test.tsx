// 2026-10-15-change-detail-redesign / task-04（FR-07 / FR-11）：
// 「文件与对账」面板测试——三块编排在场、文件树以 props 直传内嵌（无 Dialog 包裹）、
// 范围对账卡收到 changeKey 与 archived 透传、面板零自有取数（子组件取数在组件内部）。
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeFilesPanel } from "@/components/changes/detail/change-files-panel";

const mocks = vi.hoisted(() => ({
  changeFileTree: vi.fn(),
  scopeAudit: vi.fn(),
  quicklog: vi.fn(),
}));

vi.mock("@/components/change-file-tree", () => ({
  ChangeFileTree: (props: Record<string, unknown>) => {
    mocks.changeFileTree(props);
    return <div data-testid="stub-file-tree" />;
  },
}));

vi.mock("@/components/changes/scope-audit-command-card", () => ({
  ScopeAuditCommandCard: (props: Record<string, unknown>) => {
    mocks.scopeAudit(props);
    return <div data-testid="stub-scope-audit" />;
  },
}));

vi.mock("@/components/changes/detail/quicklog-linked-card", () => ({
  QuicklogLinkedCard: (props: Record<string, unknown>) => {
    mocks.quicklog(props);
    return <div data-testid="stub-quicklog" />;
  },
}));

function renderPanel(archived = false) {
  return render(
    <ChangeFilesPanel
      workspaceId="ws-1"
      changeId="c-1"
      changeKey="2026-10-15-demo"
      archived={archived}
    />,
  );
}

describe("ChangeFilesPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("三块编排在场：变更文件 / 范围对账 / 关联的快速任务", () => {
    renderPanel();
    expect(screen.getByTestId("change-files-panel")).toBeInTheDocument();
    expect(screen.getByTestId("change-files-panel-tree")).toBeInTheDocument();
    expect(screen.getByTestId("stub-file-tree")).toBeInTheDocument();
    expect(screen.getByTestId("stub-scope-audit")).toBeInTheDocument();
    expect(screen.getByTestId("stub-quicklog")).toBeInTheDocument();
  });

  it("文件树以 props 直传内嵌（无「打开」按钮 + Dialog 包裹）", () => {
    renderPanel();
    expect(mocks.changeFileTree).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      changeId: "c-1",
    });
    expect(screen.queryByText("打开")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("范围对账卡收到 change 目标与 changeKey / archived 透传", () => {
    renderPanel(true);
    expect(mocks.scopeAudit).toHaveBeenCalledWith({
      target: { kind: "change", workspaceId: "ws-1", changeKey: "2026-10-15-demo" },
      archived: true,
    });
  });

  it("关联快速任务卡收到 workspaceId 与 changeKey", () => {
    renderPanel();
    expect(mocks.quicklog).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      changeKey: "2026-10-15-demo",
    });
  });
});
