import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// vi.mock 解耦后端（对齐 __tests__/change-file-tree.test.tsx 模式）；
// 本文件只测 autoRefreshMs 定时器行为，中文名映射等无关导出一并 stub。
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

// FilePreviewModal 浅 stub：本文件不交互预览，仅防真实弹窗树拖累 jsdom。
vi.mock("@/components/files/file-preview-modal", () => ({
  FilePreviewModal: () => null,
}));

import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ChangeFileTree } from "@/components/change-file-tree";
import { listChangeFiles, listPendingChangeFiles } from "@/lib/change-files";

const mockedList = vi.mocked(listChangeFiles);
const mockedPending = vi.mocked(listPendingChangeFiles);

function fileResp() {
  // 对齐 ChangeFileList / ChangeFileEntry 契约（change_id/size/last_modified_at 必填）
  return {
    change_id: "chg-1",
    items: [
      {
        path: "docs/design.md",
        name: "design.md",
        is_text: true,
        size: 1024,
        last_modified_at: "2026-10-13T12:00:00Z",
      },
    ],
  };
}

function renderTree(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

async function flushInitialLoad() {
  // 挂载 effect 的 Promise.all 走微任务；fake timers 下 waitFor 不推进，
  // 用 advanceTimersByTimeAsync(0) 排干微任务队列让初始请求落地。
  await vi.advanceTimersByTimeAsync(0);
  expect(mockedList).toHaveBeenCalled();
}

beforeAll(() => {
  // jsdom 未实现 blob URL（对齐既有测试 beforeAll 模式）
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ChangeFileTree autoRefreshMs（2026-10-13-session-change-files-hover task-02 / D-004@v1）", () => {
  it("不传 autoRefreshMs：无新增定时器，请求次数不随时间增长（既有行为回归守护）", async () => {
    vi.useFakeTimers();
    mockedList.mockResolvedValue(fileResp());
    mockedPending.mockResolvedValue({ items: [] });

    renderTree(<ChangeFileTree workspaceId="ws-1" changeId="chg-1" />);
    await flushInitialLoad();
    const afterMount = mockedList.mock.calls.length;

    await vi.advanceTimersByTimeAsync(45_000);
    expect(mockedList.mock.calls.length).toBe(afterMount);
    expect(mockedPending.mock.calls.length).toBe(afterMount);
  });

  it("传 autoRefreshMs=15000：每 15s 轮询文件树与排队清单", async () => {
    vi.useFakeTimers();
    mockedList.mockResolvedValue(fileResp());
    mockedPending.mockResolvedValue({ items: [] });

    renderTree(<ChangeFileTree workspaceId="ws-1" changeId="chg-1" autoRefreshMs={15000} />);
    await flushInitialLoad();
    expect(mockedList.mock.calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockedList.mock.calls.length).toBe(2);
    expect(mockedPending.mock.calls.length).toBe(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockedList.mock.calls.length).toBe(4);
  });

  it("卸载后定时器清除：unmount 再推进时间无新请求", async () => {
    vi.useFakeTimers();
    mockedList.mockResolvedValue(fileResp());
    mockedPending.mockResolvedValue({ items: [] });

    const { unmount } = renderTree(
      <ChangeFileTree workspaceId="ws-1" changeId="chg-1" autoRefreshMs={15000} />,
    );
    await flushInitialLoad();

    unmount();
    const atUnmount = mockedList.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockedList.mock.calls.length).toBe(atUnmount);
  });
});
