import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// 只 mock 取数 API；change-file-sync 提示文案纯函数保持真实实现（本文件断言
// 展示结果 = 组件接线 + 真实文案映射的合成行为，2026-10-16-change-files-sync-result）。
vi.mock("@/lib/change-files", () => ({
  buildChangeFileTree: (items: { path: string; name: string; is_text: boolean }[]) =>
    items.map((i) => ({ name: i.name, path: i.path, children: [], doc: i })),
  listChangeFiles: vi.fn(),
  getChangeFileContent: vi.fn(),
  saveChangeFileContent: vi.fn(),
  listPendingChangeFiles: vi.fn(),
  fetchChangeFileRaw: vi.fn(),
  changeFileCnName: () => null,
}));

// FilePreviewModal 浅 stub：本文件只验提示条接线，防真实弹窗树拖累 jsdom。
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: () => null,
}));

// 变更名自动链接引入 useQuery（见 change-file-tree.test.tsx 同款说明），名单查询空表即可。
vi.mock("@/lib/changes", () => ({
  listChanges: vi.fn().mockResolvedValue({ items: [] }),
}));

import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ChangeFileTree } from "@/components/change-file-tree";
import { listChangeFiles, listPendingChangeFiles } from "@/lib/change-files";
import type { ChangeFileSyncResult } from "@/lib/change-file-sync";

const mockedList = vi.mocked(listChangeFiles);
const mockedPending = vi.mocked(listPendingChangeFiles);

const BASE_ITEMS = [
  { path: "proposal.md", name: "proposal.md", size: 10, last_modified_at: null, is_text: true },
];

function fileResp(syncResult?: ChangeFileSyncResult | null) {
  return {
    change_id: "c1",
    items: BASE_ITEMS,
    sync_result: syncResult ?? null,
  };
}

/** 初始纯读返回无回执；显式刷新（sync=true）返回给定回执——区分调用形态。 */
function mockListWithSync(syncResult: ChangeFileSyncResult) {
  mockedList.mockImplementation((_ws, _chg, options) =>
    Promise.resolve(options?.sync ? fileResp(syncResult) : fileResp()),
  );
}

function renderTree(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

async function renderAndSettle() {
  renderTree(<ChangeFileTree workspaceId="ws" changeId="c1" />);
  await waitFor(() => expect(screen.getByText("proposal.md")).toBeInTheDocument());
}

function clickRefresh() {
  fireEvent.click(screen.getByText("刷新"));
}

beforeAll(() => {
  // jsdom 未实现 blob URL（对齐既有测试 beforeAll 模式）
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChangeFileTree 刷新同步回执提示（2026-10-16-change-files-sync-result）", () => {
  it("纯读初始加载：不带 sync 也无提示条", async () => {
    mockedList.mockResolvedValue(fileResp());
    mockedPending.mockResolvedValue({ items: [] });

    await renderAndSettle();

    expect(mockedList.mock.calls[0]?.[2]).toEqual({ sync: undefined });
    expect(screen.queryByTestId("change-files-sync-warning")).not.toBeInTheDocument();
  });

  it("刷新成功（ok=true）：文件树更新且不出现提示条", async () => {
    mockedPending.mockResolvedValue({ items: [] });
    mockListWithSync({ triggered: true, ok: true, reason: null, stderr_tail: null });

    await renderAndSettle();
    clickRefresh();

    await waitFor(() => expect(mockedList.mock.calls.length).toBeGreaterThan(1));
    expect(mockedList.mock.calls.at(-1)?.[2]).toEqual({ sync: true });
    await waitFor(() => expect(screen.queryByTestId("change-files-sync-warning")).not.toBeInTheDocument());
  });

  it("刷新 CLI 失败（cli_failed + stderr 尾段）：提示条带中文原因与尾段，文件树照常展示", async () => {
    mockedPending.mockResolvedValue({ items: [] });
    mockListWithSync({
      triggered: true,
      ok: false,
      reason: "cli_failed",
      stderr_tail: "exit 1 sync 请求失败 HTTP 500（服务器内部错误）",
    });

    await renderAndSettle();
    clickRefresh();

    const warning = await screen.findByTestId("change-files-sync-warning");
    expect(warning).toHaveTextContent("同步未完成");
    expect(warning).toHaveTextContent("CLI");
    expect(warning).toHaveTextContent("HTTP 500");
    // 非阻塞：文件树仍展示
    expect(screen.getByText("proposal.md")).toBeInTheDocument();
  });

  it("刷新 RPC 超时（rpc_timeout）：提示条说明超时原因", async () => {
    mockedPending.mockResolvedValue({ items: [] });
    mockListWithSync({ triggered: true, ok: false, reason: "rpc_timeout", stderr_tail: null });

    await renderAndSettle();
    clickRefresh();

    const warning = await screen.findByTestId("change-files-sync-warning");
    expect(warning).toHaveTextContent("同步未完成");
    expect(warning).toHaveTextContent("超时");
  });

  it("未绑定 daemon（triggered=false / no_binding）：提示条为「同步未执行」", async () => {
    mockedPending.mockResolvedValue({ items: [] });
    mockListWithSync({ triggered: false, ok: null, reason: "no_binding", stderr_tail: null });

    await renderAndSettle();
    clickRefresh();

    const warning = await screen.findByTestId("change-files-sync-warning");
    expect(warning).toHaveTextContent("同步未执行");
    expect(warning).toHaveTextContent("未绑定");
  });

  it("先失败后成功：再次刷新成功清除提示条", async () => {
    mockedPending.mockResolvedValue({ items: [] });
    let syncAttempt = 0;
    mockedList.mockImplementation(() => {
      if ((mockedList.mock.calls.at(-1)?.[2])?.sync) {
        syncAttempt += 1;
        return Promise.resolve(
          syncAttempt === 1
            ? fileResp({ triggered: true, ok: false, reason: "rpc_timeout", stderr_tail: null })
            : fileResp({ triggered: true, ok: true, reason: null, stderr_tail: null }),
        );
      }
      return Promise.resolve(fileResp());
    });

    await renderAndSettle();

    clickRefresh();
    await screen.findByTestId("change-files-sync-warning");

    clickRefresh();
    await waitFor(() =>
      expect(screen.queryByTestId("change-files-sync-warning")).not.toBeInTheDocument(),
    );
  });
});
