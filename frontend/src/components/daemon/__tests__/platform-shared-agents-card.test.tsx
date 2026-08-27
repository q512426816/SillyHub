/**
 * 2026-08-28-daemon-agent-share task-09：PlatformSharedAgentsCard 平台共享智能体
 * 管理卡单测。
 *
 * 覆盖（task-09 acceptance / FR-04）：
 *   1. 渲染：创建表单四字段（档案/守护进程/源码工作区/writable_dir）+「新建共享」
 *      按钮 + 生效列表行（档案名/绑定 runtime + writable_dir/源码工作区/状态
 *      Badge 生效中·已停用/停用按钮）；
 *   2. 表单校验：空表单提交 → 四条中文必填提示，createSharedAgent 不被调；
 *   3. 创建交互：四字段填写提交 → createSharedAgent 收到正确 payload
 *      （promote_visibility=false——表单只列 platform 档案，R-05 无需升级）；
 *   4. 停用交互：生效行点「停用」→ disableSharedAgent(grantId)；已停用行按钮禁用。
 *
 * admin-only 渲染门控在 page 层（page.test.tsx 断言非 admin 不出现本卡）。
 * mock 网络层：@/lib/daemon（sharedAgents 四函数 + useDaemonMachines 数据源）、
 * @/lib/agent-profiles、@/lib/workspaces；antd Select 选项经 portal 渲染，
 * 用 mouseDown 展开 + findByText 点选（antd RTL 惯例）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { PlatformSharedAgentsCard } from "../platform-shared-agents-card";
import { useSession } from "@/stores/session";

// ── antd v6 + jsdom 的 `:has` 兼容补丁（先例 agent-profile-form.test.tsx）──
// antd v6 Form style 含 `:has(> .ant-switch:only-child, > .ant-rate:only-child)`
// 规则；jsdom cssom 在 getComputedStyle 时做 DOM 匹配，其 `:has` 模拟把候选元素
// 的 tag+className 拼进选择器——本卡表单布局含 `md:col-span-2` 等响应式类（未
// 引号转义的 `:`），生成非法选择器 → nwsapi 抛 SyntaxError。真实浏览器走原生
// CSS 引擎不受影响（jsdom 特有缺陷，与 setup.ts 的 matchMedia polyfill 同类环境
// 适配）。处理：stub window.getComputedStyle 返回空样式表，仅本测试文件生效。
const __realGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = ((_elt: Element, _pseudo?: string | null) =>
  new Proxy(
    {
      getPropertyValue: () => "",
      setProperty: () => undefined,
      item: () => "",
    },
    {
      get: (target, key) =>
        key in target ? (target as any)[key] : key === "length" ? 0 : "",
    },
  )) as unknown as typeof window.getComputedStyle;

/* ----- mock 网络层 ----- */

const daemon = vi.hoisted(() => ({
  fetchSharedAgents: vi.fn(),
  fetchSharedAgentsActive: vi.fn(),
  createSharedAgent: vi.fn(),
  disableSharedAgent: vi.fn(),
  listDaemonMachines: vi.fn(),
  listAgentSessions: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    fetchSharedAgents: daemon.fetchSharedAgents,
    fetchSharedAgentsActive: daemon.fetchSharedAgentsActive,
    createSharedAgent: daemon.createSharedAgent,
    disableSharedAgent: daemon.disableSharedAgent,
    listDaemonMachines: daemon.listDaemonMachines,
    listAgentSessions: daemon.listAgentSessions,
  };
});

const profiles = vi.hoisted(() => ({ platformProfiles: vi.fn() }));

vi.mock("@/lib/agent-profiles", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/agent-profiles")>("@/lib/agent-profiles");
  return {
    ...actual,
    // 注意：usePlatformAgentProfiles 内部调用同模块的 listPlatformAgentProfiles，
    // vitest 的 export mock 不拦截同模块闭包绑定——直接 mock hook 本身
    //（先例 agent-profile-form.test.tsx 的 useCreateAgentProfile mock）。platformProfiles
    // 返回值即档案数组（beforeEach 设 fixture）。
    usePlatformAgentProfiles: () => ({
      profiles: profiles.platformProfiles(),
      isLoading: false,
      isError: false,
      error: null,
    }),
  };
});

const workspaces = vi.hoisted(() => ({ listWorkspaces: vi.fn() }));

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>("@/lib/workspaces");
  return { ...actual, listWorkspaces: workspaces.listWorkspaces };
});

/* ----- fixtures ----- */

/** 管理员自己名下在线机器（runtime rt-1 claude 在线）。 */
const OWN_ONLINE_MACHINE = {
  id: "m-1",
  hostname: "DEV-PC",
  display_alias: null,
  os: "win",
  arch: "x64",
  status: "online",
  last_heartbeat_at: "2026-08-28T10:00:00Z",
  version: "1.8.2",
  build_id: "a1b2c3d",
  started_at: null,
  created_at: "2026-08-01T09:00:00Z",
  owner: { user_id: "u-admin", email: "admin@example.com", display_name: "管理员" },
  runtime_count: 1,
  online_runtime_count: 1,
  runtimes: [
    {
      id: "rt-1",
      name: "claude",
      provider: "claude",
      version: "2.0.0",
      os: "win",
      arch: "x64",
      status: "online",
      last_heartbeat_at: "2026-08-28T10:00:00Z",
      capabilities: null,
      allowed_roots: ["C:\\share"],
      created_at: "2026-08-01T09:00:00Z",
      updated_at: "2026-08-28T10:00:00Z",
    },
  ],
};

const ADMIN_USER = {
  id: "u-admin",
  email: "admin@example.com",
  displayName: "管理员",
  is_platform_admin: true,
};

beforeEach(() => {
  useSession.setState({
    accessToken: "tok",
    hydrated: true,
    user: ADMIN_USER,
  } as never);
  daemon.listDaemonMachines.mockResolvedValue({
    items: [OWN_ONLINE_MACHINE],
    total: 1,
    limit: 100,
    offset: 0,
    shared_to_me: [],
  });
  daemon.listAgentSessions.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  profiles.platformProfiles.mockReturnValue([
    { id: "p-1", name: "平台功能讲解助手", provider: "claude", visibility: "platform" },
    // 非 platform 档案应被下拉过滤（R-05：本表单只列 platform 可见）。
    { id: "p-2", name: "我的私人档案", provider: "claude", visibility: "private" },
  ]);
  workspaces.listWorkspaces.mockResolvedValue({
    items: [{ id: "ws-1", name: "multi-agent-platform", display_alias: null }],
    total: 1,
    limit: 100,
    offset: 0,
  });
  daemon.fetchSharedAgents.mockResolvedValue([
    {
      id: "g-1",
      agent_profile_id: "p-1",
      pinned_runtime_id: "rt-1",
      source_workspace_id: "ws-1",
      writable_dir: "C:\\share\\outputs",
      enabled: true,
    },
    {
      id: "g-2",
      agent_profile_id: "p-2",
      // 绑定 runtime 不在管理员在线 runtime 选项里（如已下线）→ 行内显示「—」。
      pinned_runtime_id: "rt-9",
      source_workspace_id: "ws-1",
      writable_dir: "C:\\share\\docs",
      enabled: false,
    },
  ]);
  daemon.fetchSharedAgentsActive.mockResolvedValue([
    {
      id: "g-1",
      agent_profile_id: "p-1",
      display_name: "平台功能讲解助手",
      provider: "claude",
      runtime_online: true,
    },
  ]);
  daemon.createSharedAgent.mockResolvedValue({
    id: "g-3",
    agent_profile_id: "p-1",
    pinned_runtime_id: "rt-1",
    source_workspace_id: "ws-1",
    writable_dir: "C:\\share\\outputs",
    enabled: true,
    visibility_promoted: false,
  });
  daemon.disableSharedAgent.mockResolvedValue({
    id: "g-1",
    agent_profile_id: "p-1",
    pinned_runtime_id: "rt-1",
    source_workspace_id: "ws-1",
    writable_dir: "C:\\share\\outputs",
    enabled: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <PlatformSharedAgentsCard />
      </AntApp>
    </QueryClientProvider>,
  );
}

/**
 * 触发 antd v6 Select 选某选项（惯例同 agent-profile-card-grid.test.tsx 的
 * chooseAntdOption）：mousedown 落在 .ant-select-content（v6 新结构；回退旧
 * .ant-select-selector），选项 portal 到 body 的 .ant-select-item-option，
 * 选中监听 mousedown + click 同时触发。
 */
async function selectOption(placeholder: string, optionText: string) {
  const selectWrapper = screen.getByText(placeholder).closest(".ant-select");
  if (!selectWrapper)
    throw new Error(`ant-select for placeholder "${placeholder}" not found`);
  const clickZone =
    selectWrapper.querySelector(".ant-select-content") ??
    selectWrapper.querySelector(".ant-select-selector") ??
    selectWrapper;
  fireEvent.mouseDown(clickZone as HTMLElement);
  const option = await screen.findByText(optionText, {
    selector: ".ant-select-item-option-content",
  });
  const optionRow = option.closest(".ant-select-item-option") as HTMLElement;
  fireEvent.mouseDown(optionRow);
  fireEvent.click(optionRow);
  // 给 React 合成事件 + state 提交一拍。
  await act(async () => {
    await Promise.resolve();
  });
}

describe("PlatformSharedAgentsCard（task-09 / FR-04）", () => {
  it("渲染创建表单四字段 + 新建共享按钮 + 生效列表行（状态 Badge + 停用）", async () => {
    renderCard();

    // 表单四字段 label（antd Form label 与控件 htmlFor 关联）
    expect(screen.getByText("智能体档案（platform 可见）")).toBeInTheDocument();
    expect(screen.getByText("守护进程（仅管理员自己名下在线）")).toBeInTheDocument();
    expect(screen.getByText("平台源码工作区（只读锚定）")).toBeInTheDocument();
    expect(screen.getByText(/共享输出目录 writable_dir/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新建共享/ })).toBeInTheDocument();

    // 生效列表行：active 摘要 join 出档案名；runtime/工作区 join；writable_dir。
    // 行内断言（工作区名与 Select 选项文本同名，按行锚定避免歧义）。
    await waitFor(() => {
      expect(screen.getByText("平台功能讲解助手")).toBeInTheDocument();
    });
    const g1Row = screen.getByText("可写 C:\\share\\outputs").closest("tr");
    expect(g1Row).not.toBeNull();
    expect(within(g1Row as HTMLElement).getByText("DEV-PC · Claude Code")).toBeInTheDocument();
    expect(within(g1Row as HTMLElement).getByText("multi-agent-platform")).toBeInTheDocument();
    // g-2 绑定 runtime 已不在线 → 显示「—」。
    const g2Row = screen.getByText("已停用").closest("tr");
    expect(within(g2Row as HTMLElement).getAllByText("—").length).toBeGreaterThan(0);
    // 状态 Badge：g-1 生效中（+ runtime 在线），g-2 已停用
    expect(screen.getByText("生效中 · 全体可用")).toBeInTheDocument();
    expect(screen.getByText("runtime 在线")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    // 停用按钮两行各一
    expect(screen.getAllByRole("button", { name: /停\s*用/ })).toHaveLength(2);
  });

  it("空表单提交 → 四条必填中文提示，createSharedAgent 不被调", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /新建共享/ }));

    // 四条提示经 findByText 逐条等（嵌套 noStyle 字段的校验回显有一拍延迟）。
    expect(await screen.findByText("请选择智能体档案")).toBeInTheDocument();
    expect(await screen.findByText("请选择自己名下在线的守护进程")).toBeInTheDocument();
    expect(await screen.findByText("请选择源码工作区")).toBeInTheDocument();
    expect(await screen.findByText("请填写共享输出目录")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /新建共享/ })).not.toBeDisabled();
    });
    expect(daemon.createSharedAgent).not.toHaveBeenCalled();
  });

  it("四字段填写提交 → createSharedAgent 收到正确 payload（promote_visibility=false）", async () => {
    renderCard();

    // 档案下拉：展开时仅 platform 可见档案（R-05：非 platform 不进下拉）。
    const profileWrapper = screen
      .getByText("选择 platform 可见的档案")
      .closest(".ant-select") as HTMLElement;
    fireEvent.mouseDown(
      (profileWrapper.querySelector(".ant-select-content") ??
        profileWrapper) as HTMLElement,
    );
    const profileOpt = await screen.findByText("平台功能讲解助手（claude）", {
      selector: ".ant-select-item-option-content",
    });
    // 下拉开着：私有档案（visibility=private）应被下拉过滤掉。
    expect(screen.queryByText("我的私人档案（claude）")).toBeNull();
    const profileRow = profileOpt.closest(".ant-select-item-option") as HTMLElement;
    fireEvent.mouseDown(profileRow);
    fireEvent.click(profileRow);
    await act(async () => {
      await Promise.resolve();
    });

    await selectOption("选择自己名下在线的守护进程 runtime", "DEV-PC · Claude Code");
    await selectOption("选择平台源码工作区", "multi-agent-platform");
    const dirInput = screen.getByLabelText("共享输出目录 writable_dir 路径输入");
    fireEvent.change(dirInput, { target: { value: "C:\\share\\outputs" } });

    fireEvent.click(screen.getByRole("button", { name: /新建共享/ }));

    await waitFor(() => {
      expect(daemon.createSharedAgent).toHaveBeenCalledWith({
        agent_profile_id: "p-1",
        pinned_runtime_id: "rt-1",
        source_workspace_id: "ws-1",
        writable_dir: "C:\\share\\outputs",
        promote_visibility: false,
      });
    });
  });

  it("生效行点「停用」→ disableSharedAgent(grantId)；已停用行按钮禁用", async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("生效中 · 全体可用")).toBeInTheDocument();
    });

    // g-2（已停用）行按钮禁用——行内「已停用」Badge 所在行定位。
    const disabledRow = screen.getByText("已停用").closest("tr");
    expect(disabledRow).not.toBeNull();
    const disabledBtn = within(disabledRow as HTMLElement).getByRole("button", {
      name: /停\s*用/,
    });
    expect(disabledBtn).toBeDisabled();

    // g-1（生效中）行停用按钮可点 → disableSharedAgent("g-1")
    const enabledRow = screen.getByText("生效中 · 全体可用").closest("tr");
    expect(enabledRow).not.toBeNull();
    const enabledBtn = within(enabledRow as HTMLElement).getByRole("button", {
      name: /停\s*用/,
    });
    expect(enabledBtn).not.toBeDisabled();
    fireEvent.click(enabledBtn);

    await waitFor(() => {
      expect(daemon.disableSharedAgent).toHaveBeenCalledWith("g-1");
    });
  });
});
