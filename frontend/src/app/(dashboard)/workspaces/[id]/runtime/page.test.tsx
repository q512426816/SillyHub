/**
 * task-14 / 变更 2026-08-19-runtime-live-daemon-read：运行时状态页单测。
 *
 * 依据:
 *   - frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx
 *   - 变更 design §6.3 错误映射表 + FR-05：文案从「本地运行态 / 不作为长期
 *     事实源」更新为「守护进程运行态 / 实时工作流状态」
 *
 * 覆盖:
 *   1. 标题/副标题新文案（不再出现「本地运行态」「不作为长期事实源」）
 *   2. 正常数据渲染：进度摘要卡 + 阶段表 + 用户输入 + 产物列表
 *   3. 错误分级提示：502/504/422 各渲染对应行动指引（design §6.3 消费端）
 *   4. 无 binding → DaemonRequiredNotice（不 fetch runtime）
 *   5. 三接口全空 → 空态文案
 *
 * mock：@/lib/runtime（hoisted vi.fn）+ @/lib/workspace-binding（fetchMyBinding
 * 返回 daemon_id 非空）+ @/stores/session（is_platform_admin=false），风格对齐
 * mcp-tokens/__tests__/page.test.tsx。
 *
 * 2026-08-20-runtime-readpoint-repo-first / task-03 追加（FR-05 / design §5.3）：
 *   6. user-inputs 超 50000 字符 → 仅渲染末段 + 截断提示（含完整文件路径）
 *   7. user-inputs 短字符串 → 无提示行（现状回归）
 *   8. 副标题新文案「优先本机仓库，回退同步缓存」（旧句不再出现）
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RuntimePage from "@/app/(dashboard)/workspaces/[id]/runtime/page";
import { ApiError } from "@/lib/api";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const runtimeApi = vi.hoisted(() => ({
  getRuntimeProgress: vi.fn(),
  getRuntimeUserInputsRaw: vi.fn(),
  getRuntimeArtifacts: vi.fn(),
  getRuntimeArtifactContent: vi.fn(),
}));
vi.mock("@/lib/runtime", () => ({
  getRuntimeProgress: runtimeApi.getRuntimeProgress,
  getRuntimeUserInputsRaw: runtimeApi.getRuntimeUserInputsRaw,
  getRuntimeArtifacts: runtimeApi.getRuntimeArtifacts,
  getRuntimeArtifactContent: runtimeApi.getRuntimeArtifactContent,
}));

const bindingApi = vi.hoisted(() => ({ fetchMyBinding: vi.fn() }));
vi.mock("@/lib/workspace-binding", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspace-binding")>(
      "@/lib/workspace-binding",
    );
  return { ...actual, fetchMyBinding: bindingApi.fetchMyBinding };
});

vi.mock("@/stores/session", () => ({
  useSession: (
    selector: (_s: { user?: { is_platform_admin?: boolean } }) => unknown,
  ) => selector({ user: { is_platform_admin: false } }),
}));

const BOUND_BINDING = {
  workspace_id: "ws-1",
  daemon_id: "d-1",
  root_path: "C:\\repo",
  path_source: "daemon-client",
  user_display_name: null,
  user_email: null,
  updated_at: null,
};

const PROGRESS = {
  version: 5,
  project: "multi-agent-platform",
  current_stage: "execute",
  current_change: "2026-08-19-demo",
  stages: {
    scan: { status: "completed", steps: [], started_at: null, completed_at: null },
    execute: {
      status: "in_progress",
      steps: [{ name: "Wave 1", status: "completed" }],
      started_at: "2026-08-19T10:00:00Z",
      completed_at: null,
    },
  },
  last_active: "2026-08-19T10:05:00Z",
};

function mockAllOk() {
  runtimeApi.getRuntimeProgress.mockResolvedValue(PROGRESS);
  runtimeApi.getRuntimeUserInputsRaw.mockResolvedValue("# 输入\n第一条\n");
  runtimeApi.getRuntimeArtifacts.mockResolvedValue([
    { filename: "design.md", size_bytes: 2048, last_modified: "2026-08-19T09:00:00Z" },
  ]);
}

function renderPage() {
  return render(<RuntimePage params={{ id: "ws-1" }} />);
}

beforeEach(() => {
  runtimeApi.getRuntimeProgress.mockReset();
  runtimeApi.getRuntimeUserInputsRaw.mockReset();
  runtimeApi.getRuntimeArtifacts.mockReset();
  runtimeApi.getRuntimeArtifactContent.mockReset();
  bindingApi.fetchMyBinding.mockReset().mockResolvedValue(BOUND_BINDING);
});

afterEach(() => {
  cleanup();
});

describe("运行时状态页 · 文案（FR-05）", () => {
  it("标题徽标与副标题反映守护进程实时数据源", async () => {
    mockAllOk();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("守护进程运行态")).toBeInTheDocument();
    });
    expect(screen.getByText("运行时状态")).toBeInTheDocument();
    // 旧文案不再出现（acceptance：页面不再显示「本地运行态 / 不作为长期事实源」）。
    expect(screen.queryByText("本地运行态")).not.toBeInTheDocument();
    expect(screen.queryByText(/不作为长期事实源/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/经绑定守护进程实时读取/),
    ).toBeInTheDocument();
    // 2026-08-20-runtime-readpoint-repo-first / FR-05：读点改为优先本机仓库、
    // 回退同步缓存，副标题同步新文案（design §5.3），旧句不再出现。
    expect(
      screen.getByText(/优先本机仓库，回退同步缓存/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/展示当前工作流状态/),
    ).not.toBeInTheDocument();
  });
});

describe("运行时状态页 · 正常数据渲染", () => {
  it("进度摘要卡 + 阶段表 + 用户输入 + 产物列表", async () => {
    mockAllOk();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("multi-agent-platform")).toBeInTheDocument();
    });
    // 「execute」出现在摘要卡（当前阶段值）与阶段表行名，至少两处。
    expect(screen.getAllByText("execute").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2026-08-19-demo")).toBeInTheDocument();
    expect(screen.getByText("流水线阶段")).toBeInTheDocument();
    expect(screen.getByText("scan")).toBeInTheDocument();
    expect(screen.getByText("用户输入记录")).toBeInTheDocument();
    expect(screen.getByText(/第一条/)).toBeInTheDocument();
    expect(screen.getByText(/design\.md/)).toBeInTheDocument();
  });

  it("点产物行展开读取内容；再点收起", async () => {
    mockAllOk();
    runtimeApi.getRuntimeArtifactContent.mockResolvedValue("# 产物内容");
    renderPage();

    const row = await screen.findByText(/design\.md/);
    fireEvent.click(row);
    await waitFor(() => {
      expect(runtimeApi.getRuntimeArtifactContent).toHaveBeenCalledWith(
        "ws-1",
        "design.md",
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/# 产物内容/)).toBeInTheDocument();
    });

    fireEvent.click(row);
    await waitFor(() => {
      expect(screen.queryByText(/# 产物内容/)).not.toBeInTheDocument();
    });
  });

  it("产物读取失败（422）→ 红条 + 版本过旧指引，不渲染空块", async () => {
    mockAllOk();
    runtimeApi.getRuntimeArtifactContent.mockRejectedValue(
      new ApiError(422, {
        code: "HTTP_422_RUNTIME_DAEMON_TOO_OLD",
        message: "本机 daemon 版本过旧",
        request_id: null,
        details: null,
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByText(/design\.md/));
    await waitFor(() => {
      expect(screen.getByText("本机 daemon 版本过旧")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/本机守护进程版本过旧，请升级守护进程后重试/),
    ).toBeInTheDocument();
  });

  it("三接口全空 → 空态文案", async () => {
    runtimeApi.getRuntimeProgress.mockResolvedValue(null);
    runtimeApi.getRuntimeUserInputsRaw.mockResolvedValue("");
    runtimeApi.getRuntimeArtifacts.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(/当前工作区没有运行时数据/),
      ).toBeInTheDocument();
    });
  });
});

describe("运行时状态页 · user-inputs 截断（FR-05 / design §5.3）", () => {
  it("超过 50000 字符 → 仅渲染末段 + 截断提示（含完整文件路径）", async () => {
    // 头部 11 字符 + 50000 个 x + 尾部 9 字符 = 50020 > 50000，
    // slice(-50000) 应丢弃整个头部标记、保留尾部标记。
    const longInput = `HEAD_DROPPED${"x".repeat(50000)}TAIL_KEPT`;
    runtimeApi.getRuntimeProgress.mockResolvedValue(null);
    runtimeApi.getRuntimeUserInputsRaw.mockResolvedValue(longInput);
    runtimeApi.getRuntimeArtifacts.mockResolvedValue([]);
    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText("用户输入记录")).toBeInTheDocument();
    });
    // 提示行出现，文案含完整文件路径。
    expect(
      screen.getByText(/内容过长，已截断，仅显示末尾 50000 字符/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(".sillyspec/.runtime/user-inputs.md"),
    ).toBeInTheDocument();
    // 头部标记被截掉（文档中不再出现），尾部标记保留。
    expect(screen.queryByText(/HEAD_DROPPED/)).not.toBeInTheDocument();
    expect(screen.getByText(/TAIL_KEPT/)).toBeInTheDocument();
    // <pre> 只渲染末尾 50000 字符。
    const pre = container.querySelector("pre");
    expect(pre?.textContent?.length).toBe(50000);
  });

  it("短字符串 → 不出现截断提示（现状回归）", async () => {
    mockAllOk();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/第一条/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/内容过长，已截断/)).not.toBeInTheDocument();
  });
});

describe("运行时状态页 · 错误分级提示（design §6.3 消费端）", () => {
  it.each([
    [
      502,
      "HTTP_502_RUNTIME_DAEMON_OFFLINE",
      "守护进程当前离线",
      /守护进程可能离线或连接中断，请确认本机守护进程在线后重试/,
    ],
    [
      504,
      "HTTP_504_RUNTIME_RPC_TIMEOUT",
      "读取运行时状态超时",
      /实时读取超时，请稍后重试/,
    ],
    [
      422,
      "HTTP_422_RUNTIME_DAEMON_TOO_OLD",
      "daemon 版本过旧",
      /本机守护进程版本过旧，请升级守护进程后重试/,
    ],
  ])(
    "状态码 %i → 红条 backend 消息 + 行动指引",
    async (status, code, message, hint) => {
      runtimeApi.getRuntimeProgress.mockRejectedValue(
        new ApiError(status, { code, message, request_id: null, details: null }),
      );
      runtimeApi.getRuntimeUserInputsRaw.mockResolvedValue("");
      runtimeApi.getRuntimeArtifacts.mockResolvedValue([]);
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(message)).toBeInTheDocument();
      });
      expect(screen.getByText(hint)).toBeInTheDocument();
    },
  );

  it("非 ApiError（网络中断）→ 通用文案，无状态码指引", async () => {
    runtimeApi.getRuntimeProgress.mockRejectedValue(new Error("network down"));
    runtimeApi.getRuntimeUserInputsRaw.mockResolvedValue("");
    runtimeApi.getRuntimeArtifacts.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("加载运行时状态失败")).toBeInTheDocument();
    });
  });
});

describe("运行时状态页 · 无 binding", () => {
  it("daemon_id 为空 → DaemonRequiredNotice，不 fetch runtime", async () => {
    bindingApi.fetchMyBinding.mockResolvedValue({
      ...BOUND_BINDING,
      daemon_id: null,
    });
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(/绑定.*守护进程|需要守护进程/),
      ).toBeInTheDocument();
    });
    expect(runtimeApi.getRuntimeProgress).not.toHaveBeenCalled();
  });
});
