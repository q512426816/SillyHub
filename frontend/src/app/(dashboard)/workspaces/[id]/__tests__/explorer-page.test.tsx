/**
 * task-08：工作区文件浏览页页面级测试。
 *
 * 覆盖：
 * 1. 页面渲染 FileExplorer + FilePreview，并正确下传 workspaceId
 * 2. 选中文件 → FilePreview 收到 filePath 联动
 * 3. 三降级卡：502 / 404 / 422 分别渲染对应中文文案
 * 4. 其它错误走通用红条
 * 5. WorkspaceTabs 含「文件」标签且 href 指向 /explorer，位于会话与 Skills 之间
 *
 * 依据：tasks/task-08.md、task-06/07 组件契约。
 */

import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ExplorerPage from "@/app/(dashboard)/workspaces/[id]/explorer/page";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { ApiError } from "@/lib/api";

// ── next/navigation mock（页面从 useParams 取 workspaceId）───────────────────

const nav = vi.hoisted(() => ({ params: { id: "ws-1" } }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  usePathname: () => `/workspaces/${nav.params.id}/explorer`,
}));

// next/link 在 jsdom 下不需要真实路由，但须透传 aria-current 等 props
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ── mock FileExplorer / FilePreview：只验证页面级接线，不重复跑组件内部逻辑 ──

const fileExplorerMock = vi.hoisted(() => ({
  receivedWorkspaceId: "",
  receivedOnSelectFile: (_path: string) => {},
}));
vi.mock("@/components/explorer/file-explorer", () => ({
  FileExplorer: ({
    workspaceId,
    onSelectFile,
  }: {
    workspaceId: string;
    onSelectFile: (_path: string) => void;
  }) => {
    fileExplorerMock.receivedWorkspaceId = workspaceId;
    fileExplorerMock.receivedOnSelectFile = onSelectFile;
    return (
      <div data-testid="file-explorer">
        <button
          type="button"
          data-testid="select-file-btn"
          onClick={() => onSelectFile("backend/app/main.py")}
        >
          选择文件
        </button>
      </div>
    );
  },
}));

const filePreviewMock = vi.hoisted(() => ({
  receivedFilePath: null as string | null,
}));
vi.mock("@/components/explorer/file-preview", () => ({
  FilePreview: ({
    workspaceId,
    filePath,
  }: {
    workspaceId: string;
    filePath: string | null;
  }) => {
    filePreviewMock.receivedFilePath = filePath;
    return (
      <div data-testid="file-preview">
        {workspaceId}:{filePath ?? "未选择"}
      </div>
    );
  },
}));

// ── mock @/lib/explorer：控制 useExplorerTree / useExplorerFile 返回值 ───────

const explorerMock = vi.hoisted(() => ({
  useExplorerTree: vi.fn(),
  useExplorerFile: vi.fn(),
}));
vi.mock("@/lib/explorer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explorer")>("@/lib/explorer");
  return {
    ...actual,
    useExplorerTree: explorerMock.useExplorerTree,
    useExplorerFile: explorerMock.useExplorerFile,
  };
});

function makeQueryResult(
  overrides: Partial<ReturnType<typeof explorerMock.useExplorerTree>> = {},
) {
  return {
    data: null,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeApiError(status: number, message: string): ApiError {
  return new ApiError(status, {
    code: "explorer_error",
    message,
    request_id: null,
    details: null,
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExplorerPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.params = { id: "ws-1" };
  fileExplorerMock.receivedWorkspaceId = "";
  filePreviewMock.receivedFilePath = null;
  explorerMock.useExplorerTree.mockReturnValue(makeQueryResult());
  explorerMock.useExplorerFile.mockReturnValue(makeQueryResult());
  localStorage.removeItem("sillyhub-explorer-tree-width");
});

afterEach(() => {
  cleanup();
});

// ── 页面装配 ───────────────────────────────────────────────────────────────

describe("workspace explorer page（task-08）", () => {
  it("渲染 FileExplorer 与 FilePreview，并下传 workspaceId", () => {
    renderPage();

    expect(screen.getByTestId("file-explorer")).toBeInTheDocument();
    expect(screen.getByTestId("file-preview")).toBeInTheDocument();
    expect(fileExplorerMock.receivedWorkspaceId).toBe("ws-1");
  });

  it("选中文件后 FilePreview 收到 filePath 联动", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("select-file-btn"));

    await waitFor(() => {
      expect(filePreviewMock.receivedFilePath).toBe("backend/app/main.py");
    });
    expect(screen.getByTestId("file-preview")).toHaveTextContent(
      "ws-1:backend/app/main.py",
    );
  });

  it("面包屑默认显示「工作区根」", () => {
    renderPage();
    expect(screen.getByText("工作区根")).toBeInTheDocument();
  });

  it("刷新按钮存在", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
  });

  // ── 左栏宽度拖拽（ql-20260821-008-fade）──────────────────────────────────

  /** jsdom 无 PointerEvent 实现，fireEvent.pointer* 走 Event 兜底构造带不上坐标
   *  （React handler 里 e.clientX 为 undefined），须 createEvent 后手工补属性再派发。 */
  function firePointer(
    el: Element | Window,
    name: "pointerDown" | "pointerMove" | "pointerUp",
    init: { clientX?: number } = {},
  ) {
    const ev = createEvent[name](el as Element, init);
    for (const [k, v] of Object.entries(init)) {
      Object.defineProperty(ev, k, { value: v });
    }
    fireEvent(el, ev);
  }

  it("左栏默认 320px；拖动把手调宽并写入 localStorage 记忆", () => {
    renderPage();

    const panel = screen.getByTestId("explorer-tree-panel");
    expect(panel.style.width).toBe("320px");

    const resizer = screen.getByTestId("explorer-tree-resizer");
    firePointer(resizer, "pointerDown", { clientX: 320 });
    firePointer(window, "pointerMove", { clientX: 420 });
    firePointer(window, "pointerUp");

    expect(panel.style.width).toBe("420px");
    expect(localStorage.getItem("sillyhub-explorer-tree-width")).toBe("420");
  });

  it("拖拽钳制在 200~640px，双击把手复位 320px", () => {
    renderPage();

    const panel = screen.getByTestId("explorer-tree-panel");
    const resizer = screen.getByTestId("explorer-tree-resizer");

    firePointer(resizer, "pointerDown", { clientX: 320 });
    firePointer(window, "pointerMove", { clientX: 2000 });
    firePointer(window, "pointerUp");
    expect(panel.style.width).toBe("640px");

    fireEvent.dblClick(resizer);
    expect(panel.style.width).toBe("320px");
    expect(localStorage.getItem("sillyhub-explorer-tree-width")).toBe("320");
  });

  it("localStorage 有合法记忆宽度时按记忆值初始化", () => {
    localStorage.setItem("sillyhub-explorer-tree-width", "480");
    renderPage();
    expect(screen.getByTestId("explorer-tree-panel").style.width).toBe("480px");
  });

  // ── 三降级态 ───────────────────────────────────────────────────────────

  it("502 渲染守护进程离线卡", () => {
    explorerMock.useExplorerTree.mockReturnValue(
      makeQueryResult({
        isError: true,
        error: makeApiError(502, "守护进程离线"),
      }),
    );
    renderPage();

    expect(
      screen.getByText(
        "本机守护进程离线，无法浏览工作区文件。请启动 daemon 后刷新。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("404 渲染未绑定引导卡", () => {
    explorerMock.useExplorerTree.mockReturnValue(
      makeQueryResult({
        isError: true,
        error: makeApiError(404, "未绑定工作区"),
      }),
    );
    renderPage();

    expect(
      screen.getByText(
        "当前账号未绑定本机工作区，请先到「成员」页完成绑定。",
      ),
    ).toBeInTheDocument();
  });

  it("422 渲染 daemon 版本过旧卡", () => {
    explorerMock.useExplorerTree.mockReturnValue(
      makeQueryResult({
        isError: true,
        error: makeApiError(422, "daemon 版本过旧"),
      }),
    );
    renderPage();

    expect(
      screen.getByText(
        "本机 daemon 版本过旧，不支持文件浏览，请升级 daemon。",
      ),
    ).toBeInTheDocument();
  });

  it("其它错误走通用红条", () => {
    explorerMock.useExplorerTree.mockReturnValue(
      makeQueryResult({
        isError: true,
        error: makeApiError(504, "请求超时"),
      }),
    );
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("请求超时");
  });

  it("多错误时按 502 > 422 > 404 优先级只显示一张卡", () => {
    explorerMock.useExplorerTree.mockReturnValue(
      makeQueryResult({
        isError: true,
        error: makeApiError(404, "未绑定"),
      }),
    );
    explorerMock.useExplorerFile.mockReturnValue(
      makeQueryResult({
        isError: true,
        error: makeApiError(502, "守护进程离线"),
      }),
    );
    renderPage();

    expect(
      screen.getByText(
        "本机守护进程离线，无法浏览工作区文件。请启动 daemon 后刷新。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("未绑定")).not.toBeInTheDocument();
  });
});

// ── WorkspaceTabs 标签 ─────────────────────────────────────────────────────

describe("WorkspaceTabs「文件」标签（task-08）", () => {
  it("标签列表包含「文件」且 href 为 /explorer，位于会话与 Skills 之间", () => {
    render(
      <WorkspaceTabs workspaceId="ws-1">
        <div />
      </WorkspaceTabs>,
    );

    const links = screen.getAllByRole("link");
    const labels = links.map((a) => a.textContent);

    const sessionsIdx = labels.indexOf("会话");
    const fileIdx = labels.indexOf("文件");
    const skillsIdx = labels.indexOf("Skills");

    expect(fileIdx).toBeGreaterThan(sessionsIdx);
    expect(fileIdx).toBeLessThan(skillsIdx);

    expect(links[fileIdx]).toHaveAttribute("href", "/workspaces/ws-1/explorer");
  });

  it("当前在 /explorer 时「文件」标签高亮", () => {
    render(
      <WorkspaceTabs workspaceId="ws-1">
        <div />
      </WorkspaceTabs>,
    );

    const fileLink = screen.getByRole("link", { name: "文件" });
    expect(fileLink).toHaveAttribute("aria-current", "page");
  });
});
