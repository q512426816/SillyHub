/**
 * ShadowSessionViewer 单测（群聊体验 quick，2026-09-02；同日会话体验对齐重做）。
 *
 * 覆盖：
 *  1. 装配 + 对话视图（TurnTimeline 消费）——影子 user_input = 用户 turn（注入
 *     身份标签）、agent stdout（剥 [ASSISTANT] 前缀）= 回复段走 MarkdownText、
 *     噪音行（[TOOL_USE] 文本行）丢弃；thinking/tool_call 过程段对话视图不渲染；
 *  2. viewMode 胶囊切换——「进度」视图显示过程段（💭 思考过程 + 工具名）；
 *  3. 向上无限滚动——滚到顶触发 before=当前最早行 ts + limit=100，结果 prepend
 *     （重装配 turns）；不满页 →「没有更多了」；
 *  4. 搜索——回车 q= 全量查询（不带 before/after，limit=100），结果替换 +
 *     清除搜索恢复初始浏览（数据层断言保留；高亮降级为 TurnTimeline 内文本）；
 *  5. 空态文案 / 加载失败 Result 重试。
 *
 * mock 策略（skill-content-drawer.test 同款惯例）：
 *  - @/lib/daemon getAgentSessionLogs mock 断言调用参数；
 *  - @/components/ui/markdown-text mock 纯 div（jsdom 下 next/dynamic ssr:false
 *    同步渲染 null 的已知 gotcha，断言以 data-testid 锚定——TurnTimeline 文本段
 *    渲染链路同样消费该组件）。
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

describe("ShadowSessionViewer 装配 + 对话视图（TurnTimeline 会话同款）", () => {
  it("初始参数 limit=100；user_input 装配为用户 turn（注入身份）+ stdout 剥前缀为回复段；噪音/过程段对话视图不渲染", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue(
      sortShadowLogs([
        makeLog({
          id: "l-inj",
          channel: "user_input",
          timestamp: "2026-09-01T06:01:00Z",
          content_redacted: "@小码 看看这个白屏",
        }),
        makeLog({
          id: "l-think",
          channel: "stdout",
          timestamp: "2026-09-01T06:01:30Z",
          content_redacted: "[THINKING] 先查构建日志",
        }),
        makeLog({
          id: "l-tool",
          channel: "tool_call",
          timestamp: "2026-09-01T06:01:40Z",
          content_redacted:
            '{"tool":"Bash","args":{"command":"pnpm build"},"tool_use_id":"t-1","success":true}',
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

    // 会话消息流挂载（TurnTimeline 滚动容器）+ viewMode 胶囊默认「对话」。
    const timeline = await screen.findByTestId("turn-timeline-scroll");
    expect(timeline).toBeTruthy();
    expect(
      screen.getByTestId("shadow-viewmode-conversation").getAttribute("aria-selected"),
    ).toBe("true");

    // 注入 prompt = 用户 turn（右侧气泡）+「注入」身份标签（sender 头像 title）。
    expect(screen.getByText("@小码 看看这个白屏")).toBeTruthy();
    expect(document.querySelector('[title="注入"]')).toBeTruthy();

    // agent 输出：装配为回复段，剥 [ASSISTANT] 前缀走 MarkdownText。
    await waitFor(() => {
      expect(screen.getAllByTestId("markdown-text").map((n) => n.textContent)).toEqual([
        "结论：**定位完成**",
      ]);
    });

    // 对话视图不渲染过程段（thinking / 工具）与噪音行。
    expect(screen.queryByText(/思考过程/)).toBeNull();
    expect(screen.queryByText("Bash")).toBeNull();
  });

  it("viewMode 切换「进度」：完整段时间线显示思考折叠行 + 工具行（assembler 分类）", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({
        id: "l-inj",
        channel: "user_input",
        timestamp: "2026-09-01T06:01:00Z",
        content_redacted: "@小码 看看这个白屏",
      }),
      makeLog({
        id: "l-think",
        channel: "stdout",
        timestamp: "2026-09-01T06:01:30Z",
        content_redacted: "[THINKING] 先查构建日志",
      }),
      makeLog({
        id: "l-tool",
        channel: "tool_call",
        timestamp: "2026-09-01T06:01:40Z",
        content_redacted:
          '{"tool":"Bash","args":{"command":"pnpm build"},"tool_use_id":"t-1","success":true}',
      }),
    ]);
    renderViewer();
    expect(await screen.findByText("@小码 看看这个白屏")).toBeTruthy();
    // 对话视图无过程段。
    expect(screen.queryByText(/思考过程/)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "进度" }));
    expect(
      screen.getByTestId("shadow-viewmode-all").getAttribute("aria-selected"),
    ).toBe("true");
    // 进度视图：思考折叠行（💭 思考过程）+ 工具行（Bash）就位。
    expect(screen.getByText(/思考过程/)).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
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
  it("滚到顶触发 before=当前最早行 ts + limit=100，结果 prepend（独立 run 成新 turn）；不满页 →「没有更多了」", async () => {
    // 初始满页 100 条（06:00-07:39）→ hasMore=true。
    const firstPage = makePage(SHADOW_PAGE_SIZE, 0);
    const olderPage = [
      makeLog({
        id: "l-old-1",
        run_id: "r-0",
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
      expect(screen.getByTestId("turn-timeline-scroll")).toBeTruthy();
      expect(screen.getByText(/第 0 条注入/)).toBeTruthy();
    });

    // jsdom scrollTop/scrollHeight 恒 0 → 时间线滚动容器 scroll 事件即命中顶部
    // 阈值（捕获监听挂在外包层，TurnTimeline 内部容器的事件经捕获相位命中）。
    fireEvent.scroll(screen.getByTestId("turn-timeline-scroll"));

    await waitFor(() =>
      expect(mocks.getAgentSessionLogs).toHaveBeenLastCalledWith("shadow-1", {
        before: firstPage[0]!.timestamp,
        limit: SHADOW_PAGE_SIZE,
      }),
    );
    // prepend：更早内容出现在列表（独立 run_id → 独立用户 turn 气泡）。
    await waitFor(() => {
      expect(screen.getByText("更早的一条")).toBeTruthy();
      expect(screen.getByText(/第 0 条注入/)).toBeTruthy();
    });
    // 第二页不满（1 < 100）→ 没有更多了。
    await waitFor(() =>
      expect(screen.getByTestId("shadow-session-no-more")).toBeTruthy(),
    );
  });
});

describe("ShadowSessionViewer 搜索", () => {
  it("回车 q= 全量搜索（limit=100，无 before/after）：结果替换装配渲染 + 清除恢复初始", async () => {
    const initial = makePage(3, 0);
    mocks.getAgentSessionLogs
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce([
        makeLog({
          id: "l-hit",
          run_id: "r-9",
          channel: "user_input",
          timestamp: "2026-09-01T05:00:00Z",
          content_redacted: "登录页白屏复现步骤",
        }),
      ])
      .mockResolvedValueOnce(initial);
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText(/第 0 条注入/)).toBeTruthy();
    });

    // 回车搜索（onSearch 内建 Enter 触发——aria-label 直落 input 元素）。
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
    // 搜索模式条 + 命中结果替换初始列表（装配后用户 turn 气泡原文）。
    await waitFor(() => {
      expect(screen.getByTestId("shadow-search-mode-bar").textContent).toContain(
        "命中 1 条",
      );
    });
    expect(screen.getByText("登录页白屏复现步骤")).toBeTruthy();
    expect(screen.queryByText(/第 0 条注入/)).toBeNull();

    // 清除搜索 → 恢复初始浏览（重新拉 limit=100 无 q）。
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    await waitFor(() => {
      expect(screen.getByText(/第 0 条注入/)).toBeTruthy();
    });
    expect(mocks.getAgentSessionLogs).toHaveBeenLastCalledWith("shadow-1", {
      limit: SHADOW_PAGE_SIZE,
    });
  });

  it("搜索无命中 → 空态文案带关键词；搜索模式命中非空时滚动不触发向上翻页", async () => {
    // 初始空 → 搜索也无命中（空态带关键词分支）。
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
    // 空结果无时间线可滚（getAgentSessionLogs 仍 2 次初始 + 1 次搜索）。
    expect(mocks.getAgentSessionLogs).toHaveBeenCalledTimes(2);

    // 再搜一次有命中 → 时间线存在；搜索模式滚动不触发 before 翻页。
    mocks.getAgentSessionLogs.mockResolvedValueOnce([
      makeLog({
        id: "l-hit-2",
        run_id: "r-8",
        channel: "user_input",
        timestamp: "2026-09-01T05:00:00Z",
        content_redacted: "命中但不翻页",
      }),
    ]);
    fireEvent.change(input, { target: { value: "翻页" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByText("命中但不翻页")).toBeTruthy();
    });
    fireEvent.scroll(screen.getByTestId("turn-timeline-scroll"));
    await waitFor(() => {
      expect(screen.getByTestId("shadow-search-mode-bar").textContent).toContain(
        "命中 1 条",
      );
    });
    const calls = mocks.getAgentSessionLogs.mock.calls;
    expect(calls).toHaveLength(3);
    // 第 3 次是 q 搜索（无 before）——滚动未引入第 4 次调用。
    expect(calls[2]?.[1]).toMatchObject({ q: "翻页" });
  });
});
