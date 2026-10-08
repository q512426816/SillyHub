/**
 * 知识图谱请求超时对齐（2026-10-09 风险审查 / e8da254ce 后续修复）。
 *
 * 背景：backend GRAPH_RPC_TIMEOUT=60s——overview 内部按序发 summary→orphans→
 * dangling 三 RPC（最坏 180s），query 单 RPC（最坏 60s）；apiFetch 对 GET 缺省
 * 30s abort，大仓全量建图累计超 30s 时前端恒先于服务端判死 abort → 图谱页
 * 整页降级「暂不可用」（reason=rpc_error 错误分支）。本文件钉住两个请求的
 * 显式 timeoutMs 预算，防回归到缺省 30s。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { getKnowledgeGraphOverview, getKnowledgeGraphQuery } from "@/lib/knowledge";

describe("知识图谱请求超时对齐服务端 RPC 预算", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ available: false, reason: "rpc_error", data: null });
  });

  it("overview 显式 200s（三连 RPC 最坏 180s + 余量），不吃 GET 缺省 30s", async () => {
    await getKnowledgeGraphOverview("ws-1");
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const options = apiFetchMock.mock.calls[0]![1] as { timeoutMs?: number } | undefined;
    expect(options?.timeoutMs).toBe(200_000);
  });

  it("query 显式 90s（单 RPC 60s + 余量）", async () => {
    await getKnowledgeGraphQuery("ws-1", "neighbors", { anchor: "conventions.md" });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const options = apiFetchMock.mock.calls[0]![1] as { timeoutMs?: number } | undefined;
    expect(options?.timeoutMs).toBe(90_000);
  });
});
