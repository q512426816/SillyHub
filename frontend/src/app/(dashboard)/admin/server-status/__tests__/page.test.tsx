/**
 * 服务器信息页组件测试（2026-10-14-admin-server-status task-02）。
 *
 * 覆盖 FR-02 三态（对照 TaskCard acceptance）：
 * 1. 正常态：三组卡片渲染——性能百分数、四项业务统计、依赖徽标（DB/Redis）；
 * 2. 轮询：初始 1 次，fake timers 推进 5s 后再次拉取；
 * 3. unmount 清理定时器，之后不再拉取；
 * 4. 失败降级：mock 拒绝后渲染错误条，且既有数据不清空。
 *
 * 401 不在页内承接（全局拦截跳登录，frontend/src/lib/api.ts:250-256），
 * 非本页测试面（FR-02 注记）。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ServerStatusPage from "@/app/(dashboard)/admin/server-status/page";
import type { HealthResponse, SystemStatusResponse } from "@/lib/health";

// ── mock @/lib/health：数据层双接口可编程返回 ──────────────────────────────
const getSystemStatusMock = vi.hoisted(() => vi.fn());
const getHealthMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/health", async () => {
  const actual = await vi.importActual<typeof import("@/lib/health")>("@/lib/health");
  return {
    ...actual,
    getSystemStatus: getSystemStatusMock,
    getHealth: getHealthMock,
  };
});

const STATUS_FIXTURE: SystemStatusResponse = {
  server_time: "2026-10-14T14:32:08.000Z",
  cpu_percent: 62.4,
  memory_percent: 87.2,
  memory_used_mb: 7800.1,
  memory_total_mb: 16000.2,
  disk_percent: 71.0,
  disk_used_gb: 156.3,
  disk_total_gb: 220.4,
  tasks: 128,
  projects: 12,
  milestones: 45,
  users: 8,
};

const HEALTH_FIXTURE: HealthResponse = {
  status: "ok",
  db: "ok",
  redis: "ok",
  version: "0.9.2",
  commit_sha: "a1b2c3d4e5f6",
  server_time: "2026-10-14T14:32:08.000Z",
  environment: "test",
};

function mockAllOk() {
  getSystemStatusMock.mockResolvedValue({ ...STATUS_FIXTURE });
  getHealthMock.mockResolvedValue({ ...HEALTH_FIXTURE });
}

/** render 后 flush 初始 refresh 的微任务（fake timers 下不用 waitFor）。 */
async function renderAndFlush() {
  const view = render(<ServerStatusPage />);
  await act(async () => {});
  return view;
}

describe("/admin/server-status 服务器信息页（task-02）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSystemStatusMock.mockReset();
    getHealthMock.mockReset();
    mockAllOk();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("正常态：三组卡片渲染——性能百分数、四项业务统计、依赖徽标", async () => {
    await renderAndFlush();

    // 性能卡：三行百分数（CPU 62 / 内存 87 / 磁盘 71，取整展示）
    expect(screen.getAllByText("62%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("87%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("71%").length).toBeGreaterThan(0);
    // 数值明细
    expect(screen.getByText(/7800\.1 MB \/ 16000\.2 MB/)).toBeInTheDocument();

    // 统计卡：四格数值
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();

    // 依赖卡：DB/Redis 徽标文本与元信息
    expect(screen.getByText("已连接 · v0.9.2")).toBeInTheDocument();
    expect(screen.getAllByText("已连接").length).toBeGreaterThan(0);
    expect(screen.getByText("0.9.2（a1b2c3d）")).toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();
  });

  it("轮询：初始 1 次，5 秒后再次拉取", async () => {
    await renderAndFlush();
    expect(getSystemStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getSystemStatusMock).toHaveBeenCalledTimes(2);
    expect(getHealthMock).toHaveBeenCalledTimes(2);
  });

  it("unmount 清理定时器，之后不再拉取", async () => {
    const view = await renderAndFlush();
    expect(getSystemStatusMock).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(getSystemStatusMock).toHaveBeenCalledTimes(1);
  });

  it("失败降级：错误条出现且既有数据不清空", async () => {
    await renderAndFlush();
    expect(screen.getByText("128")).toBeInTheDocument();

    // 下一轮拉取失败（ApiError 语义：message 文本）
    getSystemStatusMock.mockRejectedValueOnce(new Error("403 无权执行此操作"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText("服务器状态获取失败")).toBeInTheDocument();
    // 既有数据保留（不清空）
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText(/7800\.1 MB \/ 16000\.2 MB/)).toBeInTheDocument();
  });
});
