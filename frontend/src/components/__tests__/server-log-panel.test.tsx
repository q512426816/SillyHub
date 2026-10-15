/**
 * 服务器日志卡测试（2026-10-15-server-logs-panel task-03）。
 *
 * 覆盖（对照 TaskCard acceptance）：
 * 1. 结构化行渲染（INFO/WARN/ERROR 与 time/event/fields 摘要）；
 * 2. 非 JSON 行 raw 降级展示（RAW 徽标 + 原文）；
 * 3. 行数切换触发新请求（lines=500）并重置展开态；
 * 4. 点日志行展开原始内容（再点收起）；
 * 5. 下载走真实 downloadLogFile 链路（fetch 带 Bearer → objectURL → a[download] → revoke）；
 * 6. 卡内 5s 轮询二次拉取；卸载清理定时器；
 * 7. 失败态卡内错误条且既有数据不清空。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ServerLogPanel from "@/components/server-log-panel";
import type { ServerLogsResponse } from "@/lib/health";

// ── mock @/lib/health：仅接管 getServerLogs；downloadLogFile 保真走真实链路 ──
const getServerLogsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/health", async () => {
  const actual = await vi.importActual<typeof import("@/lib/health")>("@/lib/health");
  return { ...actual, getServerLogs: getServerLogsMock };
});

// token-refresh：真实模块会尝试读 session/网络；测试里 401 分支单独给返回值
const ensureFreshMock = vi.hoisted(() => vi.fn().mockResolvedValue("fresh-token"));
vi.mock("@/lib/token-refresh", () => ({
  ensureFreshAccessToken: ensureFreshMock,
}));

const STATUS_FIXTURE: ServerLogsResponse = {
  file: "backend.log",
  entries: [
    {
      time: "2026-10-15T08:00:00Z",
      level: "info",
      event: "app.started",
      fields: { environment: "dev" },
      raw: null,
      parse_error: false,
    },
    {
      time: null,
      level: null,
      event: null,
      fields: {},
      raw: "this-is-not-json",
      parse_error: true,
    },
    {
      time: "2026-10-15T08:00:05Z",
      level: "warning",
      event: "health.redis.down",
      fields: { retry: "1.2s" },
      raw: null,
      parse_error: false,
    },
    {
      time: "2026-10-15T08:00:09Z",
      level: "error",
      event: "agent.run.failed",
      fields: { exit_code: 1 },
      raw: null,
      parse_error: false,
    },
  ],
  total_lines: 12345,
  returned: 4,
  available_files: [
    { name: "backend.log", size: 2048, mtime: 1760515200 },
    { name: "backend.log.1", size: 1024, mtime: 1760511600 },
  ],
  hint: null,
};

async function renderAndFlush() {
  const view = render(<ServerLogPanel />);
  await act(async () => {});
  return view;
}

describe("ServerLogPanel（task-03）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getServerLogsMock.mockReset();
    getServerLogsMock.mockResolvedValue(structuredClone(STATUS_FIXTURE));
    ensureFreshMock.mockClear();
    // 真实下载链路依赖
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("结构化行渲染：时间/级别/事件/fields 摘要 + 页脚行数", async () => {
    await renderAndFlush();
    expect(screen.getByText("app.started")).toBeInTheDocument();
    expect(screen.getByText(/environment=dev/)).toBeInTheDocument();
    // 徽标视觉大写由 CSS uppercase 呈现，DOM 文本为原始小写
    expect(screen.getByText("info")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText(/显示最近 4 行（文件共 12345 行）/)).toBeInTheDocument();
  });

  it("非 JSON 行 raw 降级展示（RAW 徽标 + 原文）", async () => {
    await renderAndFlush();
    expect(screen.getByText("RAW")).toBeInTheDocument();
    expect(screen.getByText("this-is-not-json")).toBeInTheDocument();
  });

  it("行数切换触发新请求", async () => {
    await renderAndFlush();
    expect(getServerLogsMock).toHaveBeenCalledWith(200);

    fireEvent.click(screen.getByText("500 行"));
    await act(async () => {});
    expect(getServerLogsMock).toHaveBeenCalledWith(500);
  });

  it("点日志行展开原始内容，再点收起", async () => {
    await renderAndFlush();
    fireEvent.click(screen.getByText("app.started"));
    expect(screen.getByText(/"event": "app.started"/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("app.started"));
    expect(screen.queryByText(/"event": "app.started"/)).not.toBeInTheDocument();
  });

  it("下载走真实链路：fetch 带 Bearer → objectURL → revoke", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["log-content"], { type: "text/plain" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await renderAndFlush();
    fireEvent.click(screen.getByText("下载"));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/server-logs/download?file=backend.log",
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });

  it("5s 轮询二次拉取；卸载清理定时器", async () => {
    const view = await renderAndFlush();
    expect(getServerLogsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getServerLogsMock).toHaveBeenCalledTimes(2);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(getServerLogsMock).toHaveBeenCalledTimes(2);
  });

  it("失败态：卡内错误条且既有数据不清空", async () => {
    await renderAndFlush();
    expect(screen.getByText("app.started")).toBeInTheDocument();

    getServerLogsMock.mockRejectedValueOnce(new Error("403 无权执行此操作"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText("日志获取失败")).toBeInTheDocument();
    // 既有数据保留
    expect(screen.getByText("app.started")).toBeInTheDocument();
    expect(screen.getByText(/显示最近 4 行（文件共 12345 行）/)).toBeInTheDocument();
  });
});
