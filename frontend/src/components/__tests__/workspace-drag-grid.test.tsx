/**
 * task-10 / 2026-09-14-workspace-drag-sort / FR-04 / FR-05 / FR-07：
 * WorkspaceDragGrid（task-08 产物）拖拽排序网格组件测试。
 *
 * 覆盖（对照任务卡 task-10 ①~⑦ 与 requirements.md FR-04/05/07）：
 *   ① 投放带显隐边界：第 1 页无上带 / 末页无下带 / 中间页两条都有 / dragDisabled 都不出现
 *   ② 落带提交参数：下带 to="next_page_head"、上带 to="prev_page_tail"（均含 page_size=12）
 *   ③ 页内拖放：drop 后 moveWorkspace(id, {after_id: 落位前邻卡})；落位页首无前邻时
 *      before_id=新序第二张；本地乐观重排 + 失败回滚（FR-04，恰发一次 move）
 *   ④ rank 换算与高亮：onMoved 上抛 {page: floor(rank / WORKSPACE_PAGE_SIZE)}；
 *      被移动卡 wdg-just-moved 高亮 1.6s 出现与消退（fake timers 推进）
 *   ⑤ 筛选禁拖（dragDisabled，D-005@v2 网格侧）：手柄禁用灰显 + 键盘拖拽零响应
 *      + moveWorkspace 零调用（提示文案/入口禁用归 page.test 断言）
 *   ⑥ onRequestMove 缺省时「移动到…」挂点不渲染（挂点默认不渲染契约的网格侧）
 *
 * dnd-kit 交互走 KeyboardSensor 官方键盘路径（Space 起拖 + 方向键移动 + Space 落放，
 * @dnd-kit 无官方 testing 库，键盘路径是 jsdom 下受支持的稳定通道）：
 *   - jsdom 无布局——patch getBoundingClientRect 给每张卡（data-ws-id 按 DOM 序，
 *     单列网格 120px 行距）与上下投放带确定性矩形，使 sortableKeyboardCoordinates +
 *     closestCorners 的碰撞计算可复现；
 *   - KeyboardSensor 起拖后经 setTimeout(0) 才挂 document keydown 监听——每步交互后
 *     advanceTimersByTime(0) 推进；全文件 fake timers，兼管 1.6s 高亮断言不引入真实等待。
 */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDragGrid } from "@/components/workspace-drag-grid";
import { WORKSPACE_PAGE_SIZE, type Workspace } from "@/lib/workspaces";

// ── lib/workspaces mock（importActual 保留 WORKSPACE_PAGE_SIZE 常量；moveWorkspace 全 mock）──
const wsApi = vi.hoisted(() => ({ moveWorkspace: vi.fn() }));
vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, moveWorkspace: wsApi.moveWorkspace };
});

// ── @/lib/errors mock（网格失败分支用 notify.error——成功/警示调用留给 page.test）──
const notifyMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/lib/errors", () => ({
  useNotify: () => notifyMock,
}));

// ── WorkspaceCard stub（拖拽测试聚焦网格层）：手柄 span 透传 dragHandleProps
//    （ref/className 单列拆解，对齐真实卡片注入方式），挂点节点按需渲染。──
vi.mock("@/components/workspace-card", () => ({
  WorkspaceCard: (props: any) => {
    const { ref, className, ...handleRest } = props.dragHandleProps ?? {};
    return (
      <div data-testid={`ws-card-${props.workspace.id}`}>
        <span
          title="拖拽排序"
          data-testid={`ws-handle-${props.workspace.id}`}
          ref={ref}
          className={className}
          {...handleRest}
        >
          ⠿
        </span>
        {props.dragHandleNode ?? null}
      </div>
    );
  },
}));

// ── fixtures ────────────────────────────────────────────────────────────────
function mkWorkspace(id: string): Workspace {
  return {
    id,
    name: id,
    display_alias: null,
    slug: id,
    root_path: `/srv/${id}`,
    status: "active",
    component_key: null,
    type: null,
    role: null,
    repo_url: null,
    default_branch: null,
    default_agent: null,
    default_model: null,
    tech_stack: [],
    build_command: null,
    test_command: null,
    source_yaml_path: null,
    created_by: null,
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    last_scanned_at: null,
    deleted_at: null,
    owner: null,
  };
}

const items3 = () => [mkWorkspace("ws-a"), mkWorkspace("ws-b"), mkWorkspace("ws-c")];

const TOP_ZONE_LABEL = "▲ 拖到此处 → 移到上一页末尾";
const BOTTOM_ZONE_LABEL = "▼ 拖到此处 → 移到下一页开头";

/** moveWorkspace 默认成功响应（rank 可按用例覆盖 mockResolvedValueOnce）。 */
const okMove = (rank: number) => ({
  workspace: mkWorkspace("ws-a"),
  rebalanced: false,
  rank,
});

type GridProps = React.ComponentProps<typeof WorkspaceDragGrid>;

function renderGrid(overrides: Partial<GridProps> = {}) {
  const onMoved = vi.fn();
  const onMoveFailed = vi.fn();
  const onRequestMove = vi.fn();
  const view = render(
    <WorkspaceDragGrid
      items={items3()}
      page={0}
      total={30}
      cardProps={() => ({ onChanged: () => {}, onEditAlias: () => {} })}
      onMoved={onMoved}
      onMoveFailed={onMoveFailed}
      onRequestMove={onRequestMove}
      {...overrides}
    />,
  );
  return { ...view, onMoved, onMoveFailed, onRequestMove };
}

/** 当前渲染顺序（乐观更新断言）：data-ws-id 即卡片包装层 id。 */
function renderedOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-ws-id]")).map((el) =>
    el.getAttribute("data-ws-id")!,
  );
}

function movedWrapper(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-ws-id="${id}"]`)!;
}

// ── jsdom 布局与滚动补丁 ─────────────────────────────────────────────────────
// 单列确定性布局：第 i 张卡 top=i*120（高 100）；上带 top=-60、下带紧随末卡下方。
const makeRect = (top: number, width: number, height: number) => {
  const rect = {
    x: 0,
    y: top,
    top,
    left: 0,
    right: width,
    bottom: top + height,
    width,
    height,
    toJSON() {
      return rect;
    },
  };
  return rect as unknown as DOMRect;
};

const origScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  // jsdom 未实现 scrollIntoView（高亮滚动入视野 / sensor 起拖兜底都可能触达）。
  Element.prototype.scrollIntoView = () => {};
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const wsId = this.getAttribute("data-ws-id");
    if (wsId != null) {
      const parent = this.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(this) : 0;
      return makeRect(idx * 120, 100, 100);
    }
    const text = this.textContent ?? "";
    if (text.includes("移到上一页末尾")) {
      return makeRect(-60, 100, 40);
    }
    if (text.includes("移到下一页开头")) {
      const count = document.querySelectorAll("[data-ws-id]").length;
      return makeRect(count * 120 + 20, 100, 40);
    }
    return makeRect(0, 0, 0);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
  if (origScrollIntoView) {
    Element.prototype.scrollIntoView = origScrollIntoView;
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

beforeEach(() => {
  vi.useFakeTimers();
  wsApi.moveWorkspace.mockReset();
  wsApi.moveWorkspace.mockImplementation(() => okMove(2));
  notifyMock.error.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── 键盘拖拽驱动（KeyboardSensor 官方测试路径）──────────────────────────────
/** 推进一个交互节拍：跑完到期的 setTimeout(0)（sensor 挂监听/React 副作用）+ 微任务。 */
async function flush() {
  await act(async () => {
    vi.advanceTimersByTime(0);
    await Promise.resolve();
  });
}

/** Space 起拖（在手柄上触发 onKeyDown 激活 KeyboardSensor）。 */
async function startKeyboardDrag(handleTestId: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId(handleTestId), { code: "Space" });
  });
  await flush();
}

/** 方向键 / 结束键（document 级 keydown，KeyboardSensor 拖拽期监听）。 */
async function press(code: string) {
  await act(async () => {
    fireEvent.keyDown(document.body, { code });
  });
  await flush();
}

/** 键盘拖拽全流程：Space 起拖 → 逐个方向键 → Space 落放。 */
async function keyboardDrag(handleTestId: string, arrows: string[]) {
  await startKeyboardDrag(handleTestId);
  for (const code of arrows) {
    await press(code);
  }
  await press("Space");
  await flush();
}

describe("WorkspaceDragGrid 投放带显隐边界 (FR-05 / 任务卡①)", () => {
  it("第 1 页（page=0）拖起：出现下带、不出现上带", async () => {
    renderGrid({ page: 0, total: 30 });
    await startKeyboardDrag("ws-handle-ws-a");
    expect(screen.getByText(BOTTOM_ZONE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(TOP_ZONE_LABEL)).not.toBeInTheDocument();
    await press("Escape"); // 收起投放带结束拖拽
    expect(screen.queryByText(BOTTOM_ZONE_LABEL)).not.toBeInTheDocument();
  });

  it("末页（(page+1)*12>=total）拖起：出现上带、不出现下带", async () => {
    renderGrid({ page: 2, total: 26, items: [mkWorkspace("ws-a"), mkWorkspace("ws-b")] });
    await startKeyboardDrag("ws-handle-ws-a");
    expect(screen.getByText(TOP_ZONE_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(BOTTOM_ZONE_LABEL)).not.toBeInTheDocument();
  });

  it("中间页拖起：上带与下带都出现", async () => {
    renderGrid({ page: 1, total: 30 });
    await startKeyboardDrag("ws-handle-ws-a");
    expect(screen.getByText(TOP_ZONE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(BOTTOM_ZONE_LABEL)).toBeInTheDocument();
  });

  it("dragDisabled（筛选态）：手柄禁用灰显 + 键盘拖拽零响应（无任何投放带、零 move 调用）", async () => {
    renderGrid({ dragDisabled: true });
    const handle = screen.getByTestId("ws-handle-ws-a");
    // 手柄禁用态可见不隐藏（D-005@v2）：cursor-not-allowed + 半透明灰显。
    expect(handle.className).toContain("cursor-not-allowed");
    expect(handle.className).toContain("!opacity-40");
    // 完整键盘拖拽序列（Space 起拖 + 方向键 + Space 落放）均零响应。
    await keyboardDrag("ws-handle-ws-a", ["ArrowDown", "ArrowDown"]);
    expect(screen.queryByText(TOP_ZONE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(BOTTOM_ZONE_LABEL)).not.toBeInTheDocument();
    expect(wsApi.moveWorkspace).not.toHaveBeenCalled();
  });

  it("未拖拽时投放带不渲染（静默态无带）", () => {
    renderGrid({ page: 1, total: 30 });
    expect(screen.queryByText(TOP_ZONE_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(BOTTOM_ZONE_LABEL)).not.toBeInTheDocument();
  });
});

describe("WorkspaceDragGrid 落带提交参数 (FR-05 / D-012 / 任务卡②)", () => {
  it("下带落放：moveWorkspace(id, {to:'next_page_head', page_size:12}) + rank 换算页码上抛", async () => {
    wsApi.moveWorkspace.mockImplementationOnce(() => okMove(13)); // rank 13 → 第 2 页(0 基 1)
    const { onMoved } = renderGrid({ page: 0, total: 30 });
    // ws-a（首行）向下 3 步：ws-b → ws-c → 下带。
    await keyboardDrag("ws-handle-ws-a", ["ArrowDown", "ArrowDown", "ArrowDown"]);
    expect(wsApi.moveWorkspace).toHaveBeenCalledTimes(1);
    expect(wsApi.moveWorkspace).toHaveBeenCalledWith("ws-a", {
      to: "next_page_head",
      page_size: WORKSPACE_PAGE_SIZE,
    });
    expect(onMoved).toHaveBeenCalledWith({
      id: "ws-a",
      rank: 13,
      page: Math.floor(13 / WORKSPACE_PAGE_SIZE),
    });
  });

  it("上带落放：moveWorkspace(id, {to:'prev_page_tail', page_size:12})", async () => {
    wsApi.moveWorkspace.mockImplementationOnce(() => okMove(11)); // rank 11 → 第 1 页(0 基 0)
    const { onMoved } = renderGrid({ page: 1, total: 30 });
    // ws-c（末行）向上 3 步：ws-b → ws-a → 上带。
    await keyboardDrag("ws-handle-ws-c", ["ArrowUp", "ArrowUp", "ArrowUp"]);
    expect(wsApi.moveWorkspace).toHaveBeenCalledTimes(1);
    expect(wsApi.moveWorkspace).toHaveBeenCalledWith("ws-c", {
      to: "prev_page_tail",
      page_size: WORKSPACE_PAGE_SIZE,
    });
    expect(onMoved).toHaveBeenCalledWith({ id: "ws-c", rank: 11, page: 0 });
  });
});

describe("WorkspaceDragGrid 页内拖放 (FR-04 / 任务卡③④)", () => {
  it("拖到第三张之后：恰一次 moveWorkspace(id,{after_id:前邻卡}) + 乐观重排", async () => {
    const { container, onMoved } = renderGrid({ page: 0, total: 30 });
    await keyboardDrag("ws-handle-ws-a", ["ArrowDown", "ArrowDown"]); // 落在 ws-c 上
    expect(wsApi.moveWorkspace).toHaveBeenCalledTimes(1);
    expect(wsApi.moveWorkspace).toHaveBeenCalledWith("ws-a", { after_id: "ws-c" });
    // 乐观更新：本地序即时变为 [ws-b, ws-c, ws-a]（D-008 后写覆盖）。
    expect(renderedOrder(container)).toEqual(["ws-b", "ws-c", "ws-a"]);
    expect(onMoved).toHaveBeenCalledWith({ id: "ws-a", rank: 2, page: 0 });
  });

  it("拖到本页页首（无前邻卡）：改携 before_id=新序第二张（原页首）", async () => {
    const { container } = renderGrid({ page: 0, total: 30 });
    await keyboardDrag("ws-handle-ws-c", ["ArrowUp", "ArrowUp"]); // 落在 ws-a 上（页首）
    expect(wsApi.moveWorkspace).toHaveBeenCalledTimes(1);
    expect(wsApi.moveWorkspace).toHaveBeenCalledWith("ws-c", { before_id: "ws-a" });
    expect(renderedOrder(container)).toEqual(["ws-c", "ws-a", "ws-b"]);
  });

  it("move 失败：乐观序回滚 + onMoveFailed 上抛 + notify.error，无高亮残留", async () => {
    wsApi.moveWorkspace.mockRejectedValueOnce(new Error("boom"));
    const { container, onMoveFailed, onMoved } = renderGrid({ page: 0, total: 30 });
    await keyboardDrag("ws-handle-ws-a", ["ArrowDown", "ArrowDown"]);
    expect(wsApi.moveWorkspace).toHaveBeenCalledTimes(1);
    // 回滚：恢复 props 原序（FR-04 失败回滚）。
    expect(renderedOrder(container)).toEqual(["ws-a", "ws-b", "ws-c"]);
    expect(onMoveFailed).toHaveBeenCalledTimes(1);
    expect(onMoved).not.toHaveBeenCalled();
    expect(notifyMock.error).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".wdg-just-moved"),
    ).not.toBeInTheDocument();
  });
});

describe("WorkspaceDragGrid rank 换算与 1.6s 高亮 (FR-05 / R-07 / 任务卡④)", () => {
  it("move 成功：onMoved.page=floor(rank/12) + 目标卡高亮 1.6s 出现与消退", async () => {
    wsApi.moveWorkspace.mockImplementationOnce(() => okMove(14)); // 14/12 → page 1
    const { container, onMoved } = renderGrid({ page: 0, total: 30 });
    await keyboardDrag("ws-handle-ws-a", ["ArrowDown", "ArrowDown"]);
    expect(onMoved).toHaveBeenCalledWith({ id: "ws-a", rank: 14, page: 1 });
    // 高亮出现（wdg-just-moved 主题 token 动画类，FR-05）。
    expect(movedWrapper(container, "ws-a").className).toContain("wdg-just-moved");
    // 推进 1.6s 高亮自动消退。
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(movedWrapper(container, "ws-a").className).not.toContain("wdg-just-moved");
  });

  it("落带跨页 move 成功：高亮同样落在被拖卡上（onMoved 页码=目标页）", async () => {
    wsApi.moveWorkspace.mockImplementationOnce(() => okMove(24)); // 24/12 → page 2
    const { container, onMoved } = renderGrid({ page: 1, total: 30 });
    await keyboardDrag("ws-handle-ws-a", ["ArrowDown", "ArrowDown", "ArrowDown"]); // 下带
    expect(onMoved).toHaveBeenCalledWith({ id: "ws-a", rank: 24, page: 2 });
    expect(movedWrapper(container, "ws-a").className).toContain("wdg-just-moved");
  });
});

describe("WorkspaceDragGrid 挂点契约 (任务卡⑥)", () => {
  it("不传 onRequestMove：「移动到…」入口不渲染，拖拽手柄仍在", () => {
    renderGrid({ onRequestMove: undefined });
    expect(screen.queryByTitle("移动到指定页…")).not.toBeInTheDocument();
    // 拖拽手柄不受影响（每卡一个）。
    expect(screen.getAllByTitle("拖拽排序")).toHaveLength(3);
  });

  it("传 onRequestMove：每张卡渲染「移动到…」入口且点击上抛对应工作区", () => {
    const { onRequestMove } = renderGrid();
    // 入口随挂点渲染在卡片内（每卡一个，取 ws-b 卡内入口精确断言）。
    const entry = within(screen.getByTestId("ws-card-ws-b")).getByTitle("移动到指定页…");
    fireEvent.click(entry);
    expect(onRequestMove).toHaveBeenCalledTimes(1);
    expect(onRequestMove).toHaveBeenCalledWith(expect.objectContaining({ id: "ws-b" }));
  });
});
