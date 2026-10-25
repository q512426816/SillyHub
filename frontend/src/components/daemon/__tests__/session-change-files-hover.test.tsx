import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// useSessionChanges 解耦后端（本文件只测 UI 分组/交互，数据层 hook 有独立职责）
vi.mock("@/lib/changes", () => ({
  useSessionChanges: vi.fn(),
}));

// ChangeFileTree 浅 mock：组件本体（树+预览+全屏）已有专属测试
// （__tests__/change-file-tree*.test.tsx），此处捕获 props 断言接线契约——
// changeId 正确 / autoRefreshMs=15000 / key 随切换重挂载。
const treeMounts = vi.hoisted(
  () => [] as Array<{ changeId: string; autoRefreshMs?: number }>,
);
vi.mock("@/components/change-file-tree", () => ({
  ChangeFileTree: (props: { changeId: string; autoRefreshMs?: number }) => {
    treeMounts.push({ changeId: props.changeId, autoRefreshMs: props.autoRefreshMs });
    return <div data-testid={`change-file-tree-${props.changeId}`} />;
  },
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  SessionChangeFilesHover,
  splitByArchive,
} from "@/components/daemon/session-change-files-hover";
import { useSessionChanges } from "@/lib/changes";
import type { ChangeSummary } from "@/lib/changes";

const mockedHook = vi.mocked(useSessionChanges);

function change(partial: Partial<ChangeSummary>): ChangeSummary {
  return {
    id: "id-x",
    change_key: "k",
    title: null,
    description: null,
    status: "active",
    location: "active",
    change_type: null,
    is_thin: false,
    affected_components: [],
    owner_id: null,
    current_stage: null,
    pending_review: null,
    step_progress: null,
    owner_name: null,
    last_pushed_at: null,
    usage: null,
    updated_at: "2026-10-13T12:00:00Z",
    ...partial,
  } as ChangeSummary;
}

const activeThin = change({
  id: "c-1",
  change_key: "2026-10-13-hover-demo",
  current_stage: "execute",
  is_thin: true,
});
const activeFull = change({
  id: "c-2",
  change_key: "2026-10-13-agentlog-diff",
  current_stage: "plan",
});
const archivedOne = change({
  id: "c-3",
  change_key: "2026-10-12-old-change",
  location: "archive",
});

function mockData(data: ChangeSummary[] | undefined) {
  mockedHook.mockReturnValue({ data } as ReturnType<typeof useSessionChanges>);
}

/** 打开下拉：2026-10-16-session-pill-dock-drag 起 click 触发（hover 不再弹）。 */
async function openPopover() {
  fireEvent.click(screen.getByTestId("session-change-files-hover").querySelector("button")!);
  await screen.findByTestId("session-change-popover");
}

/** 触发 antd v6 Select 选某选项（mousedown 打开下拉 + click 选项）。
 * 2026-10-13-session-changefiles-select-fix：断言下拉挂进 DialogContent
 * （getPopupContainer=closest role=dialog）——radix modal 下 body 层
 * pointer-events:none，挂 body 的选项在真实浏览器点不动且触发 outside-close。 */
async function selectAntdOption(optionText: string) {
  const zone = document.querySelector(".ant-select") as HTMLElement;
  expect(zone).toBeTruthy();
  fireEvent.mouseDown(zone.querySelector(".ant-select-selector") ?? zone);
  const option = await waitFor(
    () => {
      const el = [
        ...document.querySelectorAll(".ant-select-item-option"),
      ].find((o) => o.textContent?.includes(optionText)) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    },
    { timeout: 3000 },
  );
  // 挂载位置守护：下拉 DOM 必须位于弹窗（role=dialog）内
  expect(option.closest('[role="dialog"]')).not.toBeNull();
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

beforeEach(() => {
  treeMounts.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("splitByArchive（纯函数）", () => {
  it("未归档在前归档在后分组，保持入参序（后端已排序）", () => {
    const { active, archived } = splitByArchive([activeThin, archivedOne, activeFull]);
    expect(active.map((c) => c.id)).toEqual(["c-1", "c-2"]);
    expect(archived.map((c) => c.id)).toEqual(["c-3"]);
  });

  it("双条件口径：status=archived 而 location=active（status 侧先到）也归归档组", () => {
    const statusArchived = change({
      id: "c-sa",
      change_key: "status-archived-only",
      status: "archived",
      location: "active",
    });
    const { active, archived } = splitByArchive([statusArchived, activeThin]);
    expect(archived.map((c) => c.id)).toEqual(["c-sa"]);
    expect(active.map((c) => c.id)).toEqual(["c-1"]);
  });
});

describe("SessionChangeFilesHover（2026-10-13-session-change-files-hover task-04）", () => {
  it("无关联变更（data 空数组/未就绪）不渲染入口", () => {
    mockData([]);
    const { container } = render(
      <SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />,
    );
    expect(container.querySelector('[data-testid="session-change-files-hover"]')).toBeNull();

    mockData(undefined);
    const r2 = render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);
    expect(r2.container.querySelector('[data-testid="session-change-files-hover"]')).toBeNull();
  });

  it("入口按钮可见文案为「变更」两字（aria-label 保留完整语义）", () => {
    // 2026-10-25-session-tab-visual-unify：可见文案精简为「变更」两字（用户需求）；
    // 无障碍读屏描述 aria-label 不变。
    mockData([activeThin]);
    render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);
    const btn = screen.getByLabelText("查看会话关联的变更文件");
    expect(btn.textContent).toContain("变更");
    expect(btn.textContent).not.toContain("变更文件");
  });

  it("点击弹下拉（hover 不再触发）：进行中置顶（轻量徽标+阶段），已归档默认折叠", async () => {
    mockData([activeThin, activeFull, archivedOne]);
    render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);
    // 2026-10-16-session-pill-dock-drag：hover 移入不再弹下拉（防误触）
    fireEvent.mouseEnter(screen.getByTestId("session-change-files-hover").querySelector("button")!);
    expect(screen.queryByTestId("session-change-popover")).toBeNull();

    await openPopover();

    expect(screen.getByText("进行中（2）")).toBeTruthy();
    expect(screen.getByText("轻量")).toBeTruthy();
    expect(screen.getByText("全量")).toBeTruthy();
    // 阶段中文名（WORKFLOW_STAGE_LABELS 口径）
    expect(screen.getByText("执行")).toBeTruthy();
    expect(screen.getByText("规划")).toBeTruthy();
    // 归档项默认收起
    expect(screen.queryByTestId("session-change-item-2026-10-12-old-change")).toBeNull();
    expect(screen.getByTestId("session-change-archive-toggle").textContent).toContain("已归档（1）");
  });

  it("status=archived 而 location=active 的变更归入已归档组（用户实测：平台已归档但仍显示进行中）", async () => {
    // 2026-10-13-session-changefiles-archive-gate：平台侧 status 归档信号先到、
    // location 待 reparse 收敛时，面板必须与变更中心「终态可测试定义」双条件一致。
    const statusArchived = change({
      id: "c-sa",
      change_key: "2026-10-13-fire-unitadd-form-import",
      status: "archived",
      location: "active",
      is_thin: true,
      current_stage: "thin",
    });
    mockData([statusArchived]);
    render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);

    // 进行中计数 0（不把已归档算进徽标）
    expect(screen.getByTestId("session-change-count").textContent).toBe("0");
    await openPopover();
    expect(screen.getByText("进行中（0）")).toBeTruthy();
    expect(screen.getByTestId("session-change-archive-toggle").textContent).toContain("已归档（1）");
    // 展开归档组：项可见且阶段标签为「已归档」（而非「干活中」）
    fireEvent.click(screen.getByTestId("session-change-archive-toggle"));
    expect(screen.getByTestId("session-change-item-2026-10-13-fire-unitadd-form-import")).toBeTruthy();
    expect(screen.getByText("已归档")).toBeTruthy();
    expect(screen.queryByText("干活中")).toBeNull();
  });

  it("轻量变更进行中（current_stage=thin）阶段标签为「干活中」——不拼出「轻量·轻量变更」重复", async () => {
    // 2026-10-13 用户实测反馈：is_thin 徽标「轻量」+ thin 阶段映射「轻量变更」
    // 拼成「轻量·轻量变更」。修复口径=原型「干活中」。
    const thinRunning = change({
      id: "c-thin",
      change_key: "2026-10-13-fire-unitadd-form-import",
      current_stage: "thin",
      is_thin: true,
    });
    mockData([thinRunning]);
    render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);
    await openPopover();

    expect(screen.getByText("干活中")).toBeTruthy();
    expect(screen.queryByText("轻量变更")).toBeNull();
  });

  it("已归档组点击展开/再收起", async () => {
    mockData([activeThin, archivedOne]);
    render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);
    await openPopover();

    fireEvent.click(screen.getByTestId("session-change-archive-toggle"));
    expect(screen.getByTestId("session-change-item-2026-10-12-old-change")).toBeTruthy();

    fireEvent.click(screen.getByTestId("session-change-archive-toggle"));
    expect(screen.queryByTestId("session-change-item-2026-10-12-old-change")).toBeNull();
  });

  it("点下拉项开大弹窗：ChangeFileTree 接收正确 changeId 与 autoRefreshMs=15000（FR-04/D-004@v1）", async () => {
    mockData([activeThin, archivedOne]);
    render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);
    await openPopover();

    fireEvent.click(screen.getByTestId("session-change-item-2026-10-13-hover-demo"));
    await screen.findByTestId("change-file-tree-c-1");
    expect(treeMounts.at(-1)).toEqual({ changeId: "c-1", autoRefreshMs: 15000 });
    expect(screen.getByText("变更文件实时预览")).toBeTruthy();
  });

  it("弹窗头部 Select 切换变更：ChangeFileTree key 重挂载换 changeId", async () => {
    mockData([activeThin, archivedOne]);
    render(<SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" />);
    await openPopover();

    fireEvent.click(screen.getByTestId("session-change-item-2026-10-13-hover-demo"));
    await screen.findByTestId("change-file-tree-c-1");
    expect(treeMounts).toHaveLength(1);

    await selectAntdOption("2026-10-12-old-change");
    await screen.findByTestId("change-file-tree-c-3");
    expect(treeMounts).toHaveLength(2);
    expect(treeMounts.at(-1)).toEqual({ changeId: "c-3", autoRefreshMs: 15000 });
  });

  it("running 且有进行中变更时入口徽标呼吸；非 running 不呼吸", () => {
    mockData([activeThin]);
    const { rerender } = render(
      <SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" running />,
    );
    expect(screen.getByTestId("session-change-count").className).toContain("animate-pulse");

    rerender(
      <SessionChangeFilesHover workspaceId="ws-1" sessionId="s-1" running={false} />,
    );
    expect(screen.getByTestId("session-change-count").className).not.toContain("animate-pulse");
    // 徽标计数 = 进行中变更数
    expect(screen.getByTestId("session-change-count").textContent).toBe("1");
  });
});
