/**
 * AgentProfileCardGrid 单测（task-07 / FR-08 / D-002）。
 *
 * 依据：
 *   - components/agent-profile/agent-profile-card-grid.tsx（task-03 实现）
 *   - design §7.2 组件签名 / §5 P3（全局页与 ws 内页复用）
 *   - design §12 验收 2：按工作区/可见范围/供应商筛选生效
 *
 * 覆盖：
 *   1. 数据源切换：
 *      - 不传 workspaceId/scopedToWorkspace → useMineAgentProfiles（聚合跨工作区）
 *      - 传 workspaceId+scopedToWorkspace → useWorkspaceAgentProfiles（单 ws）
 *   2. 搜索：回车（onPressEnter）触发，匹配 name 或 system_prompt；大小写不敏感
 *   3. 三筛选 onChange：visibility/供应商/工作区 各自过滤生效
 *   4. 系统预置卡（is_system_default）：grid 透传给 Card，卡内显「只读」无操作按钮
 *   5. 状态：加载中 Spin / 错误 + 重新加载 / 空态 Empty
 *
 * mock 策略说明：vi.mock 整个模块替换导出，但 actual 模块内部 hook 函数体引用的
 * 底层 fetch 仍绑定原函数（JS 模块作用域绑定），所以必须直接 mock hook 本身
 * （useMineAgentProfiles / useWorkspaceAgentProfiles），不能只 mock 底层 fetch。
 *
 * antd Select 触发说明：jsdom 下 antd v5 Select 需 mouseDown 打开下拉再点选项；
 * 选项 portal 到 document.body，用 findByText + selector 定位。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as React from "react";

import { AgentProfileCardGrid } from "@/components/agent-profile/agent-profile-card-grid";
import type { AgentProfileAggregatedItem } from "@/lib/agent-profiles";

// ── mocks ────────────────────────────────────────────────────────────────

/**
 * hoisted 状态容器：每个测试可改 mineReturn / wsReturn 控制对应 hook 返回。
 * profiles 用函数包裹便于测试中按需 mutate（vi.fn 让 spy 可断言调用次数）。
 */
const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  ws: vi.fn(),
  mineRefetch: vi.fn(),
  wsRefetch: vi.fn(),
}));

vi.mock("@/lib/agent-profiles", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-profiles")>(
      "@/lib/agent-profiles",
    );
  return {
    ...actual,
    useMineAgentProfiles: () => {
      // 调 mine() 取本次返回快照（测试用 mockReturnValueOnce 控制序列）
      const r = mocks.mine();
      return {
        profiles: r?.profiles ?? [],
        isLoading: r?.isLoading ?? false,
        isFetching: false,
        isError: r?.isError ?? false,
        error: r?.error ?? null,
        refetch: mocks.mineRefetch,
      };
    },
    useWorkspaceAgentProfiles: (_wid: string) => {
      const r = mocks.ws();
      return {
        profiles: r?.profiles ?? [],
        isLoading: r?.isLoading ?? false,
        isFetching: false,
        isError: r?.isError ?? false,
        error: r?.error ?? null,
        refetch: mocks.wsRefetch,
      };
    },
  };
});

// AgentProfilePreview 用 antd Modal，jsdom 下 Portal + getComputedStyle(pseudo) 会打
// "Not implemented" 错误但不影响 DOM 渲染；此处不 mock，保留真实预览弹窗契约。

/** 构造最小可用 AggregatedItem。 */
function makeProfile(
  overrides: Partial<AgentProfileAggregatedItem> = {},
): AgentProfileAggregatedItem {
  return {
    id: "p-1",
    name: "代码审查助手",
    visibility: "workspace",
    provider: "claude",
    model: "claude-sonnet-4",
    system_prompt: "你是资深代码审查员。",
    tool_policy_id: null,
    mcp_refs: [],
    skill_refs: [],
    owner_user_id: "u-1",
    workspace_id: "ws-1",
    workspace_name: "前端组",
    version: 1,
    is_system_default: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  } as unknown as AgentProfileAggregatedItem;
}

/** 默认 hook 返回（成功，空 profiles）。测试用 setMine/setWs 覆盖。 */
function setMine(r: Partial<{ profiles: any[]; isLoading: boolean; isError: boolean; error: any }>) {
  mocks.mine.mockReturnValue({
    profiles: [],
    isLoading: false,
    isError: false,
    error: null,
    ...r,
  });
}
function setWs(r: Partial<{ profiles: any[]; isLoading: boolean; isError: boolean; error: any }>) {
  mocks.ws.mockReturnValue({
    profiles: [],
    isLoading: false,
    isError: false,
    error: null,
    ...r,
  });
}

function renderGrid(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

/**
 * 触发 antd v5 Select 选某选项。
 *
 * 当前 antd v5 在 jsdom 渲染的 DOM：
 *   <div class="ant-select ...">
 *     <div class="ant-select-content">  ← 监听 mousedown 的容器（旧版叫 -selector）
 *       <div class="ant-select-placeholder">placeholder 文本</div>
 *       <input role="combobox" class="ant-select-input" ...>
 *     </div>
 *   </div>
 * 选项 portal 到 document.body 的 .ant-select-item-option。
 */
async function chooseAntdOption(placeholderText: string, optionText: string) {
  const placeholder = screen.getByText(placeholderText);
  const selectWrapper = placeholder.closest(".ant-select");
  if (!selectWrapper)
    throw new Error(`ant-select for placeholder "${placeholderText}" not found`);
  // 优先 antd v5 新结构 .ant-select-content，回退旧版 .ant-select-selector。
  const clickZone =
    selectWrapper.querySelector(".ant-select-content") ??
    selectWrapper.querySelector(".ant-select-selector");
  if (!clickZone)
    throw new Error(
      `ant-select click zone not found under placeholder "${placeholderText}"`,
    );
  fireEvent.mouseDown(clickZone as HTMLElement);
  // 选项 portal 到 document.body；用 selector 限定到 option content 避免误中卡片文本。
  const option = await screen.findByText(optionText, {
    selector: ".ant-select-item-option-content",
  });
  // 点击实际选项容器（antd onClick 挂在 .ant-select-item-option）
  // antd v5 Select 选项选中监听 mousedown + click；同时触发确保命中。
  const optionRow = option.closest(".ant-select-item-option") as HTMLElement;
  fireEvent.mouseDown(optionRow);
  fireEvent.click(optionRow);
  // 给 React 合成事件 + state 提交一拍（调用方再 waitFor 过滤生效）
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.mine.mockReset();
  mocks.ws.mockReset();
  mocks.mineRefetch.mockReset();
  mocks.wsRefetch.mockReset();
});

afterEach(() => {
  cleanup();
});

// ── 1. 数据源切换 ────────────────────────────────────────────────────────

describe("AgentProfileCardGrid 数据源切换（task-03 / design §7.2）", () => {
  it("不传 workspaceId → useMineAgentProfiles（聚合跨工作区）", () => {
    setMine({ profiles: [makeProfile({ id: "p-1" })] });
    renderGrid(<AgentProfileCardGrid />);

    expect(mocks.mine).toHaveBeenCalledTimes(1);
    expect(mocks.ws).not.toHaveBeenCalled();
    expect(screen.getByText("代码审查助手")).toBeInTheDocument();
  });

  it("传 workspaceId + scopedToWorkspace → useWorkspaceAgentProfiles（单 ws）", () => {
    setWs({ profiles: [makeProfile({ id: "p-ws" })] });
    renderGrid(<AgentProfileCardGrid workspaceId="ws-1" scopedToWorkspace />);

    expect(mocks.ws).toHaveBeenCalledTimes(1);
    expect(mocks.mine).not.toHaveBeenCalled();
    expect(screen.getByText("代码审查助手")).toBeInTheDocument();
  });

  it("scopedToWorkspace=true 但缺 workspaceId → 回退走 mine 数据源", () => {
    setMine({ profiles: [] });
    renderGrid(<AgentProfileCardGrid scopedToWorkspace />);
    expect(mocks.mine).toHaveBeenCalled();
    expect(mocks.ws).not.toHaveBeenCalled();
  });

  it("scopedToWorkspace=true → 隐藏「工作区」筛选下拉（锁定到单 ws）", () => {
    setWs({ profiles: [makeProfile()] });
    renderGrid(<AgentProfileCardGrid workspaceId="ws-1" scopedToWorkspace />);
    expect(screen.queryByText("工作区：全部")).not.toBeInTheDocument();
    // 其它两个筛选仍在
    expect(screen.getByText("可见范围：全部")).toBeInTheDocument();
    expect(screen.getByText("供应商：全部")).toBeInTheDocument();
  });
});

// ── 2. 搜索（回车触发） ───────────────────────────────────────────────────

describe("AgentProfileCardGrid 搜索（回车触发，FRONTEND_PAGE_STYLE §3）", () => {
  it("回车提交搜索：匹配 name 或 system_prompt，计数同步更新", async () => {
    setMine({
      profiles: [
        makeProfile({ id: "a", name: "代码审查助手", system_prompt: "审查代码" }),
        makeProfile({ id: "b", name: "运维巡检", system_prompt: "检查服务器" }),
        makeProfile({ id: "c", name: "文档作者", system_prompt: "写代码文档" }),
      ],
    });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText("代码审查助手")).toBeInTheDocument();

    // 初始 3 个
    expect(screen.getByText(/共 3 个档案/)).toBeInTheDocument();

    // 输入「代码」回车 → 匹配 name 含「代码」或 prompt 含「代码」
    // a: name「代码审查助手」命中；c: prompt「写代码文档」命中 → 2 个
    // antd Input.onPressEnter 监听 keyDown（非 keyPress），用 keyDown 触发。
    const input = screen.getByPlaceholderText(/搜索档案名或系统提示词/);
    await act(async () => {
      fireEvent.change(input, { target: { value: "代码" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter", charCode: 13 });
    });

    await waitFor(() => {
      expect(screen.getByText(/共 2 个档案/)).toBeInTheDocument();
    });
    expect(screen.getByText("代码审查助手")).toBeInTheDocument();
    expect(screen.getByText("文档作者")).toBeInTheDocument();
    expect(screen.queryByText("运维巡检")).not.toBeInTheDocument();
  });

  it("搜索大小写不敏感（HAY 大写 → 匹配小写 hay）", async () => {
    setMine({
      profiles: [
        makeProfile({ id: "a", name: "Hay Stack", system_prompt: "abc" }),
        makeProfile({ id: "b", name: "other", system_prompt: "xyz" }),
      ],
    });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText("Hay Stack")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/搜索档案名或系统提示词/);
    await act(async () => {
      fireEvent.change(input, { target: { value: "hay" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter", charCode: 13 });
    });
    await waitFor(() => {
      expect(screen.getByText(/共 1 个档案/)).toBeInTheDocument();
    });
    expect(screen.getByText("Hay Stack")).toBeInTheDocument();
  });
});

// ── 3. 三筛选 onChange ────────────────────────────────────────────────────

describe("AgentProfileCardGrid 三筛选（visibility/供应商/工作区）", () => {
  it("visibility 筛选：选「工作区」→ 仅留 workspace 级档案", async () => {
    setMine({
      profiles: [
        makeProfile({ id: "a", name: "工作区档", visibility: "workspace" }),
        makeProfile({ id: "b", name: "个人档", visibility: "private" }),
        makeProfile({ id: "c", name: "平台档", visibility: "platform" }),
      ],
    });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText("工作区档")).toBeInTheDocument();

    await chooseAntdOption("可见范围：全部", "工作区");

    await waitFor(() => {
      expect(screen.getByText(/共 1 个档案/)).toBeInTheDocument();
    });
    expect(screen.getByText("工作区档")).toBeInTheDocument();
    expect(screen.queryByText("个人档")).not.toBeInTheDocument();
    expect(screen.queryByText("平台档")).not.toBeInTheDocument();
  });

  it("供应商筛选：选「codex」→ 仅留 codex 档", async () => {
    setMine({
      profiles: [
        makeProfile({ id: "a", name: "审查", provider: "claude" }),
        makeProfile({ id: "b", name: "重构", provider: "codex" }),
      ],
    });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText("重构")).toBeInTheDocument();

    await chooseAntdOption("供应商：全部", "codex");

    await waitFor(() => {
      expect(screen.getByText(/共 1 个档案/)).toBeInTheDocument();
    });
    expect(screen.getByText("重构")).toBeInTheDocument();
    expect(screen.queryByText("审查")).not.toBeInTheDocument();
  });

  it("工作区筛选：选某 workspace_name → 仅留该 ws 档", async () => {
    setMine({
      profiles: [
        makeProfile({ id: "a", name: "前端档", workspace_name: "前端组" }),
        makeProfile({ id: "b", name: "后端档", workspace_name: "后端组" }),
      ],
    });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText("前端档")).toBeInTheDocument();

    await chooseAntdOption("工作区：全部", "后端组");

    await waitFor(() => {
      expect(screen.getByText(/共 1 个档案/)).toBeInTheDocument();
    });
    expect(screen.getByText("后端档")).toBeInTheDocument();
    expect(screen.queryByText("前端档")).not.toBeInTheDocument();
  });
});

// ── 4. 系统预置透传 ───────────────────────────────────────────────────────

describe("AgentProfileCardGrid 系统预置卡透传（design §12 验收 5）", () => {
  it("is_system_default 档案在 grid 中渲染为只读卡（无编辑/删除按钮）", () => {
    setMine({
      profiles: [
        makeProfile({ id: "sys", is_system_default: true, visibility: "platform" }),
      ],
    });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText("系统预置")).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^编辑$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^删除$/ })).not.toBeInTheDocument();
  });
});

// ── 5. 状态（加载/错误/空） ───────────────────────────────────────────────

describe("AgentProfileCardGrid 状态（加载/错误/空）", () => {
  it("加载中 → Spin（不渲染卡片）", () => {
    setMine({ profiles: [], isLoading: true });
    const { container } = renderGrid(<AgentProfileCardGrid />);
    expect(container.querySelector(".ant-spin")).toBeInTheDocument();
    expect(screen.queryByText("代码审查助手")).not.toBeInTheDocument();
  });

  it("空档案 → Empty「暂无智能体档案」", () => {
    setMine({ profiles: [] });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText(/暂无智能体档案/)).toBeInTheDocument();
    expect(screen.getByText(/共 0 个档案/)).toBeInTheDocument();
  });

  it("加载失败 → 红条 + 重新加载按钮", () => {
    setMine({ profiles: [], isError: true, error: { message: "boom" } });
    renderGrid(<AgentProfileCardGrid />);
    expect(screen.getByText(/加载档案失败/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  });
});
