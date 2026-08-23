/**
 * RunFileArtifacts 单测（2026-08-23-agent-file-upload-mcp task-09）。
 *
 * 覆盖（tasks/task-09.md implementation / acceptance）：
 *   1. 正常列表：渲染 FileMessageCard 卡片与区头数量「N 个」。
 *   2. 多 run 合并：file id 去重 + created_at 倒序（DOM 顺序断言）。
 *   3. 空态：「暂无产出文件」。
 *   4. 失败态：全部 run 拉取失败 → 错误行（不渲染卡片、不抛错阻断）。
 *   5. 部分失败：仍显示加载成功 run 的卡片 + 失败提示行。
 *   6. 加载态：「加载中...」。
 *   7. runIds 为空 → 整区不渲染（页面侧 agentRuns 非空才挂载，此处兜底）。
 *
 * 模式：照搬 machine-card.test.tsx 的 QueryClientProvider 包裹（retry: false
 * 让失败态即时落定）；mock @/lib/agent 列表函数与 task-08 FileMessageCard
 * （仅验在位 + props 透传，卡片内部形态归 file-message-card.test.tsx）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/agent", () => ({
  listAgentFileArtifacts: vi.fn(),
}));

// 桩 task-08 FileMessageCard：仅断言在位 + fileId/name 透传（props 契约
// {fileId, name, size, mime, description}）。
vi.mock("@/components/daemon/file-message-card", () => ({
  FileMessageCard: (props: { fileId: string; name: string }) => (
    <div data-testid="file-card" data-file-id={props.fileId} data-name={props.name} />
  ),
}));

import {
  RunFileArtifacts,
  mergeFileArtifacts,
} from "@/components/changes/detail/run-file-artifacts";
import {
  listAgentFileArtifacts,
  type AgentFileArtifactMeta,
} from "@/lib/agent";

const mockedList = vi.mocked(listAgentFileArtifacts);

function makeFile(over: Partial<AgentFileArtifactMeta> = {}): AgentFileArtifactMeta {
  return {
    id: "file-1",
    original_name: "scan-report.md",
    mime_type: "text/markdown",
    size: 1024,
    owner_type: "agent_run",
    owner_id: "run-1",
    description: "worker 产出的代码扫描报告",
    created_at: "2026-08-23T10:00:00Z",
    ...over,
  };
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function cardIdsInOrder(): string[] {
  const cards = document.querySelectorAll('[data-testid="file-card"]');
  return [...cards].map((el) => el.getAttribute("data-file-id") ?? "");
}

describe("mergeFileArtifacts（纯合并逻辑）", () => {
  it("多 run 合并按 file id 去重、created_at 倒序", () => {
    const a1 = makeFile({ id: "f-old", created_at: "2026-08-23T09:00:00Z" });
    const a2 = makeFile({ id: "f-new", created_at: "2026-08-23T11:00:00Z" });
    const dup = makeFile({ id: "f-old", original_name: "重复归属.md" });
    const merged = mergeFileArtifacts([[a1, a2], [dup]]);
    expect(merged.map((f) => f.id)).toEqual(["f-new", "f-old"]);
    // 去重保留首个 run 的元数据
    expect(merged[1]?.original_name).toBe("scan-report.md");
  });
});

describe("RunFileArtifacts", () => {
  beforeEach(() => {
    mockedList.mockReset();
  });

  it("正常列表：渲染卡片 + 区头数量「N 个 · 点击下载」", async () => {
    mockedList.mockResolvedValue([
      makeFile({ id: "f-1", original_name: "scan-report.md" }),
      makeFile({ id: "f-2", original_name: "dep-graph.png", mime_type: "image/png" }),
    ]);
    renderWithClient(<RunFileArtifacts runIds={["run-1"]} />);

    expect(await screen.findByText("2 个 · 点击下载")).toBeInTheDocument();
    expect(cardIdsInOrder()).toEqual(["f-1", "f-2"]);
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledWith("run-1");
  });

  it("多 run：逐 run 拉取合并去重，按 created_at 倒序渲染", async () => {
    mockedList.mockImplementation(async (runId: string) => {
      if (runId === "run-1") {
        return [
          makeFile({ id: "f-a", created_at: "2026-08-23T09:00:00Z" }),
          makeFile({ id: "f-b", created_at: "2026-08-23T10:30:00Z" }),
        ];
      }
      // run-2 含与 run-1 重复的 f-a（同 file 挂多 run）+ 更新的 f-c
      return [
        makeFile({ id: "f-a", created_at: "2026-08-23T09:00:00Z" }),
        makeFile({ id: "f-c", created_at: "2026-08-23T11:00:00Z" }),
      ];
    });
    renderWithClient(<RunFileArtifacts runIds={["run-1", "run-2"]} />);

    expect(await screen.findByText("3 个 · 点击下载")).toBeInTheDocument();
    expect(cardIdsInOrder()).toEqual(["f-c", "f-b", "f-a"]);
    expect(mockedList).toHaveBeenCalledWith("run-1");
    expect(mockedList).toHaveBeenCalledWith("run-2");
  });

  it("空态：所有 run 无文件 → 「暂无产出文件」", async () => {
    mockedList.mockResolvedValue([]);
    renderWithClient(<RunFileArtifacts runIds={["run-1"]} />);

    expect(await screen.findByText("暂无产出文件")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="file-card"]')).toHaveLength(0);
  });

  it("失败态：全部 run 失败 → 错误行，不渲染卡片", async () => {
    mockedList.mockRejectedValue(new Error("network down"));
    renderWithClient(<RunFileArtifacts runIds={["run-1", "run-2"]} />);

    expect(await screen.findByText(/产出文件加载失败/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="file-card"]')).toHaveLength(0);
  });

  it("部分失败：仍显示成功 run 的卡片 + 失败提示行", async () => {
    mockedList.mockImplementation(async (runId: string) => {
      if (runId === "run-1") {
        return [makeFile({ id: "f-ok", created_at: "2026-08-23T10:00:00Z" })];
      }
      throw new Error("boom");
    });
    renderWithClient(<RunFileArtifacts runIds={["run-1", "run-2"]} />);

    expect(await screen.findByTestId("file-card")).toBeInTheDocument();
    expect(screen.getByText(/1 个执行记录的产出文件加载失败/)).toBeInTheDocument();
    expect(cardIdsInOrder()).toEqual(["f-ok"]);
  });

  it("加载态：请求未落定 → 「加载中...」", () => {
    mockedList.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<RunFileArtifacts runIds={["run-1"]} />);

    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("runIds 为空 → 整区不渲染", () => {
    const { container } = renderWithClient(<RunFileArtifacts runIds={[]} />);
    expect(container.firstChild).toBeNull();
    expect(mockedList).not.toHaveBeenCalled();
  });
});
