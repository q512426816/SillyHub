/**
 * DialogContextBar 测试（2026-07-09-ask-user-question-approval task-09）。
 *
 * 覆盖来源上下文条渲染 + 跳转 href（design §4.4 / D-002 / C8）：
 *   - workspace_name · session_type badge（scan/对话/stage）· 会话链接 · 时间 · run_summary；
 *   - run_summary 空 → 占位「会话进行中」；
 *   - 会话链接 href 含 /runtimes?session=<session_id>；
 *   - session_type 缺省 → badge「加载中」（SSE 路占位，C4）；
 *   - resolveSessionTypeBadge 纯函数三态映射。
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DialogContextBar,
  resolveSessionTypeBadge,
} from "@/components/permissions/dialog-context-bar";
import type { SessionPermissionRequest } from "@/lib/daemon";

// next/link 在 jsdom 下不导航，mock 成普通 <a> 以便断言 href（与 mcp/page.test.tsx 一致）。
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function makeRequest(
  overrides: Partial<SessionPermissionRequest> = {},
): SessionPermissionRequest {
  return {
    session_id: "sess-abc123def456",
    run_id: "run-xyz789abc",
    request_id: "req-1",
    tool_name: "AskUserQuestion",
    input: {},
    ...overrides,
  };
}

describe("DialogContextBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("渲染工作区名 + session_type badge(scan) + 会话/运行链接 + 时间 + run_summary", () => {
    render(
      <DialogContextBar
        request={makeRequest({
          workspace_name: "multi-agent-platform",
          session_type: "scan",
          run_summary: "扫描工作区，识别项目技术栈",
          created_at: "2026-07-09T11:55:00Z",
        })}
      >
        <div>子卡占位</div>
      </DialogContextBar>,
    );

    expect(screen.getByText("multi-agent-platform")).toBeInTheDocument();
    // scan badge 文案
    expect(screen.getByText("扫描")).toBeInTheDocument();
    // run_summary
    expect(
      screen.getByText("扫描工作区，识别项目技术栈"),
    ).toBeInTheDocument();
    // 子卡被包裹渲染
    expect(screen.getByText("子卡占位")).toBeInTheDocument();
  });

  it("session_type=chat → badge「对话」", () => {
    render(
      <DialogContextBar
        request={makeRequest({ session_type: "chat" })}
      >
        <div>x</div>
      </DialogContextBar>,
    );
    expect(screen.getByText("对话")).toBeInTheDocument();
  });

  it("session_type=stage → badge「阶段」", () => {
    render(
      <DialogContextBar
        request={makeRequest({ session_type: "stage" })}
      >
        <div>x</div>
      </DialogContextBar>,
    );
    expect(screen.getByText("阶段")).toBeInTheDocument();
  });

  it("run_summary 为空 → 占位「会话进行中」(design §4.1)", () => {
    render(
      <DialogContextBar
        request={makeRequest({ run_summary: null })}
      >
        <div>x</div>
      </DialogContextBar>,
    );
    expect(screen.getByText("会话进行中")).toBeInTheDocument();
  });

  it("run_summary 为空串 → 占位「会话进行中」", () => {
    render(
      <DialogContextBar
        request={makeRequest({ run_summary: "   " })}
      >
        <div>x</div>
      </DialogContextBar>,
    );
    expect(screen.getByText("会话进行中")).toBeInTheDocument();
  });

  it("session_type 缺省(SSE 路) → badge「加载中」(C4)", () => {
    render(
      <DialogContextBar
        request={makeRequest({ session_type: undefined })}
      >
        <div>x</div>
      </DialogContextBar>,
    );
    expect(screen.getByText("加载中")).toBeInTheDocument();
  });

  it("workspace_name 缺省 → 占位「工作区」", () => {
    render(
      <DialogContextBar
        request={makeRequest({ workspace_name: undefined })}
      >
        <div>x</div>
      </DialogContextBar>,
    );
    expect(screen.getByText("工作区")).toBeInTheDocument();
  });

  it("会话链接 href 含 /runtimes?session=<session_id>(design §4.4 C8)", () => {
    render(
      <DialogContextBar request={makeRequest()}>
        <div>x</div>
      </DialogContextBar>,
    );
    const sessionLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.includes("/runtimes?session="));
    // 至少有会话链接 + 卡头「查看会话」按钮共 2+ 处指向会话
    expect(sessionLinks.length).toBeGreaterThan(0);
    expect(sessionLinks[0]!.getAttribute("href")).toContain(
      "/runtimes?session=sess-abc123def456",
    );
  });

  it("卡头「查看会话」按钮跳转会话详情", () => {
    render(
      <DialogContextBar request={makeRequest()}>
        <div>x</div>
      </DialogContextBar>,
    );
    const viewBtn = screen.getByText(/查看会话/).closest("a");
    expect(viewBtn).not.toBeNull();
    expect(viewBtn!.getAttribute("href")).toBe(
      "/runtimes?session=sess-abc123def456",
    );
  });

  it("运行链接 href 含 session + run 标识", () => {
    render(
      <DialogContextBar request={makeRequest()}>
        <div>x</div>
      </DialogContextBar>,
    );
    // 运行链接带 run id hash
    const runLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("run-xyz789abc"));
    expect(runLink).toBeDefined();
  });

  it("resolveSessionTypeBadge 三态 + 缺省映射（纯函数）", () => {
    expect(resolveSessionTypeBadge("scan").label).toBe("扫描");
    expect(resolveSessionTypeBadge("chat").label).toBe("对话");
    expect(resolveSessionTypeBadge("stage").label).toBe("阶段");
    expect(resolveSessionTypeBadge(undefined).label).toBe("加载中");
  });
});
