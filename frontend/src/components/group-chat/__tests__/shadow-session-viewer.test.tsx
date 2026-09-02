/**
 * ShadowSessionViewer 单测（群聊体验 quick，2026-09-02）。
 *
 * 覆盖：
 *  1. 初始加载参数（limit=100）与行渲染——user_input 注入行（截断 200 + 展开全文）、
 *     stdout 输出行（剥前缀走 MarkdownText + 成员名标签）、噪音行丢弃；
 *  2. 向上无限滚动——滚到顶触发 before=当前最早行 ts + limit=100，结果 prepend；
 *     不满页 →「没有更多了」；
 *  3. 搜索——回车 q= 全量查询（不带 before/after，limit=100），结果替换 +
 *     命中 <mark> 高亮；清除搜索恢复初始浏览；
 *  4. 空态文案。
 *
 * mock 策略（skill-content-drawer.test 同款惯例）：
 *  - @/lib/daemon getAgentSessionLogs mock 断言调用参数；
 *  - @/components/ui/markdown-text mock 纯 div（jsdom 下 next/dynamic ssr:false
 *    同步渲染 null 的已知 gotcha，断言以 data-testid 锚定）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import {
  ShadowSessionViewer,
  SHADOW_PAGE_SIZE,
  sortShadowLogs,
} from "@/components/group-chat/shadow-session-viewer";
import type { AgentRunLogEntry } from "@/lib/agent";

const mocks = vi.hoisted(() => ({
  getAgentSessionLogs: vi.fn(),
}));

vi.mock("@/lib/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    getAgentSessionLogs: (...args: unknown[]) => mocks.getAgentSessionLogs(...args),
  };
});

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

/* ── 固件 ───────────────────────────────────────────────────────────────── */

let seq = 0;
function makeLog(
  overrides: Partial<AgentRunLogEntry> = {},
): AgentRunLogEntry {
  seq += 1;
  return {
    id: `l-${seq}`,
    run_id: "r-1",
    timestamp: `2026-09-01T06:${String(10 + seq).padStart(2, "0")}:00Z`,
    channel: "stdout",
    content_redacted: "",
    ...overrides,
  };
}

/** 连续 N 条注入行（t=06:00 起 1 分钟一条，供翻页/排序断言）。 */
function makePage(count: number, startMinutes = 0): AgentRunLogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeLog({
      id: `l-p${startMinutes + i}`,
      timestamp: `2026-09-01T${String(6).padStart(2, "0")}:${String(
        startMinutes + i,
      ).padStart(2, "0")}:00Z`,
      channel: "user_input",
      content_redacted: `第 ${startMinutes + i} 条注入`,
    }),
  );
}

function renderViewer(shadowSessionId = "shadow-1", memberName = "小码") {
  return render(
    <ShadowSessionViewer
      open
      onClose={vi.fn()}
      shadowSessionId={shadowSessionId}
      memberName={memberName}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/* ── 用例 ───────────────────────────────────────────────────────────────── */

describe("ShadowSessionViewer 初始加载与行渲染", () => {
  it("初始参数 limit=100（无 before/q）；注入行截断 200 + 展开全文；输出行剥前缀走 MarkdownText + 成员名标签；噪音行丢弃", async () => {
    const longPrompt = "甲".repeat(260);
    mocks.getAgentSessionLogs.mockResolvedValue(
      sortShadowLogs([
        makeLog({
          id: "l-inj",
          channel: "user_input",
          timestamp: "2026-09-01T06:01:00Z",
          content_redacted: longPrompt,
        }),
        makeLog({
          id: "l-out",
          channel: "stdout",
          timestamp: "2026-09-01T06:02:00Z",
          content_redacted: "[ASSISTANT] 结论：**定位完成**",
        }),
        makeLog({
          id: "l-noise",
          channel: "stdout",
          timestamp: "2026-09-01T06:03:00Z",
          content_redacted: '[TOOL_USE] {"name":"Read"}',
        }),
      ]),
    );
    renderViewer();
    await waitFor(() =>
      expect(mocks.getAgentSessionLogs).toHaveBeenCalledWith("shadow-1", {
        limit: SHADOW_PAGE_SIZE,
      }),
    );

    // 注入行：截断 200 字（260 → 前 200 + …），展开按钮在。
    const injectRow = await screen.findByTestId("shadow-log-inject");
    expect(injectRow.textContent).toContain("注入");
    expect(injectRow.textContent!.length).toBeLessThan(260);
    fireEvent.click(screen.getByTestId("shadow-log-inject-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("shadow-log-inject").textContent).toContain(
        longPrompt,
      );
    });

    // 输出行：md 替身渲染剥前缀后的正文 + 成员名标签。
    const mdNodes = await screen.findAllByTestId("markdown-text");
    expect(mdNodes.map((n) => n.textContent)).toEqual(["结论：**定位完成**"]);
    expect(screen.getByTestId("shadow-log-output").textContent).toContain("小码");
  });

  it("空态：无记录文案（且不满页不显示「没有更多了」——空列表无翻页位）", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([]);
    renderViewer();
    expect(await screen.findByTestId("shadow-session-empty")).toBeTruthy();
    expect(
      screen.getByTestId("shadow-session-empty").textContent,
    ).toContain("暂无记录");
    expect(screen.queryByTestId("shadow-session-no-more")).toBeNull();
  });

  it("加载失败 → antd Result 错误态 + 重试恢复", async () => {
    mocks.getAgentSessionLogs
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([]);
    renderViewer();
    expect(await screen.findByText("记录加载失败")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    // antd Button 两字中文自动插入空格分隔（accessible name =「重 试」）。
    fireEvent.click(screen.getByRole("button", { name: "重 试" }));
    await waitFor(() =>
      expect(mocks.getAgentSessionLogs).toHaveBeenCalledTimes(2),
    );
  });
});

describe("ShadowSessionViewer 向上无限滚动", () => {
  it("滚到顶触发 before=当前最早行 ts + limit=100，结果 prepend；不满页 →「没有更多了」", async () => {
    // 初始满页 100 条（06:00-07:39）→ hasMore=true。
    const firstPage = makePage(SHADOW_PAGE_SIZE, 0);
    const olderPage = [
      makeLog({
        id: "l-old-1",
        channel: "user_input",
        timestamp: "2026-08-31T23:58:00Z",
        content_redacted: "更早的一条",
      }),
    ];
    mocks.getAgentSessionLogs
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(olderPage);
    renderViewer();

    await waitFor(() => {
      expect(screen.getByTestId("shadow-session-timeline")).toBeTruthy();
      expect(screen.getByText("第 0 条注入")).toBeTruthy();
    });

    // jsdom scrollTop/scrollHeight 恒 0 → scroll 事件即命中顶部阈值。
    fireEvent.scroll(screen.getByTestId("shadow-session-timeline"));

    await waitFor(() =>
      expect(mocks.getAgentSessionLogs).toHaveBeenLastCalledWith("shadow-1", {
        before: firstPage[0]!.timestamp,
        limit: SHADOW_PAGE_SIZE,
      }),
    );
    // prepend：更早内容出现在列表（旧内容保留）。
    await waitFor(() => {
      expect(screen.getByText("更早的一条")).toBeTruthy();
      expect(screen.getByText("第 0 条注入")).toBeTruthy();
    });
    // 第二页不满（1 < 100）→ 没有更多了。
    await waitFor(() =>
      expect(screen.getByTestId("shadow-session-no-more")).toBeTruthy(),
    );
  });
});

describe("ShadowSessionViewer 搜索", () => {
  it("回车 q= 全量搜索（limit=100，无 before/after）：结果替换 + <mark> 高亮 + 清除恢复初始", async () => {
    const initial = makePage(3, 0);
    mocks.getAgentSessionLogs
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce([
        makeLog({
          id: "l-hit",
          channel: "user_input",
          timestamp: "2026-09-01T05:00:00Z",
          content_redacted: "登录页白屏复现步骤",
        }),
      ])
      .mockResolvedValueOnce(initial);
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText("第 0 条注入")).toBeTruthy();
    });

    // 回车搜索（onPressEnter——aria-label 直落 input 元素）。
    const input = screen.getByLabelText(
      "搜索影子会话记录",
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "白屏" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.getAgentSessionLogs).toHaveBeenLastCalledWith("shadow-1", {
        q: "白屏",
        limit: SHADOW_PAGE_SIZE,
      }),
    );
    // 搜索模式条 + 命中高亮 <mark>。
    await waitFor(() => {
      expect(screen.getByTestId("shadow-search-mode-bar").textContent).toContain(
        "命中 1 条",
      );
    });
    expect(screen.getByTestId("shadow-search-hit").textContent).toBe("白屏");
    // 结果替换初始列表（<mark> 拆分文本节点——按行内文断言）。
    expect(screen.getByTestId("shadow-log-inject").textContent).toContain(
      "登录页白屏复现步骤",
    );
    expect(screen.queryByText("第 0 条注入")).toBeNull();

    // 清除搜索 → 恢复初始浏览（重新拉 limit=100 无 q）。
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    await waitFor(() => {
      expect(screen.getByText("第 0 条注入")).toBeTruthy();
    });
    expect(mocks.getAgentSessionLogs).toHaveBeenLastCalledWith("shadow-1", {
      limit: SHADOW_PAGE_SIZE,
    });
  });

  it("搜索无命中 → 空态文案带关键词；搜索模式不触发向上翻页", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([]);
    renderViewer();
    await waitFor(() => {
      expect(screen.getByTestId("shadow-session-empty")).toBeTruthy();
    });

    const input = screen.getByLabelText(
      "搜索影子会话记录",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "不存在的词" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.getAgentSessionLogs).toHaveBeenLastCalledWith("shadow-1", {
        q: "不存在的词",
        limit: SHADOW_PAGE_SIZE,
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("shadow-session-empty").textContent).toContain(
        "不存在的词",
      );
    });
    // 搜索模式滚动不翻页（getAgentSessionLogs 仍 2 次初始 + 1 次搜索）。
    fireEvent.scroll(screen.getByTestId("shadow-session-timeline"));
    await waitFor(() => {
      expect(screen.queryByTestId("shadow-search-mode-bar")).toBeTruthy();
    });
    expect(mocks.getAgentSessionLogs).toHaveBeenCalledTimes(2);
  });
});
