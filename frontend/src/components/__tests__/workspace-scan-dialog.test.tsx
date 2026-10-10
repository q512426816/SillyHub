/**
 * WorkspaceScanDialog slug 字段测试（ql-20260826-007-8666）。
 *
 * 契约：
 *  - slug 输入框默认从工作区名称实时派生（与后端 schema.slugify 同规则：
 *    非字母数字折叠连字符、去首尾、小写；「My Project!!」→「my-project」）
 *  - 手动编辑后脱离跟随——再改名称 slug 保持手输值
 *  - 提交体带最终 slug；名称与 slug 均空时提交体省略 slug（后端派生兜底）
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceScanDialog } from "@/components/workspace-scan-dialog";

const daemonApi = vi.hoisted(() => ({ listDaemonInstances: vi.fn() }));
const workspacesApi = vi.hoisted(() => ({ createWorkspace: vi.fn() }));
// 2026-10-09-workspace-init-skill-gate task-04 / FR-04：创建后自动初始化链路的两个依赖。
const specWorkspacesApi = vi.hoisted(() => ({ initDispatch: vi.fn() }));
const bindingApi = vi.hoisted(() => ({ fetchMyBinding: vi.fn() }));
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>(
    "@/lib/daemon",
  );
  return { ...actual, listDaemonInstances: daemonApi.listDaemonInstances };
});

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, createWorkspace: workspacesApi.createWorkspace };
});

vi.mock("@/lib/spec-workspaces", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/spec-workspaces")>(
      "@/lib/spec-workspaces",
    );
  return { ...actual, initDispatch: specWorkspacesApi.initDispatch };
});

vi.mock("@/lib/workspace-binding", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspace-binding")>(
      "@/lib/workspace-binding",
    );
  return { ...actual, fetchMyBinding: bindingApi.fetchMyBinding };
});

// useNotify 依赖 antd App 上下文，这里直接换纯函数实现。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  return { ...actual, useNotify: () => notify };
});

// 路径选择器是远程目录选择控件，与本测试关注的 slug 行为无关，mock 成纯输入框。
vi.mock("@/components/workspace-path-picker", () => ({
  WorkspacePathPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      aria-label="工作区路径"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function makeCreatedWorkspace() {
  return {
    id: "ws-1",
    name: "n",
    slug: "s",
    root_path: "/r",
    status: "active",
    creation_notice: null,
  };
}

async function renderDialogAndFillBase() {
  render(<WorkspaceScanDialog onCreated={vi.fn()} onCancel={vi.fn()} />);
  // 守护进程下拉（唯一常驻 combobox）等实例加载出选项后选中 d1，
  // 再填路径 → 名称/slug/类型字段出现
  const daemonSelect = screen.getByRole("combobox");
  await waitFor(() =>
    expect((daemonSelect as HTMLSelectElement).options.length).toBeGreaterThan(
      1,
    ),
  );
  fireEvent.change(daemonSelect, { target: { value: "d1" } });
  fireEvent.change(screen.getByLabelText("工作区路径"), {
    target: { value: "C:\\repo\\demo" },
  });
}

describe("WorkspaceScanDialog slug 字段", () => {
  beforeEach(() => {
    daemonApi.listDaemonInstances.mockResolvedValue([
      {
        id: "d1",
        hostname: "host-a",
        display_alias: null,
        status: "online",
        providers: [{ provider: "claude_code" }],
      },
    ]);
    workspacesApi.createWorkspace.mockResolvedValue(makeCreatedWorkspace());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("slug 默认从名称实时派生（同后端 slugify 规则）", async () => {
    await renderDialogAndFillBase();
    const slugInput = screen.getByLabelText("slug（创建后不可修改）", {
      selector: "input",
    });
    // 名称未填 → slug 为空（不预填 "workspace" 兜底）
    expect(slugInput).toHaveValue("");

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project!!" },
    });
    expect(slugInput).toHaveValue("my-project");

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "订单模块" },
    });
    // 纯中文名称无 ASCII 字母数字 → 兜底 "workspace"（与后端一致）；
    // 混入 ASCII 的「订单 模块 v2」则派生为 "v2"
    expect(slugInput).toHaveValue("workspace");
  });

  it("手动编辑后脱离跟随：再改名称 slug 保持手输值", async () => {
    await renderDialogAndFillBase();
    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project" },
    });
    const slugInput = screen.getByLabelText("slug（创建后不可修改）", {
      selector: "input",
    });
    fireEvent.change(slugInput, { target: { value: "custom-slug" } });

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "Another Name" },
    });
    expect(slugInput).toHaveValue("custom-slug");
  });

  it("名称与 slug 均空时提交体省略 slug 字段（后端派生兜底）", async () => {
    await renderDialogAndFillBase();
    const typeSelect = screen.getByLabelText("工作区类型");
    fireEvent.change(typeSelect, { target: { value: "other" } });

    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.not.objectContaining({ slug: expect.anything() }),
    );
  });

  it("填名称后提交体带派生 slug；手输值优先", async () => {
    await renderDialogAndFillBase();
    const typeSelect = screen.getByLabelText("工作区类型");
    fireEvent.change(typeSelect, { target: { value: "other" } });

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "my-project" }),
    );
  });

  it("手动改过的 slug 原样进提交体", async () => {
    await renderDialogAndFillBase();
    const typeSelect = screen.getByLabelText("工作区类型");
    fireEvent.change(typeSelect, { target: { value: "other" } });

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project" },
    });
    fireEvent.change(
      screen.getByLabelText("slug（创建后不可修改）"),
      { target: { value: "custom-slug" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "custom-slug" }),
    );
  });
});

describe("WorkspaceScanDialog 创建即初始化（2026-10-09-workspace-init-skill-gate task-04 / FR-04 / D-003@v1）", () => {
  beforeEach(() => {
    // shouldAdvanceTime：保留 waitFor 的时间推进（fake timers 会冻结其内部轮询），
    // 同时 advanceTimersByTimeAsync 仍可控 setInterval/setTimeout。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    daemonApi.listDaemonInstances.mockResolvedValue([
      {
        id: "d1",
        hostname: "host-a",
        display_alias: null,
        status: "online",
        providers: [{ provider: "claude_code" }],
      },
    ]);
    workspacesApi.createWorkspace.mockResolvedValue(makeCreatedWorkspace());
    specWorkspacesApi.initDispatch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function submitCreate() {
    render(<WorkspaceScanDialog onCreated={vi.fn()} onCancel={vi.fn()} />);
    const daemonSelect = screen.getByRole("combobox");
    await waitFor(() =>
      expect((daemonSelect as HTMLSelectElement).options.length).toBeGreaterThan(
        1,
      ),
    );
    fireEvent.change(daemonSelect, { target: { value: "d1" } });
    fireEvent.change(screen.getByLabelText("工作区路径"), {
      target: { value: "C:\repo\demo" },
    });
    fireEvent.change(screen.getByLabelText("工作区类型"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
  }

  it("全链路成功：创建 → initDispatch → 轮询到 init_synced_at 非空 → done 态 + 打开按钮调 onCreated", async () => {
    bindingApi.fetchMyBinding.mockResolvedValue({
      init_synced_at: "2026-10-09T02:00:00Z",
      init_synced_spec_version: 3,
    });
    await submitCreate();

    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(specWorkspacesApi.initDispatch).toHaveBeenCalledWith("ws-1"),
    );
    // 初始化中态：两步进度可见 + 取消禁用
    expect(screen.getByText("初始化工作区")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();

    // 第一个 2s tick 轮询到非空 → done
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await screen.findByText("初始化完成，工作区可以使用了。")).toBeInTheDocument();
  });

  it("initDispatch 拒绝 → init_failed 态：文案明示已创建成功 + 双出口可达 onCreated（不回滚）", async () => {
    specWorkspacesApi.initDispatch.mockRejectedValue(new Error("daemon 离线"));
    const onCreated = vi.fn();
    render(<WorkspaceScanDialog onCreated={onCreated} onCancel={vi.fn()} />);
    const daemonSelect = screen.getByRole("combobox");
    await waitFor(() =>
      expect((daemonSelect as HTMLSelectElement).options.length).toBeGreaterThan(
        1,
      ),
    );
    fireEvent.change(daemonSelect, { target: { value: "d1" } });
    fireEvent.change(screen.getByLabelText("工作区路径"), {
      target: { value: "C:\repo\demo" },
    });
    fireEvent.change(screen.getByLabelText("工作区类型"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));

    expect(await screen.findByText("工作区已创建成功，但初始化失败")).toBeInTheDocument();
    expect(
      screen.getByText(/可稍后在.*详情页.*重新初始化/),
    ).toBeInTheDocument();
    // 失败不回滚：两个出口均可达 onCreated
    fireEvent.click(screen.getByRole("button", { name: "稍后手动初始化" }));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("轮询超时（5min 无 init_synced_at）→ init_failed 态", async () => {
    bindingApi.fetchMyBinding.mockResolvedValue({ init_synced_at: null });
    await submitCreate();

    await waitFor(() =>
      expect(specWorkspacesApi.initDispatch).toHaveBeenCalled(),
    );
    // 推进 5 分钟（含多个 2s tick，fetchMyBinding 恒 null）
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(await screen.findByText("工作区已创建成功，但初始化失败")).toBeInTheDocument();
  });

  it("卸载清理：initializing 态 unmount 后轮询不再发起（行为级，无孤儿请求）", async () => {
    bindingApi.fetchMyBinding.mockResolvedValue({ init_synced_at: null });
    await submitCreate();

    await waitFor(() =>
      expect(specWorkspacesApi.initDispatch).toHaveBeenCalled(),
    );
    // 轮询在飞：推进几个 tick 确认 fetchMyBinding 持续被调
    await vi.advanceTimersByTimeAsync(2_000);
    const callsAtUnmount = bindingApi.fetchMyBinding.mock.calls.length;
    expect(callsAtUnmount).toBeGreaterThan(0);

    cleanup(); // unmount → useEffect 清理 stopInitPolling（interval + deadline）
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bindingApi.fetchMyBinding.mock.calls.length).toBe(callsAtUnmount);
  });

  // 2026-10-10-ws-init-dialog-close-guard：initializing 态三条默认关闭通道
  // （ESC / 遮罩 / 右上角 X）必须全禁——注释声明的「初始化期间禁用取消」
  // 不能只堵 footer 按钮。
  it("initializing 态按 ESC / 点遮罩 → onCancel 不被调（Modal keyboard/maskClosable 禁用）", async () => {
    bindingApi.fetchMyBinding.mockResolvedValue({ init_synced_at: null });
    const onCancel = vi.fn();
    render(<WorkspaceScanDialog onCreated={vi.fn()} onCancel={onCancel} />);
    const daemonSelect = screen.getByRole("combobox");
    await waitFor(() =>
      expect((daemonSelect as HTMLSelectElement).options.length).toBeGreaterThan(1),
    );
    fireEvent.change(daemonSelect, { target: { value: "d1" } });
    fireEvent.change(screen.getByLabelText("工作区路径"), {
      target: { value: "C:\repo\demo" },
    });
    fireEvent.change(screen.getByLabelText("工作区类型"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    expect(await screen.findByText("初始化工作区")).toBeInTheDocument();

    // ESC：antd Modal keyboard 通道
    fireEvent.keyDown(document, { key: "Escape", keyCode: 27 });
    // 遮罩点击：antd Modal maskClosable 通道（点击 wrap 区域）
    const wrap = document.querySelector(".ant-modal-wrap");
    expect(wrap).not.toBeNull();
    fireEvent.click(wrap!);
    await vi.advanceTimersByTimeAsync(100);
    expect(onCancel).not.toHaveBeenCalled();
    // 弹窗仍在（进度反馈未丢）
    expect(screen.getByText("初始化工作区")).toBeInTheDocument();
  });

  it("initializing 态右上角 X 不渲染（closable 禁用）；idle 态三条通道保持默认可用", async () => {
    // idle 态：closable 默认 → X 按钮在
    const { unmount } = render(
      <WorkspaceScanDialog onCreated={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(
      document.querySelector(".ant-modal-close"),
    ).not.toBeNull();
    unmount();

    // initializing 态：closable=false → X 按钮不在 DOM
    bindingApi.fetchMyBinding.mockResolvedValue({ init_synced_at: null });
    render(<WorkspaceScanDialog onCreated={vi.fn()} onCancel={vi.fn()} />);
    const daemonSelect = screen.getByRole("combobox");
    await waitFor(() =>
      expect((daemonSelect as HTMLSelectElement).options.length).toBeGreaterThan(1),
    );
    fireEvent.change(daemonSelect, { target: { value: "d1" } });
    fireEvent.change(screen.getByLabelText("工作区路径"), {
      target: { value: "C:\repo\demo" },
    });
    fireEvent.change(screen.getByLabelText("工作区类型"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    expect(await screen.findByText("初始化工作区")).toBeInTheDocument();
    expect(document.querySelector(".ant-modal-close")).toBeNull();
  });

  // 超时钟与轮询可见性暂停对齐：后台标签页（document.hidden）期间 5min 到期
  // 不判 init_failed；回前台后重挂满窗再计。
  it("后台标签页 5min 超时不假失败；回前台再计满 5min 才 init_failed", async () => {
    const hiddenMock = { value: false };
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hiddenMock.value,
    });
    try {
      bindingApi.fetchMyBinding.mockResolvedValue({ init_synced_at: null });
      await submitCreate();
      await waitFor(() =>
        expect(specWorkspacesApi.initDispatch).toHaveBeenCalled(),
      );

      // 切后台：轮询暂停 + 超时钟顺延 → 推 5min+ 不出失败态
      hiddenMock.value = true;
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 10_000);
      expect(
        screen.queryByText("工作区已创建成功，但初始化失败"),
      ).toBeNull();
      expect(screen.getByText("初始化工作区")).toBeInTheDocument();

      // 回前台：重挂满窗再计 → 4min 检查点不出失败态（区分「≤2s 即死」旧形态）
      hiddenMock.value = false;
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(
        screen.queryByText("工作区已创建成功，但初始化失败"),
      ).toBeNull();
      // 满窗计满 → init_failed
      await vi.advanceTimersByTimeAsync(60 * 1000 + 10_000);
      expect(
        await screen.findByText("工作区已创建成功，但初始化失败"),
      ).toBeInTheDocument();
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });
});

describe("WorkspaceScanDialog spec 策略默认 repo-native + 收起/展开（2026-10-09-ws-create-spec-default-collapse）", () => {
  beforeEach(() => {
    daemonApi.listDaemonInstances.mockResolvedValue([
      {
        id: "d1",
        hostname: "host-a",
        display_alias: null,
        status: "online",
        providers: [{ provider: "claude_code" }],
      },
    ]);
    workspacesApi.createWorkspace.mockResolvedValue(makeCreatedWorkspace());
    specWorkspacesApi.initDispatch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("spec 策略默认 repo-native：默认收起仅摘要行 + 直接创建提交体带 repo-native", async () => {
    await renderDialogAndFillBase();

    // 默认收起：摘要行可见且指向 repo-native（FR-01）
    expect(screen.getByText("spec 同步策略：源项目即真理")).toBeInTheDocument();
    // 前两个选项不出现在 DOM（FR-03，条件渲染非 CSS 隐藏）
    expect(screen.queryByRole("radio", { name: /平台托管/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /单次导入/ })).toBeNull();
    // 默认 repo-native 的 ⚠ 警示在收起态也可见（FR-05）
    expect(screen.getByText(/⚠ 扫描产出会写入源项目/)).toBeInTheDocument();

    // 直接创建（未展开未改选）→ 提交体带 spec_strategy=repo-native（FR-01/06）
    fireEvent.change(screen.getByLabelText("工作区类型"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ spec_strategy: "repo-native" }),
    );
  });

  it("更多选项展开三选项可切换再收起不动选中值", async () => {
    await renderDialogAndFillBase();

    // 展开（FR-02）
    fireEvent.click(screen.getByRole("button", { name: "更多选项" }));
    // 三选项全部可见；平台托管文案已无「默认」字样（FR-04）
    const platformRadio = screen.getByRole("radio", {
      name: "平台托管（不碰源项目，从零扫描）",
    });
    expect(platformRadio).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /单次导入/ })).toBeInTheDocument();
    const nativeRadio = screen.getByRole("radio", {
      name: "源项目即真理（软链接，扫描直接写源项目）",
    });
    expect(nativeRadio).toBeInTheDocument();
    expect(nativeRadio).toBeChecked();

    // 切换到平台托管 → ⚠ 警示隐藏（FR-05 反向）
    fireEvent.click(platformRadio);
    expect(screen.queryByText(/⚠ 扫描产出会写入源项目/)).toBeNull();

    // 收起 → 摘要跟随新选中值，选中值不被重置（FR-02）
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.getByText("spec 同步策略：平台托管")).toBeInTheDocument();

    // 切换后提交体随选中值（FR-06）
    fireEvent.change(screen.getByLabelText("工作区类型"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ spec_strategy: "platform-managed" }),
    );
  });
});
