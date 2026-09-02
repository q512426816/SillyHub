/**
 * ShadowSessionViewer 单测（群聊体验 quick，2026-09-02；同日会话体验对齐重做 +
 * 影子直聊 quick 升级可交互完整会话）。
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
 * 影子直聊 quick（2026-09-02）新增覆盖：
 *  6. 头部 #影子id.slice(0,8) 短码 + 点击复制完整 id（clipboard stub 惯例）；
 *  7. 输入区权限——群主（canDirectMessage）输入框 + 发送参数（sendGroupDirectMessage
 *     (gid, mid, {content})，成功后清空且不重拉 logs = 不本地 append）；普通成员
 *     只读提示（SHADOW_READONLY_HINT）且不调发送 / 不建 SSE 流；
 *  8. SSE 实时流——群主打开即订阅 streamShadowSession(shadowSid)；onLog 新行
 *     追加渲染、同 log_id 去重；Drawer 关闭断流（close）；普通成员不订阅；
 *  9. 工具行渲染（三块对齐）——tool_call JSON = 权威工具段，stdout [TOOL_USE]
 *     双发副本丢弃（进度视图工具名不翻倍）；
 * 10. token 徽标（三块对齐）——[SYSTEM:thinking_tokens] 行（多条取末值）挂轮
 *     ↓N 徽标，行本身不进正文；
 * 11. [[GROUP]] 段标记——转发段加「将转发到群」小标签 + 剥协议标记。
 *
 * mock 策略（skill-content-drawer.test 同款惯例）：
 *  - @/lib/daemon getAgentSessionLogs / streamShadowSession / sendGroupDirectMessage
 *    mock 断言调用参数；
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
import { App as AntApp } from "antd";

import {
  ShadowSessionViewer,
  SHADOW_PAGE_SIZE,
  sortShadowLogs,
  parseShadowThinkingTokens,
  markGroupForwardText,
  mergeSnapshotWithLive,
  GROUP_FORWARD_LABEL,
} from "@/components/group-chat/shadow-session-viewer";
import type { AgentRunLogEntry } from "@/lib/agent";
import type { SessionStreamEnvelope } from "@/lib/daemon";

const mocks = vi.hoisted(() => ({
  getAgentSessionLogs: vi.fn(),
  streamShadowSession: vi.fn(),
  sendGroupDirectMessage: vi.fn(),
}));

vi.mock("@/lib/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    getAgentSessionLogs: (...args: unknown[]) => mocks.getAgentSessionLogs(...args),
    streamShadowSession: (...args: unknown[]) =>
      mocks.streamShadowSession(...args),
    sendGroupDirectMessage: (...args: unknown[]) =>
      mocks.sendGroupDirectMessage(...args),
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

/** SSE log 事件信封固件（streamShadowSession onLog 入参形状的最小子集）。 */
function makeEnvelope(overrides: Partial<SessionStreamEnvelope> = {}): SessionStreamEnvelope {
  seq += 1;
  return {
    event: "log",
    session_id: "shadow-1",
    run_id: "r-2",
    turn: null,
    log_id: `env-${seq}`,
    timestamp: `2026-09-01T07:${String(10 + seq).padStart(2, "0")}:00Z`,
    channel: "user_input",
    content: null,
    status: null,
    exit_code: null,
    reason: null,
    ...overrides,
  } as SessionStreamEnvelope;
}

function renderViewer(
  opts: {
    shadowSessionId?: string;
    memberName?: string;
    canDirectMessage?: boolean;
    open?: boolean;
    onClose?: () => void;
  } = {},
) {
  const {
    shadowSessionId = "shadow-1",
    memberName = "小码",
    canDirectMessage = false,
    open = true,
    onClose = vi.fn(),
  } = opts;
  // AntApp 包裹（platform-shared-agents-card.test 惯例）：useNotify 走真实
  // App.useApp message（无 provider 时 message.* 为 undefined，notify 调用变
  // unhandled rejection）。
  return render(
    <AntApp>
      <ShadowSessionViewer
        open={open}
        onClose={onClose}
        shadowSessionId={shadowSessionId}
        memberName={memberName}
        groupId="group-1"
        memberId="mem-1"
        canDirectMessage={canDirectMessage}
      />
    </AntApp>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // SSE 流默认返回哑连接（close spy 由用例内覆盖断言；普通成员路径不建流）。
  mocks.streamShadowSession.mockReturnValue({ close: vi.fn(), getLastEventId: () => null });
  mocks.sendGroupDirectMessage.mockResolvedValue({
    shadow_session_id: "shadow-1",
    queued: false,
    mid_turn: false,
    carrier_run_id: "run-9",
  });
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

/* ── 影子直聊 quick（2026-09-02）：头部 / 输入区 / SSE / 三块对齐 ───────── */

describe("ShadowSessionViewer 头部 id 短码复制（session-panel 惯例对齐）", () => {
  it("显示 #id.slice(0,8) 短码按钮；点击复制完整影子会话 id", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mocks.getAgentSessionLogs.mockResolvedValue([]);
    renderViewer({ shadowSessionId: "shadow-1234567890abcdef" });

    const btn = screen.getByTestId("shadow-session-id-copy");
    expect(btn.textContent).toBe("#shadow-1");
    expect(btn.getAttribute("title")).toContain("shadow-1234567890abcdef");

    fireEvent.click(btn);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("shadow-1234567890abcdef"),
    );
  });
});

describe("ShadowSessionViewer 输入区权限（群主可发 / 普通成员只读）", () => {
  it("群主：输入框 + 发送 → sendGroupDirectMessage(gid, mid, {content})；成功清空且不重拉 logs（不本地 append）", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({ id: "l-inj", channel: "user_input", content_redacted: "@小码 看看这个" }),
    ]);
    renderViewer({ canDirectMessage: true });

    const input = await screen.findByLabelText("影子会话直聊输入");
    fireEvent.change(input, { target: { value: "单独说下白屏的复现步骤" } });
    fireEvent.click(screen.getByTestId("shadow-direct-send"));

    await waitFor(() =>
      expect(mocks.sendGroupDirectMessage).toHaveBeenCalledWith("group-1", "mem-1", {
        content: "单独说下白屏的复现步骤",
      }),
    );
    // 成功后草稿清空。
    await waitFor(() =>
      expect((screen.getByLabelText("影子会话直聊输入") as HTMLTextAreaElement).value).toBe(""),
    );
    // 本地不手动 append —— 不重拉回放（初始 1 次），行等 SSE 流回放。
    expect(mocks.getAgentSessionLogs).toHaveBeenCalledTimes(1);
  });

  it("普通成员：只读提示（SHADOW_READONLY_HINT），无输入框 / 不调发送 / 不建 SSE 流", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({ id: "l-inj", channel: "user_input", content_redacted: "@小码 看看这个" }),
    ]);
    renderViewer({ canDirectMessage: false });

    expect(await screen.findByText("@小码 看看这个")).toBeTruthy();
    expect(screen.getByTestId("shadow-direct-readonly").textContent).toBe(
      "仅群主可在此会话中对话",
    );
    expect(screen.queryByLabelText("影子会话直聊输入")).toBeNull();
    expect(mocks.sendGroupDirectMessage).not.toHaveBeenCalled();
    expect(mocks.streamShadowSession).not.toHaveBeenCalled();
  });
});

describe("ShadowSessionViewer SSE 实时流（群主视角）", () => {
  it("打开即订阅 streamShadowSession(shadowSid)；onLog 新行追加渲染、同 log_id 去重；关闭断流", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({
        id: "l-inj",
        run_id: "r-1",
        channel: "user_input",
        content_redacted: "@小码 看看这个",
      }),
    ]);
    const close = vi.fn();
    mocks.streamShadowSession.mockReturnValue({ close, getLastEventId: () => null });
    const onClose = vi.fn();
    const { rerender } = renderViewer({ canDirectMessage: true, onClose });

    await waitFor(() =>
      expect(mocks.streamShadowSession).toHaveBeenCalledWith(
        "shadow-1",
        expect.objectContaining({
          onLog: expect.any(Function),
          onError: expect.any(Function),
        }),
      ),
    );

    // SSE 实时行（直聊 user_input）→ 追加为用户 turn 气泡。
    const handlers = mocks.streamShadowSession.mock.calls[0]?.[1] as {
      onLog: (env: SessionStreamEnvelope) => void;
    };
    const env = makeEnvelope({
      log_id: "l-live-1",
      run_id: "r-2",
      channel: "user_input",
      content: "群主的直聊消息",
    });
    handlers.onLog(env);
    expect(await screen.findByText("群主的直聊消息")).toBeTruthy();

    // 同 log_id 重放（断线 resync / 轮后对账）→ 去重不翻倍。
    handlers.onLog(env);
    await waitFor(() => {
      expect(screen.getAllByText("群主的直聊消息")).toHaveLength(1);
    });

    // Drawer 关闭断流（open=false → effect cleanup 调 conn.close）。
    rerender(
      <ShadowSessionViewer
        open={false}
        onClose={onClose}
        shadowSessionId="shadow-1"
        memberName="小码"
        groupId="group-1"
        memberId="mem-1"
        canDirectMessage
      />,
    );
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});

describe("ShadowSessionViewer 工具行渲染（三块对齐：tool_call JSON 权威 / [TOOL_USE] 双发去重）", () => {
  it("进度视图：tool_call JSON 装配为工具段；stdout [TOOL_USE] 副本丢弃（工具名不翻倍）", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({
        id: "l-inj",
        channel: "user_input",
        content_redacted: "@小码 看看这个",
      }),
      makeLog({
        id: "l-tool",
        channel: "tool_call",
        content_redacted:
          '{"tool":"Bash","args":{"command":"pnpm build"},"tool_use_id":"t-1","success":true}',
      }),
      makeLog({
        id: "l-tool-echo",
        channel: "stdout",
        content_redacted:
          '[TOOL_USE] {"tool":"Bash","args":{"command":"pnpm build"},"tool_use_id":"t-1"}',
      }),
      makeLog({
        id: "l-tool-res",
        channel: "stdout",
        content_redacted: "[TOOL_RESULT] 构建成功",
      }),
    ]);
    renderViewer();
    expect(await screen.findByText("@小码 看看这个")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "进度" }));
    await waitFor(() => {
      // [TOOL_USE] 文本副本经 classifySessionLog 丢弃——Bash 工具行恰一条。
      expect(screen.getAllByText("Bash")).toHaveLength(1);
    });
  });
});

describe("ShadowSessionViewer token 徽标（三块对齐：thinking_tokens 行 → 轮 token）", () => {
  it("每 run 取最后一条 [SYSTEM:thinking_tokens] 末值挂 ↓N 徽标；行本身不进正文", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({
        id: "l-inj",
        channel: "user_input",
        content_redacted: "@小码 看看这个",
      }),
      makeLog({
        id: "l-tok-1",
        channel: "stdout",
        content_redacted: "[SYSTEM:thinking_tokens] 120",
      }),
      makeLog({
        id: "l-out",
        channel: "stdout",
        content_redacted: "[ASSISTANT] 定位完成",
      }),
      makeLog({
        id: "l-tok-2",
        channel: "stdout",
        content_redacted: "[SYSTEM:thinking_tokens] 502",
      }),
    ]);
    renderViewer();
    expect(await screen.findByText("@小码 看看这个")).toBeTruthy();

    // 轮尾徽标：末值 502（TurnTimeline TurnStatusBadge 消费 turn.outputTokens）。
    await waitFor(() => {
      expect(screen.getByText(/↓502/)).toBeTruthy();
    });
    // [SYSTEM:thinking_tokens] 协议行不渲染为正文。
    expect(screen.queryByText(/thinking_tokens/)).toBeNull();
  });

  it("无 thinking_tokens 行的轮不渲染 token 徽标", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({
        id: "l-inj",
        channel: "user_input",
        content_redacted: "@小码 看看这个",
      }),
      makeLog({
        id: "l-out",
        channel: "stdout",
        content_redacted: "[ASSISTANT] 收到",
      }),
    ]);
    renderViewer();
    expect(await screen.findByText("@小码 看看这个")).toBeTruthy();
    expect(screen.queryByText(/↓\d/)).toBeNull();
  });
});

describe("ShadowSessionViewer [[GROUP]] 转发段标记", () => {
  it("回复内 [[GROUP]]...[[/GROUP]] 段 → 「将转发到群」标签 + 剥协议标记；段外文本原样", async () => {
    mocks.getAgentSessionLogs.mockResolvedValue([
      makeLog({
        id: "l-inj",
        channel: "user_input",
        content_redacted: "@小码 白屏修复了吗",
      }),
      makeLog({
        id: "l-out",
        channel: "stdout",
        content_redacted:
          "[ASSISTANT] [[GROUP]]\n已修复：白屏是构建产物缺失\n[[/GROUP]]\n细节我先在影子里核对",
      }),
    ]);
    renderViewer();
    await waitFor(() => {
      const md = screen.getAllByTestId("markdown-text").map((n) => n.textContent).join("\n");
      // 转发段：标签 + 原文（引用块前缀）+ 剥 [[GROUP]] 协议标记。
      expect(md).toContain(GROUP_FORWARD_LABEL);
      expect(md).toContain("已修复：白屏是构建产物缺失");
      expect(md).not.toContain("[[GROUP]]");
      // 段外文本原样保留。
      expect(md).toContain("细节我先在影子里核对");
    });
  });
});

describe("影子直聊纯函数（parseShadowThinkingTokens / markGroupForwardText / mergeSnapshotWithLive）", () => {
  it("parseShadowThinkingTokens：单值 / 多值取末值 / 千分位 / 非该行 → null", () => {
    expect(parseShadowThinkingTokens("[SYSTEM:thinking_tokens] 502")).toBe(502);
    expect(parseShadowThinkingTokens("[SYSTEM:thinking_tokens] 120 · 502")).toBe(502);
    expect(parseShadowThinkingTokens("[SYSTEM:thinking_tokens] 1,234")).toBe(1234);
    expect(parseShadowThinkingTokens("[ASSISTANT] 正文")).toBeNull();
    expect(parseShadowThinkingTokens("[SYSTEM:thinking_tokens] abc")).toBeNull();
    expect(parseShadowThinkingTokens("")).toBeNull();
  });

  it("markGroupForwardText：无标记原样返回；多行段逐行引用块前缀", () => {
    expect(markGroupForwardText("普通回复")).toBe("普通回复");
    const out = markGroupForwardText(
      "[[GROUP]]\n第一行\n第二行\n[[/GROUP]]",
    );
    expect(out).toContain(GROUP_FORWARD_LABEL);
    expect(out).toContain("> 第一行");
    expect(out).toContain("> 第二行");
    expect(out).not.toContain("[[GROUP]]");
  });

  it("mergeSnapshotWithLive：快照替换保留实时行（liveIds 命中且快照未含），按 id 去重 + 时间排序", () => {
    const snap = makePage(1, 0); // 06:00
    const live = makeLog({
      id: "l-live",
      run_id: "r-2",
      timestamp: "2026-09-01T05:30:00Z", // 早于快照首行——排序插前
      channel: "user_input",
      content_redacted: "实时行",
    });
    const merged = mergeSnapshotWithLive(snap, [live], new Set(["l-live"]));
    expect(merged.map((r) => r.id)).toEqual(["l-live", snap[0]!.id]);

    // 快照已含同 id → 去重（实时行让位快照版本）。
    const mergedDedup = mergeSnapshotWithLive(
      [...snap, live],
      [live],
      new Set(["l-live"]),
    );
    expect(mergedDedup.filter((r) => r.id === "l-live")).toHaveLength(1);

    // liveIds 未命中（非实时行，如搜索结果）→ 快照替换不含。
    const mergedDrop = mergeSnapshotWithLive(snap, [live], new Set());
    expect(mergedDrop.map((r) => r.id)).toEqual([snap[0]!.id]);
  });
});
