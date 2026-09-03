/**
 * GroupChatPanel 单测（2026-09-01-session-group-chat task-08 / FR-05 / FR-09 /
 * FR-12 / FR-13 / D-011，design §7 平铺时间线 + §5.4 typing）。
 *
 * 依据：
 *   - components/group-chat/group-chat-panel.tsx（本 task 实现）
 *   - tasks/task-08.md acceptance：多成员消息流按全局 timestamp 正确交错分组、
 *     刷新回放与实时的顺序/身份一致、断线重连 resync 不丢行不错序、typing
 *     气泡正常出现/消失、@提及高亮与发送链路可用、tsc 与组件测试零错误
 *   - lib/daemon.ts streamGroupChat（task-08 群流 SSE 封装——本套件真模块消费）
 *
 * 覆盖：
 *   1. 平铺时间线纯函数——sortGroupTimeline 乱序归并（实时与回放同一排序
 *      函数）、applyGroupTimelineEvent 的 log_id 去重 / 完整行吞噬半截前缀行 /
 *      stale 令箭按 segmentId 撤回、entryFromReplayLog 身份还原（sender/
 *      member metadata + 噪音行丢弃）；
 *   2. 装配（真 streamGroupChat 经路由 fetch 假 SSE 流，daemon-session-stream-sync
 *      同款惯例）——回放身份分组渲染（多发送者 user 气泡 + self 右对齐 + agent
 *      成员气泡 + [ASSISTANT] 前缀剥除）、实时 SSE 乱序追加与回放同一时间轴、
 *      实时+回放同 log_id 不双条；
 *   3. 流式——partial 半截行光标出现 / turn_completed（member_id）光标收口；
 *   4. typing——SSE typing 分支气泡出现（成员昵称+预览）、TTL 2.5s 过期消失、
 *      typing=false 显式收口；
 *   5. 输入区——@补全（member kind：过滤 + 键盘回填 @昵称）、Enter 发送
 *      sendGroupMessage 调用参数、typing 上报（节流首跳 typing=true + preview
 *      尾 400 字、发送后 typing=false）；
 *   6. 气泡视觉 token（群聊体验对齐 quick）——self/agent/他人气泡语义类与会话
 *      TurnTimeline conversation 视图一致 + typing 走 .sh-typing-dots。
 *
 * mock 策略（对齐 member-panel.test + daemon-session-stream-sync.test 惯例）：
 *   - @/lib/daemon importActual 部分覆写：群 CRUD/发送/typing 上报 mock 断言；
 *     streamGroupChat / getAgentSessionLogs / maxLogTimestamp 保真——经路由
 *     fetch（/stream 假 SSE 流 + /logs JSON）驱动真实 SSE 消费循环；
 *   - @/stores/session（apiFetch bearer + 面板当前用户 id）、useNotify、
 *     MemberPanel 数据源 hook（machines/providers/profiles/workspaces）逐一 mock。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Modal } from "antd";

import {
  GroupChatPanel,
  GROUP_TYPING_TTL_MS,
  agentTypingKeyCandidates,
  applyGroupTimelineEvent,
  applyReplyingEvent,
  applyTypingEvent,
  buildTimelineFromReplay,
  containsMentionAll,
  entryFromReplayLog,
  parseReplySnapshot,
  pruneTypingIndicators,
  quoteHeadOf,
  removeReplyingMembers,
  sortGroupTimeline,
  type GroupReplyingMember,
  type GroupTypingIndicator,
} from "@/components/group-chat/group-chat-panel";
import type {
  GroupChatListItemRead,
  GroupReplayLogEntry,
} from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getGroupChat: vi.fn(),
  listGroupChats: vi.fn(),
  sendGroupMessage: vi.fn(),
  sendGroupTyping: vi.fn(),
  // quick 群 P2 置顶：PUT/DELETE /pinned mock 断言。
  pinGroupMessage: vi.fn(),
  unpinGroupMessage: vi.fn(),
  // 群 P2 第二波：PUT /read 已读位点 mock 断言。
  markGroupRead: vi.fn(),
  machinesHook: vi.fn(),
  listProviders: vi.fn(),
  profilesHook: vi.fn(),
  listWorkspaces: vi.fn(),
  uploadSessionAttachment: vi.fn(),
  removeSessionAttachment: vi.fn(),
  // quick 群 P2 触发失败展示：notify warning 断言面（共享 spy）。
  notify: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daemon")>();
  return {
    ...actual,
    // 群 CRUD/发送/typing 上报：mock 断言（不走网络）。
    getGroupChat: (...args: unknown[]) => mocks.getGroupChat(...args),
    listGroupChats: (...args: unknown[]) => mocks.listGroupChats(...args),
    sendGroupMessage: (...args: unknown[]) => mocks.sendGroupMessage(...args),
    sendGroupTyping: (...args: unknown[]) => mocks.sendGroupTyping(...args),
    pinGroupMessage: (...args: unknown[]) => mocks.pinGroupMessage(...args),
    unpinGroupMessage: (...args: unknown[]) => mocks.unpinGroupMessage(...args),
    markGroupRead: (...args: unknown[]) => mocks.markGroupRead(...args),
    // streamGroupChat / getAgentSessionLogs / maxLogTimestamp / PROVIDER_META
    // 保真——真实 SSE 消费循环经路由 fetch 驱动。
  };
});

// apiFetch（真模块，replay /logs 路由用）读 bearer token；面板读当前用户 id。
vi.mock("@/stores/session", () => {
  const state = {
    user: { id: "u-me", email: "me@sillyhub.dev", displayName: "鲸落" },
    accessToken: null,
    refreshToken: null,
  };
  const useSession = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useSession.getState = () => state;
  return { useSession };
});

vi.mock("@/lib/api/session-attachments", () => ({
  // FR-05 补遗：群消息附件上传/移除 mock 断言（单聊上传端点复用）；预览拉取
  // 恒成功占位（附件条渲染测试只断言 chip 出现，不进真实 blob 链路）。
  uploadSessionAttachment: (...args: unknown[]) => mocks.uploadSessionAttachment(...args),
  removeSessionAttachment: (...args: unknown[]) => mocks.removeSessionAttachment(...args),
  fetchAttachmentObjectUrl: vi.fn(async () => "blob:attachment-preview"),
  fetchAttachmentBlob: vi.fn(async () => new Blob(["x"])),
}));

vi.mock("@/lib/use-daemon-machines", () => ({
  useDaemonMachines: () => mocks.machinesHook(),
}));

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: (...args: unknown[]) => mocks.listProviders(...args),
}));

vi.mock("@/lib/agent-profiles", () => ({
  useMineAgentProfiles: () => mocks.profilesHook(),
}));

vi.mock("@/lib/workspaces", () => ({
  listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
}));

vi.mock("@/lib/errors", () => ({
  errMessage: (err: unknown) =>
    err instanceof Error ? err.message : "操作失败",
  // 共享 spy（quick 群 P2 触发失败：断言 warning 逐条透传；各用例经 clearMocks
  // 隔离调用记录）。
  useNotify: () => mocks.notify,
}));

// quick 群聊 Markdown 渲染：MarkdownText 是 next/dynamic ssr:false 组件，
// jsdom 同步渲染 null（testing gotcha，agent-log-card.test 同款 mock 惯例）——
// 替身为透传 content 的 div，断言以 data-testid="markdown-text" 锚定。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

// quick 成员头像自定义：GroupMemberAvatar 经 fetchFileBlob 带 token 取 blob
// 渲染——mock 供头像用例（无头像固件不触发该链路）。
vi.mock("@/lib/file/api", () => ({
  fetchFileBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  uploadFile: vi.fn(),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
}));

// ── 路由 fetch 假 SSE 流（daemon-session-stream-sync.test 同款） ──────────

interface StreamHarness {
  calls: string[];
  stream: { push: (_text: string) => void } | null;
  /** 服务端关流（触发 fetch-sse onerror → 退避重连 → resync）。 */
  closeStream: () => void;
  logsJson: unknown;
  /** 可选（群 P3 分页 quick）：按 URL 动态响应 /logs——初始回放与 before 翻页
   *    需要返回不同页；未设时回退静态 logsJson。 */
  logsByUrl?: (url: string) => unknown;
}

let harness: StreamHarness;

function installRoutedFetchMock(): void {
  harness = { calls: [], stream: null, closeStream: () => {}, logsJson: [] };
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: URL | RequestInfo, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      harness.calls.push(url);
      if (url.includes("/stream")) {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        const encoder = new TextEncoder();
        harness.stream = {
          push: (text) => controller.enqueue(encoder.encode(text)),
        };
        harness.closeStream = () => controller.close();
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      if (url.includes("/logs")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              harness.logsByUrl ? harness.logsByUrl(url) : harness.logsJson,
            ),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    },
  );
}

/** 微任务排空（SSE 帧 → fetch-sse reader → onmessage dispatch 全链路）。 */
async function flushAsync(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** 推一条默认 data 帧并排空（payload 为群频道事件 JSON）。 */
async function pushSseEvent(payload: Record<string, unknown>): Promise<void> {
  if (!harness.stream) throw new Error("SSE stream not wired yet");
  await act(async () => {
    harness.stream!.push(`data: ${JSON.stringify(payload)}\n\n`);
    await Promise.resolve();
  });
}

// ── 固件 ─────────────────────────────────────────────────────────────────

function makeGroupDetail(): Record<string, unknown> {
  return {
    id: "g-1",
    session_id: "s-g-1",
    workspace_id: "ws-1",
    title: "前端攻坚小分队",
    created_by: "u-me",
    agent_cross_mention: true,
    cross_mention_depth: 2,
    context_window: 20,
    created_at: "2026-09-01T00:00:00Z",
    ended_at: null,
    deleted_at: null,
    members: [
      {
        id: "mem-1",
        member_type: "agent",
        display_name: "小码",
        runtime_id: "rt-1",
        provider: "claude",
        llm_provider_id: null,
        agent_profile_id: null,
        workspace_id: null,
        config_snapshot: null,
        invited_by: null,
        joined_at: "2026-09-01T00:00:00Z",
        removed_at: null,
        shadow_session_id: null,
        shadow_status: "none",
        // 群详情运行态兜底字段（群聊运行态可见 quick，2026-09-02）。
        shadow_running: false,
      },
      {
        id: "mem-2",
        member_type: "agent",
        display_name: "小测",
        runtime_id: "rt-2",
        provider: "codex",
        llm_provider_id: null,
        agent_profile_id: null,
        workspace_id: null,
        config_snapshot: null,
        invited_by: null,
        joined_at: "2026-09-01T00:00:00Z",
        removed_at: null,
        shadow_session_id: null,
        shadow_status: "none",
        shadow_running: false,
      },
      {
        id: "mem-3",
        member_type: "user",
        display_name: "鲸落",
        user_id: "u-me",
        invited_by: null,
        joined_at: "2026-09-01T00:00:00Z",
        removed_at: null,
        shadow_status: "none",
        shadow_running: false,
      },
      {
        id: "mem-4",
        member_type: "user",
        display_name: "林一",
        user_id: "u-lin",
        invited_by: null,
        joined_at: "2026-09-01T00:00:00Z",
        removed_at: null,
        shadow_status: "none",
        shadow_running: false,
      },
    ],
    online_member_ids: [],
    last_message: null,
  };
}

/** 回放日志固件：两发送者 user_input 行 + 两成员投影行 + 一条噪音行。 */
function makeReplayLogs(): GroupReplayLogEntry[] {
  return [
    {
      id: "l-1",
      run_id: "r-1",
      timestamp: "2026-09-01T06:05:00Z",
      channel: "user_input",
      content_redacted: "登录页偶现白屏，谁能看看？",
      metadata: { sender_member_name: "林一", sender_user_id: "u-lin" },
    },
    {
      id: "l-2",
      run_id: "r-2",
      timestamp: "2026-09-01T06:06:00Z",
      channel: "user_input",
      content_redacted: "@小码 帮我定位一下这个白屏问题",
      metadata: { sender_member_name: "鲸落", sender_user_id: "u-me" },
    },
    {
      id: "l-3",
      run_id: "r-2",
      timestamp: "2026-09-01T06:06:05Z",
      channel: "stdout",
      content_redacted: "[ASSISTANT] 已定位：问题在 hooks 依赖数组漏了 tenantId",
      metadata: { member_id: "mem-1", member_name: "小码" },
    },
    {
      id: "l-4",
      run_id: "r-3",
      timestamp: "2026-09-01T06:07:00Z",
      channel: "stdout",
      // 工具行（投影过滤后排不入时间线；前端分类器同口径兜底丢弃）。
      content_redacted: "[TOOL_USE] {\"name\":\"Read\"}",
      metadata: { member_id: "mem-2", member_name: "小测" },
    },
  ];
}

// ── 渲染助手 ─────────────────────────────────────────────────────────────

/** 本用例渲染的 QueryClient（乐观清零断言读缓存用；renderPanel 每次覆写）。 */
let panelQc: QueryClient | null = null;

function renderPanel(
  group: GroupChatListItemRead | null = null,
): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  panelQc = qc;
  return render(
    <QueryClientProvider client={qc}>
      <GroupChatPanel groupId="g-1" group={group} onSessionListRefresh={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** 装配就绪等待：群详情 + 回放 + SSE 建连（/stream 被路由 fetch 命中）。 */
async function waitForStreamWired(): Promise<void> {
  await waitFor(() => {
    expect(harness.calls.some((u) => u.includes("/stream"))).toBe(true);
    expect(harness.stream).toBeTruthy();
  });
  await flushAsync();
}

/** 按文档出现顺序取各消息行身份摘要（user=data-sender / agent=data-member-name）。 */
function timelineIdentities(): (string | null | undefined)[] {
  return Array.from(
    screen
      .getByTestId("group-chat-timeline")
      .querySelectorAll(
        "[data-testid='group-msg-user'],[data-testid='group-msg-agent']",
      ) as NodeListOf<HTMLElement>,
  ).map((el) => el.getAttribute("data-sender") ?? el.getAttribute("data-member-name"));
}

// ── 用例 ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  installRoutedFetchMock();
  mocks.getGroupChat.mockResolvedValue(makeGroupDetail());
  mocks.listGroupChats.mockResolvedValue([makeGroupDetail()]);
  mocks.sendGroupMessage.mockResolvedValue({
    carrier_run_id: "r-carrier",
    log_id: "l-sent",
    mentioned_member_ids: ["mem-1"],
    mention_all: false,
    triggered: [],
  });
  mocks.sendGroupTyping.mockResolvedValue(undefined);
  // quick 群 P2 置顶：默认成功（响应形态仅通知消费，不进断言）。
  mocks.pinGroupMessage.mockResolvedValue({
    log_id: "l-2",
    pinned_by: "u-me",
    pinned_at: "2026-09-01T07:00:00Z",
    content: "@小码 帮我定位一下这个白屏问题",
    member_name: "鲸落",
  });
  mocks.unpinGroupMessage.mockResolvedValue(undefined);
  // 群 P2 第二波：挂载标记已读默认成功（204）。
  mocks.markGroupRead.mockResolvedValue(undefined);
  mocks.machinesHook.mockReturnValue({
    items: [],
    sharedToMe: [],
    machineCandidates: [],
    total: 0,
    sessions: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.profilesHook.mockReturnValue({
    profiles: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mocks.listProviders.mockResolvedValue([]);
  mocks.listWorkspaces.mockResolvedValue({ items: [], total: 0 });
  mocks.uploadSessionAttachment.mockImplementation(async (_file: File, kind: string) => ({
    id: "att-upload-1",
    kind,
    media_type: "text/plain",
    bytes: 64,
    name: "报错日志.txt",
    created_at: "2026-09-01T00:00:00Z",
  }));
  mocks.removeSessionAttachment.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ── 1. 平铺时间线纯函数 ─────────────────────────────────────────────────── */

describe("平铺时间线纯函数（task-08 / D-011）", () => {
  it("sortGroupTimeline：多成员交错 timestamp 乱序注入 → 全局升序（实时与回放同一排序函数）", () => {
    const user = (id: string, ts: string) =>
      ({
        kind: "user",
        id,
        timestamp: ts,
        senderName: "林一",
        senderUserId: "u-lin",
        content: `消息-${id}`,
        isSelf: false,
        attachments: null,
        replyTo: null,
      }) as const;
    const agent = (id: string, ts: string, memberName: string) =>
      ({
        kind: "agent",
        id,
        timestamp: ts,
        memberId: "mem-1",
        memberName,
        memberSessionId: null,
        runId: "r-2",
        content: `回复-${id}`,
        segmentId: null,
      }) as const;
    // 乱序注入（模拟实时事件到达序与回放 run 锚序均不保证全局 timestamp 序）。
    const shuffled = [
      agent("a-3", "2026-09-01T06:06:10Z", "小码"),
      user("u-1", "2026-09-01T06:05:00Z"),
      agent("a-4", "2026-09-01T06:07:00Z", "小测"),
      user("u-2", "2026-09-01T06:06:00Z"),
      agent("a-2", "2026-09-01T06:05:30Z", "小码"),
    ];
    const sorted = sortGroupTimeline([...shuffled]);
    expect(sorted.map((e) => e.id)).toEqual([
      "u-1",
      "a-2",
      "u-2",
      "a-3",
      "a-4",
    ]);
    // 同拍稳定性：同 timestamp 两行按 id 定序（回放与实时重放确定性一致）。
    const tie = sortGroupTimeline([
      { ...user("u-b", "2026-09-01T06:05:00Z") },
      { ...user("u-a", "2026-09-01T06:05:00Z") },
    ]);
    expect(tie.map((e) => e.id)).toEqual(["u-a", "u-b"]);
  });

  it("applyGroupTimelineEvent：log_id 去重——实时与回放同 id 不双条", () => {
    const logs = makeReplayLogs();
    const entries = buildTimelineFromReplay(logs, "u-me");
    const seen = new Set(entries.map((e) => e.id));
    // 回放后实时 SSE 重放同 id（断线 resync -2s 重叠窗口场景）。
    const reLive = applyGroupTimelineEvent(entries, seen, {
      type: "entry",
      entry: {
        kind: "agent",
        id: "l-3",
        timestamp: "2026-09-01T06:06:05Z",
        memberId: "mem-1",
        memberName: "小码",
        memberSessionId: null,
        runId: "r-2",
        content: "重复行不应出现",
        segmentId: null,
      },
    });
    expect(reLive).toBe(entries); // 引用不变=未追加
    expect(reLive.filter((e) => e.id === "l-3")).toHaveLength(1);
  });

  it("applyGroupTimelineEvent：完整行吞噬同成员同 run 的半截前缀行 + stale 令箭按 segmentId 撤回", () => {
    const seen = new Set<string>();
    let entries = sortGroupTimeline([]);
    const partial = {
      type: "entry",
      entry: {
        kind: "agent",
        id: "l-p1",
        timestamp: "2026-09-01T06:06:10Z",
        memberId: "mem-1",
        memberName: "小码",
        memberSessionId: null,
        runId: "r-2",
        content: "已定位",
        segmentId: "main:seg-1",
      },
    } as const;
    entries = applyGroupTimelineEvent(entries, seen, partial);
    expect(entries).toHaveLength(1);
    // 完整行到达（segment_id=null，文本含半截前缀）→ 替换而非双条。
    entries = applyGroupTimelineEvent(entries, seen, {
      type: "entry",
      entry: {
        kind: "agent",
        id: "l-c1",
        timestamp: "2026-09-01T06:06:12Z",
        memberId: "mem-1",
        memberName: "小码",
        memberSessionId: null,
        runId: "r-2",
        content: "已定位：hooks 依赖漏了 tenantId",
        segmentId: null,
      },
    });
    expect(entries.map((e) => e.id)).toEqual(["l-c1"]);
    // stale 撤回令箭（segmentId 定位）→ 移除目标半截行。
    entries = applyGroupTimelineEvent(entries, seen, {
      type: "entry",
      entry: {
        kind: "agent",
        id: "l-p2",
        timestamp: "2026-09-01T06:06:14Z",
        memberId: "mem-1",
        memberName: "小码",
        memberSessionId: null,
        runId: "r-2",
        content: "修复方案",
        segmentId: "main:seg-2",
      },
    });
    expect(entries).toHaveLength(2);
    entries = applyGroupTimelineEvent(entries, seen, {
      type: "revoke",
      segmentId: "main:seg-2",
    });
    expect(entries.map((e) => e.id)).toEqual(["l-c1"]);
  });

  it("entryFromReplayLog：身份还原（sender/member metadata）+ 噪音行丢弃 + [ASSISTANT] 前缀剥除", () => {
    const logs = makeReplayLogs();
    const userOther = entryFromReplayLog(logs[0]!, "u-me");
    expect(userOther).toMatchObject({
      kind: "user",
      senderName: "林一",
      isSelf: false,
    });
    const userSelf = entryFromReplayLog(logs[1]!, "u-me");
    expect(userSelf).toMatchObject({ kind: "user", senderName: "鲸落", isSelf: true });
    const agentEntry = entryFromReplayLog(logs[2]!, "u-me");
    expect(agentEntry).toMatchObject({
      kind: "agent",
      memberId: "mem-1",
      memberName: "小码",
      content: "已定位：问题在 hooks 依赖数组漏了 tenantId",
    });
    // [TOOL_USE] 行（服务端投影过滤漏网兜底）不进群时间线。
    expect(entryFromReplayLog(logs[3]!, "u-me")).toBeNull();
    // segment_id 透传（收口：后端 DTO 已暴露，partial 半截行回放可撤回标记）。
    expect(entryFromReplayLog({ ...logs[2]!, segment_id: "seg-x" }, "u-me")).toMatchObject(
      { kind: "agent", segmentId: "seg-x" },
    );
    // metadata 缺省兜底（DTO 已暴露 metadata；旧行/异常缺列仍占位不抛错）。
    expect(
      entryFromReplayLog(
        { ...logs[0]!, metadata: null },
        "u-me",
      ),
    ).toMatchObject({ kind: "user", senderName: "成员", isSelf: false });
  });

  it("parseReplySnapshot/quoteHeadOf（群 P2 引用快照守卫 + 摘要口径）：log_id 缺失 → null；摘要空白折叠 + 60 截断", () => {
    // 回放/实时同构快照守卫。
    expect(
      parseReplySnapshot({ log_id: "l-1", member_name: "林一", content_head: "白屏" }),
    ).toEqual({ log_id: "l-1", member_name: "林一", content_head: "白屏" });
    expect(parseReplySnapshot(null)).toBeNull();
    expect(parseReplySnapshot(undefined)).toBeNull();
    // log_id 缺失/空串 → 不渲染引用条（畸形数据容错）。
    expect(parseReplySnapshot({ member_name: "林一", content_head: "白屏" })).toBeNull();
    expect(parseReplySnapshot({ log_id: "  ", member_name: "林一" })).toBeNull();
    // 摘要：空白折叠为单空格 + 60 字截断（对齐后端 content_head(60)）。
    expect(quoteHeadOf("  多行\n\n消息  ")).toBe("多行 消息");
    expect(quoteHeadOf("x".repeat(80)).length).toBe(60);
    // entryFromReplayLog：metadata.reply_to → user 条目 replyTo（缺省 null）。
    const entry = entryFromReplayLog(
      {
        ...logsFixtureUserRow(),
        metadata: {
          sender_member_name: "林一",
          sender_user_id: "u-lin",
          reply_to: { log_id: "l-0", member_name: "小码", content_head: "旧消息" },
        },
      },
      "u-me",
    );
    expect(entry).toMatchObject({
      kind: "user",
      replyTo: { log_id: "l-0", member_name: "小码", content_head: "旧消息" },
    });
    expect(entryFromReplayLog(logsFixtureUserRow(), "u-me")).toMatchObject({
      replyTo: null,
    });
  });
});

/** 引用回复纯函数用例的最小 user_input 回放行固件。 */
function logsFixtureUserRow(): GroupReplayLogEntry {
  return {
    id: "l-rq",
    run_id: "r-1",
    timestamp: "2026-09-01T06:05:00Z",
    channel: "user_input",
    content_redacted: "登录页偶现白屏，谁能看看？",
    metadata: { sender_member_name: "林一", sender_user_id: "u-lin" },
  };
}

/* ── 1b. typing/回复锚点纯函数（群聊运行态可见 quick，2026-09-02） ─────────── */

describe("typing/回复锚点纯函数（群聊运行态可见 quick）", () => {
  it("applyTypingEvent：agent 事件不设 TTL（expiresAt=null）——10s 裁剪仍在；用户事件 2.5s TTL 过期", () => {
    const now = Date.parse("2026-09-02T06:00:00Z");
    let map: Record<string, GroupTypingIndicator> = {};
    map = applyTypingEvent(map, {
      member_name: "小码",
      member_id: "mem-1",
      member_kind: "agent",
      typing: true,
      preview: null,
    }, now);
    map = applyTypingEvent(map, {
      member_name: "林一",
      member_kind: "user",
      typing: true,
      preview: "草稿",
    }, now);
    // 键空间：agent 按 member_id、用户按昵称。
    expect(map["agent:mem-1"]!.expiresAt).toBeNull();
    expect(map["user:林一"]!.expiresAt).toBe(now + GROUP_TYPING_TTL_MS);
    // 越过 10s（远超 2.5s TTL）裁剪：agent 持续态豁免，用户过期回收。
    const pruned = pruneTypingIndicators(map, now + 10_000);
    expect(pruned["agent:mem-1"]).toBeTruthy();
    expect(pruned["user:林一"]).toBeUndefined();
    // 止息（typing:false 带 member_id）→ 移除。
    const stopped = applyTypingEvent(pruned, {
      member_name: "小码",
      member_id: "mem-1",
      member_kind: "agent",
      typing: false,
    }, now + 11_000);
    expect(stopped["agent:mem-1"]).toBeUndefined();
    // 老形态兼容（无 member_id）：昵称键，止息同键清理。
    let legacy: Record<string, GroupTypingIndicator> = {};
    legacy = applyTypingEvent(legacy, {
      member_name: "小测",
      member_kind: "agent",
      typing: true,
    }, now);
    expect(legacy["agent:小测"]!.expiresAt).toBeNull();
    legacy = applyTypingEvent(legacy, {
      member_name: "小测",
      member_kind: "agent",
      typing: false,
    }, now);
    expect(legacy["agent:小测"]).toBeUndefined();
  });

  it("applyReplyingEvent：锚点 typing:true 挂对应消息（同消息多成员、重复事件去重）；止息按成员键全表移除；turn_completed 候选键收口", () => {
    let map: Record<string, GroupReplyingMember[]> = {};
    const start = (name: string, id: string, logId: string) => ({
      member_name: name,
      member_id: id,
      member_kind: "agent",
      typing: true,
      reply_to_log_id: logId,
    });
    map = applyReplyingEvent(map, start("小码", "mem-1", "l-2"));
    map = applyReplyingEvent(map, start("小测", "mem-2", "l-2"));
    // 同成员重复 typing 心跳（去重，不双标签）。
    map = applyReplyingEvent(map, start("小码", "mem-1", "l-2"));
    expect(map["l-2"]!.map((r) => r.memberName)).toEqual(["小码", "小测"]);
    // 无锚点 agent 事件（互@触发）不入表（走 typing 指示条）。
    map = applyReplyingEvent(map, {
      member_name: "小码",
      member_id: "mem-1",
      member_kind: "agent",
      typing: true,
      reply_to_log_id: null,
    });
    expect(map["l-2"]).toHaveLength(2);
    // 用户事件恒不入表。
    map = applyReplyingEvent(map, {
      member_name: "林一",
      member_kind: "user",
      typing: true,
      reply_to_log_id: "l-2",
    });
    expect(map["l-2"]).toHaveLength(2);
    // 止息帧不带锚点 → 按成员键从所有消息移除。
    map = applyReplyingEvent(map, {
      member_name: "小测",
      member_id: "mem-2",
      member_kind: "agent",
      typing: false,
    });
    expect(map["l-2"]!.map((r) => r.memberName)).toEqual(["小码"]);
    // turn_completed 收口：agentTypingKeyCandidates（member_id+昵称双键）移除。
    map = removeReplyingMembers(
      map,
      agentTypingKeyCandidates("mem-1", "小码"),
    );
    expect(map["l-2"]).toBeUndefined();
  });
});

/* ── 2. 装配：回放 + 实时 SSE 消费 ─────────────────────────────────────── */

describe("GroupChatPanel 装配（真 streamGroupChat SSE 消费）", () => {
  it("回放读库渲染：多发送者用户气泡（self 右对齐）+ agent 成员气泡 + @提及高亮 + 成员面板右列", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();

    // 身份分组：林一（左）→ 鲸落（self 右）→ 小码（agent）。
    expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    const selfRow = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-user'][data-self='true']",
    );
    expect(selfRow).toBeTruthy();
    expect(selfRow!.getAttribute("data-sender")).toBe("鲸落");
    // [ASSISTANT] 前缀剥除后正文完整。
    expect(screen.getByText(/已定位：问题在 hooks 依赖数组漏了 tenantId/)).toBeTruthy();
    // @提及高亮（成员昵称集命中）。
    expect(screen.getAllByTestId("group-mention").length).toBeGreaterThan(0);
    // 右列成员面板（task-09）就位。
    expect(await screen.findByTestId("group-member-panel")).toBeTruthy();
  });

  it("实时 SSE 乱序追加与回放同一时间轴：迟到 user 行插入正确位置 + 同 log_id 不双条", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);

    // 实时事件：timestamp 介于 l-1 与 l-2 之间（run 锚分组会把它吸回 r-1 组，
    // 平铺时间线按全局 timestamp 归位——D-011）。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-9",
      log_id: "l-9",
      channel: "user_input",
      content: "补充：只出现在生产环境",
      timestamp: "2026-09-01T06:05:30Z",
      sender_member_name: "林一",
      sender_user_id: "u-lin",
    });
    expect(timelineIdentities()).toEqual(["林一", "林一", "鲸落", "小码"]);

    // 实时 + 回放同 id（resync 重叠窗口重放）：不双条。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-2",
      log_id: "l-3",
      channel: "stdout",
      content: "[ASSISTANT] 已定位：问题在 hooks 依赖数组漏了 tenantId",
      timestamp: "2026-09-01T06:06:05Z",
      member_id: "mem-1",
      member_name: "小码",
    });
    expect(timelineIdentities()).toEqual(["林一", "林一", "鲸落", "小码"]);
    expect(
      screen.getAllByText(/已定位：问题在 hooks 依赖数组漏了 tenantId/),
    ).toHaveLength(1);
  });

  it("上滚读历史时他人发言不拽底；自己发送仍强制回底（ql-20260903-002）", async () => {
    // 群时间线所有成员的发言都是 kind:"user"（isSelf 只用于气泡左右侧）——
    // 修复前 own-send 判定未过滤 isSelf，他人发言同样触发强制回底，把上滚
    // 读历史的视口拽到底。jsdom Element.scrollTo 未实现（生产代码有 typeof
    // 守卫），挂载期 effect 全部早退——stub 成 mock 后才进入真实分支。
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();

    const el = screen.getByTestId("group-chat-timeline");
    const scrollToMock = vi.fn();
    Object.defineProperty(el, "scrollTo", {
      value: scrollToMock,
      configurable: true,
    });
    // 布局：scrollHeight=1000 / clientHeight=500 → scrollTop=0 时距底 500 > 80。
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 500 });

    // stub 后首个 entries 变化消费「首帧无条件回底」分支（挂载期被守卫早退）。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-20",
      log_id: "l-20",
      channel: "stdout",
      content: "[ASSISTANT] 基线轮（消费首帧分支）",
      timestamp: "2026-09-01T06:30:00Z",
      member_id: "mem-1",
      member_name: "小码",
    });
    await flushAsync();
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    scrollToMock.mockClear();

    // 用户上滚读历史（scrollTop=0 → nearBottomRef=false）。
    el.scrollTop = 0;
    await act(async () => {
      fireEvent.scroll(el);
    });

    // 他人（林一）发新消息：不强制回底（修复点）。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-21",
      log_id: "l-21",
      channel: "user_input",
      content: "别人的新消息（不应拽底）",
      timestamp: "2026-09-01T07:00:00Z",
      sender_member_name: "林一",
      sender_user_id: "u-lin",
    });
    await flushAsync();
    expect(screen.getByText("别人的新消息（不应拽底）")).toBeTruthy();
    expect(scrollToMock).not.toHaveBeenCalled();

    // 自己（u-me）发送新消息：强制回底。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-22",
      log_id: "l-22",
      channel: "user_input",
      content: "我的新消息（应回底）",
      timestamp: "2026-09-01T07:01:00Z",
      sender_member_name: "鲸落",
      sender_user_id: "u-me",
    });
    await flushAsync();
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith(0, 1000);
  });

  it("流式光标：partial 半截行点亮 → turn_completed（member_id）收口", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-2",
      log_id: "l-p1",
      channel: "stdout",
      content: "[ASSISTANT] 分析中",
      timestamp: "2026-09-01T06:06:10Z",
      segment_id: "main:seg-1",
      member_id: "mem-1",
      member_name: "小码",
      member_session_id: "shadow-1",
    });
    expect(screen.getByTestId("group-stream-cursor")).toBeTruthy();

    await pushSseEvent({
      event: "turn_completed",
      session_id: "s-g-1",
      run_id: "shadow-run-1",
      status: "completed",
      exit_code: 0,
      timestamp: "2026-09-01T06:06:20Z",
      member_id: "mem-1",
      member_name: "小码",
      member_session_id: "shadow-1",
    });
    await flushAsync();
    expect(screen.queryByTestId("group-stream-cursor")).toBeNull();
    // 半截行正文保留（收口不清内容，只停光标）。
    expect(screen.getByText("分析中")).toBeTruthy();
  });

  it("断线重连 resync：读库归并不丢行不错序（重叠窗口回放同 id 去重）", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();

    // 实时行（游标推进至 06:06:30）。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-9",
      log_id: "l-live",
      channel: "user_input",
      content: "实时行",
      timestamp: "2026-09-01T06:06:30Z",
      sender_member_name: "鲸落",
      sender_user_id: "u-me",
    });
    expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码", "鲸落"]);

    // 断连窗口缺口行已落库（服务端发布丢失场景）→ 服务端关流触发退避重连，
    // resync 走 /logs 增量回放（after=游标-2s 重叠）按时间轴归并。
    harness.logsJson = [
      ...makeReplayLogs(),
      {
        id: "l-gap",
        run_id: "r-10",
        timestamp: "2026-09-01T06:06:40Z",
        channel: "user_input",
        content_redacted: "断线窗口行",
        metadata: { sender_member_name: "林一", sender_user_id: "u-lin" },
      },
      {
        id: "l-agent-gap",
        run_id: "r-10",
        timestamp: "2026-09-01T06:06:45Z",
        channel: "stdout",
        content_redacted: "[ASSISTANT] 回归视角：建议补 E2E 用例",
        metadata: { member_id: "mem-2", member_name: "小测" },
      },
    ];
    act(() => {
      harness.closeStream();
    });
    await waitFor(
      () => {
        expect(timelineIdentities()).toEqual([
          "林一",
          "鲸落",
          "小码",
          "鲸落",
          "林一",
          "小测",
        ]);
      },
      { timeout: 5000 },
    );
    // 重连后 /logs（resync 回放）与 /stream（重建连接）都被再次命中。
    expect(harness.calls.filter((u) => u.includes("/logs")).length).toBeGreaterThanOrEqual(2);
    expect(harness.calls.filter((u) => u.includes("/stream")).length).toBeGreaterThanOrEqual(2);
    // 重叠窗口回放的已见行（l-live 06:06:30 > after=06:06:28）不双条。
    expect(
      screen.getAllByText("实时行").filter(
        (el) =>
          el.closest("[data-testid='group-chat-timeline']") !== null,
      ),
    ).toHaveLength(1);
  }, 10_000);

  it("typing 气泡：用户 TTL 2.5s 过期消失；agent 持续态不过期、止息移除（群聊运行态可见 quick）", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    // 出现：用户成员 typing=true 带 preview。
    await pushSseEvent({
      event: "typing",
      member_name: "林一",
      member_kind: "user",
      typing: true,
      preview: "我这边复现了",
      ts: "2026-09-01T06:06:00Z",
    });
    expect(await screen.findByTestId("group-typing-bubble")).toBeTruthy();
    const userBubble = screen.getAllByTestId("group-typing-bubble")[0]!;
    expect(within(userBubble).getByText("林一")).toBeTruthy();
    expect(within(userBubble).getByText(/我这边复现了/)).toBeTruthy();

    // agent typing（后端代发，带 member_id）：显示成员昵称 + 正在生成回复。
    await pushSseEvent({
      event: "typing",
      member_name: "小码",
      member_id: "mem-1",
      member_kind: "agent",
      typing: true,
      preview: null,
      ts: "2026-09-01T06:06:01Z",
    });
    expect(screen.getAllByTestId("group-typing-bubble")).toHaveLength(2);

    // 越过用户 TTL 2.5s（500ms 裁剪周期）：用户指示器过期消失；agent 持续态
    // **不设 TTL**（止息信号才移除——run 可能跑数分钟，TTL 会错杀）恒在。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3200));
    });
    const afterTtl = screen.getAllByTestId("group-typing-bubble");
    expect(afterTtl).toHaveLength(1);
    expect(afterTtl[0]!.textContent).toContain("小码");
    expect(afterTtl[0]!.textContent).toContain("正在生成回复");

    // agent 止息（run 终态 typing:false 带 member_id/member_name）→ 移除。
    await pushSseEvent({
      event: "typing",
      member_name: "小码",
      member_id: "mem-1",
      member_kind: "agent",
      typing: false,
      preview: null,
      ts: "2026-09-01T06:06:30Z",
    });
    await waitFor(() => {
      expect(screen.queryByTestId("group-typing-bubble")).toBeNull();
    });
  }, 12_000);

  it("「正在回复」标签挂触发消息下方（reply_to_log_id 锚点）：@全体两成员两标签；止息/turn_completed 移除；锚定成员不重复占 typing 指示条", async () => {
    harness.logsJson = makeReplayLogs(); // l-2 = 鲸落「@小码 帮我定位…」
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });

    // 两个 agent 同时锚定 l-2（@全体场景：同一条消息多个成员响应）。
    await pushSseEvent({
      event: "typing",
      member_name: "小码",
      member_id: "mem-1",
      member_kind: "agent",
      typing: true,
      preview: null,
      reply_to_log_id: "l-2",
      ts: "2026-09-01T06:06:02Z",
    });
    await pushSseEvent({
      event: "typing",
      member_name: "小测",
      member_id: "mem-2",
      member_kind: "agent",
      typing: true,
      preview: null,
      reply_to_log_id: "l-2",
      ts: "2026-09-01T06:06:03Z",
    });

    const anchorRow = await waitFor(() => {
      const row = document.querySelector<HTMLElement>(
        "[data-testid='group-msg-user'][data-log-id='l-2']",
      );
      expect(row).toBeTruthy();
      return row!;
    });
    await waitFor(() => {
      expect(
        within(anchorRow).getAllByTestId(/^replying-tag-/).map((el) =>
          el.getAttribute("data-testid"),
        ),
      ).toEqual(["replying-tag-mem-1", "replying-tag-mem-2"]);
    });
    // 标签文案 + 三点动画（.sh-typing-dots 复用）。
    const tag1 = within(anchorRow).getByTestId("replying-tag-mem-1");
    expect(tag1.textContent).toContain("小码 正在回复…");
    expect(tag1.querySelector(".sh-typing-dots")).toBeTruthy();
    // 锚定成员的运行态已挂消息下方，typing 指示条不重复出现。
    expect(screen.queryByTestId("group-typing-bubble")).toBeNull();

    // 止息（typing:false，帧不带锚点）→ 该成员标签移除（另一成员保留）。
    await pushSseEvent({
      event: "typing",
      member_name: "小码",
      member_id: "mem-1",
      member_kind: "agent",
      typing: false,
      preview: null,
      ts: "2026-09-01T06:06:20Z",
    });
    await waitFor(() => {
      expect(
        within(anchorRow).getAllByTestId(/^replying-tag-/).map((el) =>
          el.getAttribute("data-testid"),
        ),
      ).toEqual(["replying-tag-mem-2"]);
    });

    // turn_completed（member 身份）收口 → 标签移除（止息帧丢失的兜底路径）。
    await pushSseEvent({
      event: "turn_completed",
      session_id: "s-g-1",
      run_id: "shadow-run-2",
      status: "completed",
      exit_code: 0,
      timestamp: "2026-09-01T06:06:40Z",
      member_id: "mem-2",
      member_name: "小测",
      member_session_id: "shadow-2",
    });
    await waitFor(() => {
      expect(within(anchorRow).queryAllByTestId(/^replying-tag-/)).toHaveLength(0);
    });
  });

  it("详情 shadow_running 兜底：刷新回放即见运行态（typing 指示条 + 成员面板「运行中」徽标 + facepile 小绿点），不强挂消息", async () => {
    const detail = makeGroupDetail();
    const members = detail.members as Record<string, unknown>[];
    (members.find((m) => m.id === "mem-1") as Record<string, unknown>).shadow_running =
      true;
    mocks.getGroupChat.mockResolvedValue(detail);
    mocks.listGroupChats.mockResolvedValue([detail]);
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();

    // typing 指示条：小码（Agent）正在生成回复…（bootstrap 形态，preview=null）。
    const bubble = await screen.findByTestId("group-typing-bubble");
    expect(bubble.textContent).toContain("小码");
    expect(bubble.textContent).toContain("正在生成回复");
    // 详情无锚点关联 → 不强挂消息下方（诚实降级）。
    expect(screen.queryByTestId("replying-tags")).toBeNull();

    // 成员面板「运行中」徽标（runningMemberIds 透传）+ facepile 小绿点。
    await waitFor(() => {
      expect(screen.getByTestId("member-running-badge-mem-1")).toBeTruthy();
    });
    expect(screen.getByTestId("member-running-badge-mem-1").textContent).toContain(
      "运行中",
    );
    expect(screen.getByTestId("facepile-running-dot-mem-1")).toBeTruthy();
    // 未运行成员（小测/用户成员）无徽标无绿点。
    expect(screen.queryByTestId("member-running-badge-mem-2")).toBeNull();
    expect(screen.queryByTestId("facepile-running-dot-mem-2")).toBeNull();
  });
});

/* ── 2b. 气泡视觉 token（群聊体验对齐 quick：会话 TurnTimeline 同款） ────── */

describe("GroupChatPanel 气泡视觉 token（会话 conversation 视图同款，quick）", () => {
  it("用户 self 气泡：rounded-2xl rounded-br-md bg-primary；agent/他人卡片：rounded-2xl rounded-tl-md border bg-card + 成员名行", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });

    // self 用户消息（鲸落）：会话用户气泡同款（右对齐 + primary 实底 + 右下收角）。
    const selfRow = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-user'][data-self='true']",
    );
    expect(selfRow).toBeTruthy();
    const selfBubble = selfRow!.querySelector(
      "[class*='rounded-br-md']",
    ) as HTMLElement | null;
    expect(selfBubble).toBeTruthy();
    expect(selfBubble!.className).toContain("bg-primary");
    expect(selfBubble!.className).toContain("rounded-2xl");

    // 他人用户消息（林一）：左侧头像 + 成员名行 + 会话卡片样式（tl 收角 + border bg-card）。
    const otherRow = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-user'][data-sender='林一']",
    );
    expect(otherRow).toBeTruthy();
    const otherName = otherRow!.querySelector(
      "span.font-semibold",
    ) as HTMLElement | null;
    expect(otherName?.textContent).toBe("林一");
    const otherBubble = otherRow!.querySelector(
      "[class*='rounded-tl-md']",
    ) as HTMLElement | null;
    expect(otherBubble).toBeTruthy();
    expect(otherBubble!.className).toContain("border");
    expect(otherBubble!.className).toContain("bg-card");

    // agent 回复（小码）：成员名行 + 引擎标签位 + 卡片气泡（tl 收角 + border bg-card）。
    const agentRow = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-agent'][data-member-name='小码']",
    );
    expect(agentRow).toBeTruthy();
    const agentName = agentRow!.querySelector(
      "span.font-semibold",
    ) as HTMLElement | null;
    expect(agentName?.textContent).toBe("小码");
    const agentBubble = agentRow!.querySelector(
      "[class*='rounded-tl-md']",
    ) as HTMLElement | null;
    expect(agentBubble).toBeTruthy();
    expect(agentBubble!.className).toContain("bg-card");
    // 头像统一 28px 圆形（会话 h-7 w-7 rounded-full 惯例）。
    expect(agentRow!.querySelector("[class*='rounded-full']")).toBeTruthy();
  });

  it("typing 指示器气泡：会话卡片样式 + .sh-typing-dots 三点", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    await pushSseEvent({
      event: "typing",
      member_name: "林一",
      member_kind: "user",
      typing: true,
      preview: "我这边复现了",
      ts: "2026-09-01T06:06:00Z",
    });
    const bubble = await screen.findByTestId("group-typing-bubble");
    expect(bubble.className).toContain("rounded-2xl");
    expect(bubble.className).toContain("bg-card");
    expect(bubble.querySelector(".sh-typing-dots")).toBeTruthy();
  });
});

/* ── 3. 输入区：@补全 / 发送 / typing 上报 ─────────────────────────────── */

describe("GroupChatPanel 输入区（@补全 + 发送 + typing 上报）", () => {
  it("输入 @ → 群成员候选浮层（@全体 置顶）→ 键盘选中回填 @昵称", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "@" } });
    const popover = await screen.findByTestId("session-mention-popover");
    expect(popover.textContent).toContain("群成员");
    // buildMemberMentionItems 序：@全体 → agent（小码/小测）→ 用户（鲸落/林一）。
    //（主行 span = 选项行首层 flex 容器内的 .truncate，次行说明不进本断言。）
    expect(
      Array.from(
        popover.querySelectorAll(
          "[data-testid^='mention-option-'] > span > span.truncate",
        ),
      ).map((el) => el.textContent),
    ).toEqual(["全体", "小码", "小测", "鲸落", "林一"]);

    // ↓ 移到「小码」+ Enter 选中 → 回填 "@小码 " + 自动续 "@"（quick-23f25e3b
    // 连续选择：浮层保持打开可继续点选下一名成员；Esc/空白/Backspace 退出）。
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe("@小码 @");
    });
  });

  it("Enter 发送：sendGroupMessage 调用参数（groupId+原文）+ 清空输入框 + 发送后主动对账", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, {
      target: { value: "@小码 帮我定位一下这个白屏问题" },
    });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith(
        "g-1",
        "@小码 帮我定位一下这个白屏问题",
        // FR-05 补遗：无附件时第 3 参 undefined（不发 attachment_ids 键）。
        undefined,
        // 群 P2 引用回复：无引用时第 4 参 null（不发 reply_to_log_id 键）。
        null,
      ),
    );
    // 发送成功：清空输入框。
    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe("");
    });
    // 发送后主动对账（未 @ 消息无成员轮次，SSE 事件丢失时兜回显）：
    // streamGroupChat 为真实现——resync 触发 /logs 重拉（首次回放之后再来一次）。
    await waitFor(() => {
      const logsCalls = harness.calls.filter((u) => u.includes("/logs"));
      expect(logsCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("typing 上报：输入节流首跳 typing=true + preview 尾 400 字；发送后 typing=false", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    const input = screen.getByLabelText("群消息输入框");
    const draft = `开头${"x".repeat(600)}结尾`;
    fireEvent.change(input, { target: { value: draft } });
    await flushAsync(2);
    expect(mocks.sendGroupTyping).toHaveBeenCalledWith("g-1", {
      typing: true,
      preview: draft.slice(-400),
    });

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const calls = mocks.sendGroupTyping.mock.calls;
      const last = calls[calls.length - 1];
      expect(last?.[0]).toBe("g-1");
      expect(last?.[1]).toMatchObject({ typing: false });
    });
  });

  it("发送失败（队列满 409）：错误提示 + 输入框保留草稿", async () => {
    harness.logsJson = [];
    mocks.sendGroupMessage.mockRejectedValue(
      new Error("「小码」的队列已满，请稍候"),
    );
    renderPanel();
    await waitForStreamWired();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "@小码 再看一眼" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.sendGroupMessage).toHaveBeenCalledTimes(1));
    // 失败保留草稿（用户可重试）。
    await flushAsync(2);
    expect((input as HTMLTextAreaElement).value).toBe("@小码 再看一眼");
  });
});

/* ── 6. 群消息附件（FR-05 补遗：上传 chips / 发送参数 / 时间线附件条） ────── */

describe("群消息附件（FR-05 补遗）", () => {
  /** 触发隐藏 file input 的 change（jsdom 下手工构造 FileList 形态）。 */
  async function pickFile(name = "报错日志.txt", type = "text/plain"): Promise<void> {
    const fileInput = screen.getByLabelText("选择群消息附件") as HTMLInputElement;
    const file = new File(["x"], name, { type });
    Object.defineProperty(fileInput, "files", { value: [file] });
    await act(async () => {
      fireEvent.change(fileInput);
      await Promise.resolve();
    });
  }

  it("📎 选择文件即传 → 待发 chip 展示 → 移除调 removeSessionAttachment 且 chip 消失", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    await pickFile();
    await waitFor(() =>
      expect(mocks.uploadSessionAttachment).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      expect(
        screen.getAllByTestId("group-pending-attachment-chip").length,
      ).toBe(1);
    });
    // chip 文案含文件名。
    expect(screen.getByText("报错日志.txt")).toBeTruthy();

    // 移除：本地 chip 消失 + 服务端草稿行同步删。
    fireEvent.click(screen.getByLabelText("移除附件 报错日志.txt"));
    await waitFor(() =>
      expect(mocks.removeSessionAttachment).toHaveBeenCalledWith("att-upload-1"),
    );
    await waitFor(() => {
      expect(
        screen.queryByTestId("group-pending-attachment-chip"),
      ).toBeNull();
    });
  });

  it("带附件发送：sendGroupMessage 携带 attachment_ids + 成功后清空 chips（服务端不删）", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    await pickFile();
    await waitFor(() =>
      expect(
        screen.getAllByTestId("group-pending-attachment-chip").length,
      ).toBe(1),
    );

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "@小码 看下附件日志" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith(
        "g-1",
        "@小码 看下附件日志",
        ["att-upload-1"],
        null,
      ),
    );
    // 发送成功：chips 清空（附件已绑定群会话，不走 removeSessionAttachment）。
    await waitFor(() => {
      expect(screen.queryByTestId("group-pending-attachment-chip")).toBeNull();
    });
    expect(mocks.removeSessionAttachment).not.toHaveBeenCalled();
  });

  it("纯附件空文本可发（D-7 看图说话）：发送按钮不禁用 + 参数带附件", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    await pickFile();
    await waitFor(() =>
      expect(
        screen.getAllByTestId("group-pending-attachment-chip").length,
      ).toBe(1),
    );

    const sendBtn = screen.getByLabelText("发送群消息") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);
    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith("g-1", "", [
        "att-upload-1",
      ], null),
    );
  });

  it("时间线附件条：回放行 metadata.attachments → 用户气泡下方文件 chip（点击在线预览）", async () => {
    harness.logsJson = [
      {
        id: "l-att-1",
        run_id: "r-9",
        timestamp: "2026-09-01T06:05:00Z",
        channel: "user_input",
        content_redacted: "白屏时的报错日志",
        metadata: {
          sender_member_name: "林一",
          sender_user_id: "u-lin",
          attachments: [
            { file_id: "att-1", name: "报错日志.txt", size: 128, kind: "file" },
          ],
        },
      },
    ];
    renderPanel();
    await waitForStreamWired();

    await waitFor(() => {
      expect(screen.getByText("白屏时的报错日志")).toBeTruthy();
    });
    // 附件条：单聊 AttachmentChips 惯例（文件 chip 点击预览）。
    const chip = await waitFor(() =>
      screen.getByTitle("报错日志.txt（点击在线预览）"),
    );
    expect(chip).toBeTruthy();
    // 点击弹预览窗（FilePreviewModal 打开）。
    fireEvent.click(chip);
    await flushAsync(2);
  });

  it("实时 SSE log 事件带 attachments：气泡下方附件条即时渲染", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-live-1",
      log_id: "l-live-att-1",
      timestamp: "2026-09-01T06:08:00Z",
      channel: "user_input",
      content: "群里同步一份日志",
      sender_user_id: "u-lin",
      sender_member_name: "林一",
      attachments: [
        { file_id: "att-2", name: "同步日志.txt", size: 256, kind: "file" },
      ],
    });
    await waitFor(() => {
      expect(screen.getByText("群里同步一份日志")).toBeTruthy();
    });
    expect(
      await screen.findByTitle("同步日志.txt（点击在线预览）"),
    ).toBeTruthy();
  });
});

// ── 6. 成员头像渲染（quick 群成员头像自定义） ───────────────────────────────

describe("GroupChatPanel 成员头像（quick）", () => {  it("avatar 有值 → antd Avatar 图片（blob objectURL）；无值 → 首字回退", async () => {
    // 小码（agent）与鲸落（本人 user）带头像；林一（user）无头像。
    const detail = makeGroupDetail();
    const members = detail.members as Record<string, unknown>[];
    (members.find((m) => m.id === "mem-1") as Record<string, unknown>).avatar =
      "/api/file/f-av-agent";
    (members.find((m) => m.id === "mem-3") as Record<string, unknown>).avatar =
      "/api/file/f-av-me";
    mocks.getGroupChat.mockResolvedValue(detail);
    mocks.listGroupChats.mockResolvedValue([detail]);
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();

    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });

    // agent 气泡（小码）：头像 img（fetchFileBlob → objectURL）渲染。
    const agentBubble = screen
      .getByTestId("group-chat-timeline")
      .querySelector('[data-member-name="小码"]');
    expect(agentBubble).toBeTruthy();
    await waitFor(() => {
      const img = agentBubble!.querySelector(
        '[data-testid="group-member-avatar-img"] img',
      );
      expect(img).toBeTruthy();
      expect(img!.getAttribute("src")).toMatch(/^blob:/);
    });

    // 本人 user 气泡（鲸落，sender_user_id=u-me → avatarByUserId 命中）同样图片。
    const selfBubble = screen
      .getByTestId("group-chat-timeline")
      .querySelector('[data-sender="鲸落"]');
    expect(selfBubble).toBeTruthy();
    await waitFor(() => {
      expect(
        selfBubble!.querySelector(
          '[data-testid="group-member-avatar-img"] img',
        ),
      ).toBeTruthy();
    });

    // 无头像 user 气泡（林一）：首字回退（无 img）。
    const otherBubble = screen
      .getByTestId("group-chat-timeline")
      .querySelector('[data-sender="林一"]');
    expect(otherBubble).toBeTruthy();
    expect(
      otherBubble!.querySelector('[data-testid="group-member-avatar-initial"]'),
    ).toBeTruthy();
    expect(otherBubble!.querySelector("img")).toBeNull();
  });
});

// ── 7. 群聊 Markdown 渲染 + @我已读记忆（群聊体验 quick，2026-09-02）────────

describe("GroupChatPanel Markdown 渲染与已读记忆（quick）", () => {
  beforeEach(() => {
    // 已读记忆隔离（打开群写 now，跨用例残留属正常行为但断言须从零起步）。
    window.localStorage.removeItem("sillyhub-group-last-open-g-1");
  });

  it("agent 回复气泡走 MarkdownText（**bold** 原文透传渲染）；用户消息保持纯文本 + @提及高亮", async () => {
    harness.logsJson = [
      {
        id: "l-md-1",
        run_id: "r-1",
        timestamp: "2026-09-01T06:05:00Z",
        channel: "user_input",
        content_redacted: "@小码 用 **加粗** 说明下结论",
        metadata: { sender_member_name: "鲸落", sender_user_id: "u-me" },
      },
      {
        id: "l-md-2",
        run_id: "r-1",
        timestamp: "2026-09-01T06:06:00Z",
        channel: "stdout",
        content_redacted:
          "[ASSISTANT] 结论：**hooks 依赖数组漏了 tenantId**\n\n- 列表项一\n- 列表项二",
        metadata: { member_id: "mem-1", member_name: "小码" },
      },
    ];
    renderPanel();
    await waitForStreamWired();

    // agent 气泡：MarkdownText 替身渲染（jsdom 下真组件 next/dynamic 同步
    // null——gotcha；断言 **bold** 原文完整透传给 markdown 渲染层）。
    const mdNodes = await waitFor(() => {
      const nodes = screen.getAllByTestId("markdown-text");
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      return nodes;
    });
    expect(mdNodes[0]!.textContent).toContain("**hooks 依赖数组漏了 tenantId**");
    expect(mdNodes[0]!.textContent).toContain("- 列表项一");
    // [ASSISTANT] 前缀已剥除（classifySessionLog）。
    expect(mdNodes[0]!.textContent).not.toContain("[ASSISTANT]");

    // 用户气泡：纯文本路径保留——@提及高亮命中，原文不进 markdown 层。
    const userRow = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-user'][data-sender='鲸落']",
    );
    expect(userRow).toBeTruthy();
    expect(userRow!.querySelectorAll("[data-testid='group-mention']").length).toBe(1);
    expect(userRow!.querySelector("[data-testid='markdown-text']")).toBeNull();
  });

  it("流式 partial 也走 MarkdownText（不完整 md 容错同一容器）", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-2",
      log_id: "l-p-md",
      channel: "stdout",
      content: "[ASSISTANT] 生成中 **未闭合粗体",
      timestamp: "2026-09-01T06:06:10Z",
      segment_id: "main:seg-md",
      member_id: "mem-1",
      member_name: "小码",
    });
    await waitFor(() => {
      expect(screen.getByTestId("markdown-text").textContent).toContain(
        "生成中 **未闭合粗体",
      );
    });
    // 流式光标仍在（Markdown 与光标共存）。
    expect(screen.getByTestId("group-stream-cursor")).toBeTruthy();
  });

  it("打开群写已读记忆用服务端时间锚（回放 max ts / 实时事件 timestamp），空群不写（ql-20260903-007）", async () => {
    // 时钟域统一：已读锚与 last_mention.ts 同为服务端时钟——回放落地写
    // maxLogTimestamp（l-4 06:07:00 为最大 ts，工具行不入时间线但计入锚），
    // 实时事件写 env.timestamp 原值；空群（无消息=无 mention）不写锚。
    // 旧断言（挂载写客户端 now）作废：跨时钟域比较会吞 @ 红点。
    window.localStorage.clear();
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    expect(
      window.localStorage.getItem("sillyhub-group-last-open-g-1"),
    ).toBe("2026-09-01T06:07:00Z");

    // 实时行到达 → 锚 = 事件服务端 timestamp 原值（非本地时钟）。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-9",
      log_id: "l-read-1",
      channel: "user_input",
      content: "推进已读",
      timestamp: "2026-09-01T06:08:30Z",
      sender_member_name: "林一",
      sender_user_id: "u-lin",
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem("sillyhub-group-last-open-g-1"),
      ).toBe("2026-09-01T06:08:30Z");
    });

    // 空群（回放无日志）→ 不写锚（保留旧值，不用客户端时钟污染时钟域）。
    window.localStorage.clear();
    cleanup();
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();
    expect(
      window.localStorage.getItem("sillyhub-group-last-open-g-1"),
    ).toBeNull();
  });
});

/* ── 8. quick 群 P2：@全体二次确认 / 置顶 / 触发失败展示 ─────────────────── */

/** Modal.confirm spy（member-panel.test 同款）：模拟点「确认」（调 onOk）。 */
function spyConfirmOk() {
  return vi.spyOn(Modal, "confirm").mockImplementation((opts) => {
    opts.onOk?.(undefined as never);
    return { destroy: () => {} } as never;
  });
}

/** Modal.confirm spy：仅捕获不确认（点「取消」）。 */
function spyConfirmCancel() {
  return vi.spyOn(Modal, "confirm").mockImplementation((opts) => {
    opts.onCancel?.(undefined as never);
    return { destroy: () => {} } as never;
  });
}

describe("containsMentionAll（@全体 判定纯函数，quick 群 P2）", () => {
  it("@全体/@all（含全角 ＠）命中；@词缀/无 @ 不命中", () => {
    expect(containsMentionAll("@全体 开会")).toBe(true);
    expect(containsMentionAll("@all go")).toBe(true);
    expect(containsMentionAll("＠全体")).toBe(true);
    expect(containsMentionAll("先说明 @全体")).toBe(true);
    // token 口径：@ 后首个非空白词须恰为 全体/all。
    expect(containsMentionAll("@全体成员")).toBe(false);
    expect(containsMentionAll("全体")).toBe(false);
    expect(containsMentionAll("@小码")).toBe(false);
  });
});

describe("GroupChatPanel @全体 二次确认（quick 群 P2）", () => {
  it("两 agent 群含 @全体：Modal.confirm 弹出；点「取消」不发送、草稿保留", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();
    const confirmSpy = spyConfirmCancel();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "@全体 一起看下白屏" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]![0]).toMatchObject({
      title: "发送 @全体 消息？",
      content: expect.stringContaining("将同时触发 2 个 Agent 成员"),
      okText: "发送",
      cancelText: "取消",
    });
    // 取消：不发消息，草稿保留。
    expect(mocks.sendGroupMessage).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("@全体 一起看下白屏");
    confirmSpy.mockRestore();
  });

  it("点「发送」确认 → 才调 sendGroupMessage（参数=原文）", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();
    const confirmSpy = spyConfirmOk();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "@all 巡检一下" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith(
        "g-1",
        "@all 巡检一下",
        undefined,
        null,
      ),
    );
    confirmSpy.mockRestore();
  });

  it("单 agent 群含 @全体：无并发面，直发不弹确认", async () => {
    const detail = makeGroupDetail();
    detail.members = (detail.members as Record<string, unknown>[]).filter(
      (m) => m.id !== "mem-2",
    );
    mocks.getGroupChat.mockResolvedValue(detail);
    mocks.listGroupChats.mockResolvedValue([detail]);
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();
    const confirmSpy = spyConfirmCancel();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "@全体 看下" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith("g-1", "@全体 看下", undefined, null),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("GroupChatPanel 置顶（quick 群 P2）", () => {
  it("群主可见气泡图钉：点击 → PUT /pinned（log_id=该行 id）", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });

    const pinBtn = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-pin'][data-log-id='l-2']",
    );
    expect(pinBtn).toBeTruthy();
    fireEvent.click(pinBtn!);
    await waitFor(() =>
      expect(mocks.pinGroupMessage).toHaveBeenCalledWith("g-1", { log_id: "l-2" }),
    );
  });

  it("置顶横幅：群读体 pinned 快照渲染（成员名+内容+时间）+ 已置顶行浅 brand 高亮；「取消置顶」→ DELETE /pinned", async () => {
    const detail = {
      ...makeGroupDetail(),
      pinned: {
        log_id: "l-2",
        pinned_by: "u-me",
        pinned_at: "2026-09-01T07:00:00Z",
        content: "@小码 帮我定位一下这个白屏问题",
        member_name: "鲸落",
      },
    };
    mocks.getGroupChat.mockResolvedValue(detail);
    mocks.listGroupChats.mockResolvedValue([detail]);
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();

    const banner = await screen.findByTestId("group-pinned-banner");
    expect(banner.textContent).toContain("鲸落");
    expect(banner.textContent).toContain("@小码 帮我定位一下这个白屏问题");
    // 已置顶行（l-2）浅 brand 底高亮。
    const pinnedRow = await waitFor(() => {
      const row = document.querySelector<HTMLElement>("[data-log-id='l-2']");
      expect(row?.className).toContain("bg-brand-50");
      return row!;
    });
    expect(pinnedRow).toBeTruthy();
    // 未置顶行无高亮。
    const plainRow = document.querySelector<HTMLElement>("[data-log-id='l-1']");
    expect(plainRow?.className).not.toContain("bg-brand-50");

    // 群主取消置顶 → DELETE /pinned。
    fireEvent.click(screen.getByTestId("group-pinned-unpin"));
    await waitFor(() => expect(mocks.unpinGroupMessage).toHaveBeenCalledWith("g-1"));
  });

  it("非群主：无图钉按钮、横幅无「取消置顶」", async () => {
    const detail = {
      ...makeGroupDetail(),
      created_by: "u-other",
      pinned: {
        log_id: "l-2",
        pinned_by: "u-other",
        pinned_at: "2026-09-01T07:00:00Z",
        content: "@小码 帮我定位一下这个白屏问题",
        member_name: "鲸落",
      },
    };
    mocks.getGroupChat.mockResolvedValue(detail);
    mocks.listGroupChats.mockResolvedValue([detail]);
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();

    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });
    expect(screen.queryAllByTestId("group-msg-pin")).toHaveLength(0);
    // 横幅仍全员可见（快照展示），但无取消入口。
    expect(await screen.findByTestId("group-pinned-banner")).toBeTruthy();
    expect(screen.queryByTestId("group-pinned-unpin")).toBeNull();
  });
});

describe("GroupChatPanel 触发失败展示（quick 群 P2）", () => {
  it("响应 triggered[].error → 逐条 warning「{成员名} 未能触发：{error}」；成功项不弹", async () => {
    harness.logsJson = [];
    mocks.sendGroupMessage.mockResolvedValue({
      carrier_run_id: "r-c",
      log_id: "l-x",
      mention_all: true,
      triggered: [
        {
          member_id: "mem-1",
          member_name: "小码",
          shadow_session_id: null,
          run_id: null,
          queued: false,
          mid_turn: false,
          error: "机器离线，无法触发",
        },
        {
          member_id: "mem-2",
          member_name: "小测",
          shadow_session_id: "shadow-2",
          run_id: "run-2",
          queued: false,
          mid_turn: false,
          error: null,
        },
      ],
    });
    renderPanel();
    await waitForStreamWired();

    const input = screen.getByLabelText("群消息输入框");
    // 无 @全体（避开二次确认路径）——只验证触发失败 toast。
    fireEvent.change(input, { target: { value: "看下这个白屏" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.notify.warning).toHaveBeenCalledTimes(1),
    );
    expect(mocks.notify.warning).toHaveBeenCalledWith(
      "小码 未能触发：机器离线，无法触发",
    );
  });

  it("全部成功（triggered 无 error）→ 不弹任何提示", async () => {
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "看下这个白屏" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledTimes(1),
    );
    expect(mocks.notify.warning).not.toHaveBeenCalled();
  });
});

/* ── 9. 群 P2 第二波：引用回复 / 未读（挂载已读 + 分隔线） ────────────────── */

describe("GroupChatPanel 引用回复（群 P2 第二波）", () => {
  it("点气泡「引用回复」（全员可用，他人 user 行）→ 输入区引用条（成员名+摘要）→ 发送带 reply_to_log_id → 成功后引用条清空", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });

    const quoteBtn = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-reply'][data-log-id='l-1']",
    );
    expect(quoteBtn).toBeTruthy();
    fireEvent.click(quoteBtn!);

    // 引用条：目标行 id + 成员名 + 内容摘要一行。
    const bar = screen.getByTestId("group-reply-bar");
    expect(bar.getAttribute("data-reply-to-log-id")).toBe("l-1");
    expect(bar.textContent).toContain("林一");
    expect(bar.textContent).toContain("登录页偶现白屏，谁能看看？");

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "复现步骤我贴在这里" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith(
        "g-1",
        "复现步骤我贴在这里",
        undefined,
        "l-1",
      ),
    );
    // 发送成功：引用条清空（回到普通发送态）。
    await waitFor(() => {
      expect(screen.queryByTestId("group-reply-bar")).toBeNull();
    });
  });

  it("引用 agent 投影行亦可；X 取消 → 引用条消失，再发送不带 reply_to_log_id", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });

    const quoteBtn = document.querySelector<HTMLElement>(
      "[data-testid='group-msg-reply'][data-log-id='l-3']",
    );
    expect(quoteBtn).toBeTruthy();
    fireEvent.click(quoteBtn!);
    const bar = screen.getByTestId("group-reply-bar");
    expect(bar.getAttribute("data-reply-to-log-id")).toBe("l-3");
    expect(bar.textContent).toContain("小码");

    // 取消 → 引用条消失；后续发送为普通消息（第 4 参 null）。
    fireEvent.click(screen.getByTestId("group-reply-cancel"));
    expect(screen.queryByTestId("group-reply-bar")).toBeNull();

    const input = screen.getByLabelText("群消息输入框");
    fireEvent.change(input, { target: { value: "直接说结论" } });
    await flushAsync(2);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith(
        "g-1",
        "直接说结论",
        undefined,
        null,
      ),
    );
  });

  it("气泡引用条渲染：回放 metadata.reply_to → 气泡顶部（成员名+摘要）；实时事件同构", async () => {
    harness.logsJson = [
      logsFixtureUserRow(),
      {
        id: "l-q2",
        run_id: "r-9",
        timestamp: "2026-09-01T06:06:00Z",
        channel: "user_input",
        content_redacted: "+1，我也遇到了",
        metadata: {
          sender_member_name: "鲸落",
          sender_user_id: "u-me",
          reply_to: {
            log_id: "l-rq",
            member_name: "林一",
            content_head: "登录页偶现白屏，谁能看看？",
          },
        },
      },
    ];
    renderPanel();
    await waitForStreamWired();

    // self 气泡（鲸落）顶部引用条：竖线条 + 成员名 + 摘要。
    const selfRow = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-log-id='l-q2']");
      expect(el).toBeTruthy();
      return el!;
    });
    const quote = selfRow.querySelector('[data-testid="group-msg-reply-quote"]');
    expect(quote).toBeTruthy();
    expect(quote?.getAttribute("data-reply-to-log-id")).toBe("l-rq");
    expect(quote?.textContent).toContain("林一");
    expect(quote?.textContent).toContain("登录页偶现白屏，谁能看看？");
    // 无引用行不渲染引用条。
    const plainRow = document.querySelector<HTMLElement>("[data-log-id='l-rq']");
    expect(plainRow?.querySelector('[data-testid="group-msg-reply-quote"]')).toBeNull();

    // 实时事件同构：SSE 推带 reply_to 的 user_input 行（他人）→ 引用条渲染。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-live",
      log_id: "l-live-1",
      timestamp: "2026-09-01T06:07:00Z",
      channel: "user_input",
      content: "收到，我看下日志",
      sender_member_name: "林一",
      sender_user_id: "u-lin",
      reply_to: {
        log_id: "l-q2",
        member_name: "鲸落",
        content_head: "+1，我也遇到了",
      },
    });
    const liveRow = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-log-id='l-live-1']");
      expect(el).toBeTruthy();
      return el!;
    });
    const liveQuote = liveRow.querySelector(
      '[data-testid="group-msg-reply-quote"]',
    );
    expect(liveQuote?.getAttribute("data-reply-to-log-id")).toBe("l-q2");
    expect(liveQuote?.textContent).toContain("鲸落");
    expect(liveQuote?.textContent).toContain("+1，我也遇到了");
  });
});

describe("GroupChatPanel 未读（群 P2 第二波：挂载已读 + 分隔线）", () => {
  /** 群列表项形态（unread 快照源；markGroupRead 乐观清零的缓存 key 同源）。 */
  function groupListItemWithUnread(count: number): GroupChatListItemRead {
    return {
      ...makeGroupDetail(),
      unread_count: count,
    } as unknown as GroupChatListItemRead;
  }

  it("挂载 → markGroupRead(g-1)（PUT /read）+ presence 群列表缓存 unread 乐观清零", async () => {
    // 首拉带未读 5（列表徽标数据源）；重拉（invalidate 后）按服务端已清零回 0
    // ——两条路径都收敛到 0，断言不受 invalidate/首拉去重时序影响。
    mocks.listGroupChats
      .mockResolvedValueOnce([groupListItemWithUnread(5)])
      .mockResolvedValue([groupListItemWithUnread(0)]);
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => expect(mocks.markGroupRead).toHaveBeenCalledWith("g-1"));
    await waitFor(() => {
      const items = panelQc!.getQueryData<GroupChatListItemRead[]>([
        "groupChats",
        "list",
        null,
      ]);
      expect(items?.find((g) => g.id === "g-1")?.unread_count).toBe(0);
    });
  });

  it("markGroupRead 失败 → 静默（不阻断群聊渲染）", async () => {
    mocks.markGroupRead.mockRejectedValue(new Error("offline"));
    harness.logsJson = [];
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => expect(mocks.markGroupRead).toHaveBeenCalledTimes(1));
    // 面板照常（时间线区在渲染，无异常冒泡）。
    expect(screen.getByTestId("group-chat-timeline")).toBeTruthy();
  });

  it("未读分隔线：挂载快照 unread=3 → 倒数第 3 条消息前插「以下 3 条为新消息」；会话中新消息不二次插线", async () => {
    harness.logsJson = makeReplayLogs(); // 消息行 l-1/l-2/l-3 共 3 条
    renderPanel(groupListItemWithUnread(3));
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });

    const divider = await screen.findByTestId("group-unread-divider");
    // 3 条消息全未读 → 分隔线在首条（l-1）前。
    expect(divider.getAttribute("data-before-log-id")).toBe("l-1");
    expect(divider.textContent).toContain("以下 3 条为新消息");
    // DOM 序：分隔线在 l-1 气泡之前。
    const timeline = screen.getByTestId("group-chat-timeline");
    const children = Array.from(timeline.children);
    expect(children.indexOf(divider)).toBeLessThan(
      children.indexOf(document.querySelector("[data-log-id='l-1']")!),
    );

    // 会话中到达新消息（第 4 条）：锚点只算一次——分隔线仍在 l-1 前，不跟随移动。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-live",
      log_id: "l-live-new",
      timestamp: "2026-09-01T06:08:00Z",
      channel: "user_input",
      content: "刚又复现了一次",
      sender_member_name: "林一",
      sender_user_id: "u-lin",
    });
    await waitFor(() => {
      expect(document.querySelector("[data-log-id='l-live-new']")).toBeTruthy();
    });
    expect(
      screen.getByTestId("group-unread-divider").getAttribute("data-before-log-id"),
    ).toBe("l-1");
  });

  it("未读分隔线定位：unread=2 → 倒数第 2 条（l-2）前；unread 超消息总数 → 钳制首条前", async () => {
    harness.logsJson = makeReplayLogs();
    const first = renderPanel(groupListItemWithUnread(2));
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });
    // unread=2 → 倒数第 2 条（l-2，鲸落 self 行）前。
    expect(
      (await screen.findByTestId("group-unread-divider")).getAttribute(
        "data-before-log-id",
      ),
    ).toBe("l-2");
    first.unmount();

    // unread=5 > 消息总数 3 → 钳制到首条（l-1）前。
    renderPanel(groupListItemWithUnread(5));
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });
    expect(
      (await screen.findByTestId("group-unread-divider")).getAttribute(
        "data-before-log-id",
      ),
    ).toBe("l-1");
  });

  it("unread=0（默认）→ 恒无分隔线", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel(groupListItemWithUnread(0));
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });
    expect(screen.queryByTestId("group-unread-divider")).toBeNull();
  });
});

// ── 群 P3 quick（2026-09-03，ql-20260903-010）：回放分页 / 回到底部悬浮按钮 ──

/** 分页回放固件：count 条 user_input 行，时间戳从 baseMs 起每秒一条（单调递增，
 *    id 全局唯一——before 翻页页与初始页共存时间线，log_id 去重不误伤）。 */
function makePagedReplayLogs(opts: {
  count: number;
  baseMs: number;
}): GroupReplayLogEntry[] {
  return Array.from({ length: opts.count }, (_, i) => ({
    id: `pg-${opts.baseMs}-${i}`,
    run_id: `r-pg-${i}`,
    timestamp: new Date(opts.baseMs + i * 1000).toISOString(),
    channel: "user_input",
    content_redacted: `历史消息 ${i}`,
    metadata: { sender_member_name: "林一", sender_user_id: "u-lin" },
  }));
}

describe("群 P3 回放分页（ql-20260903-010）", () => {
  it("回放不足一页（<200 条）→ 无「加载更早消息」入口", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });
    expect(screen.queryByTestId("group-load-earlier")).toBeNull();
  });

  it("初始回放拉满一页才显示入口；点击按 before 游标向上翻页、落不满一页入口消失", async () => {
    const initialPage = makePagedReplayLogs({
      count: 200,
      baseMs: Date.UTC(2026, 8, 1, 5, 0, 0),
    });
    // 翻页页 3 条（落不满一页 → 翻完后入口应消失），时间戳严格早于初始页首条。
    const earlierPage = makePagedReplayLogs({
      count: 3,
      baseMs: Date.UTC(2026, 8, 1, 4, 59, 57),
    });
    harness.logsByUrl = (url) =>
      url.includes("before=") ? earlierPage : initialPage;
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(
        document.querySelector(`[data-log-id='${initialPage[0]!.id}']`),
      ).toBeTruthy();
    });
    // 拉满 200 条 → 入口出现。
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-load-earlier"));
    });
    // 翻页请求：before=当前最早一条 ts + limit=200。
    await waitFor(() => {
      expect(harness.calls.some((u) => u.includes("before="))).toBe(true);
    });
    const beforeCall = harness.calls.find((u) => u.includes("before="))!;
    expect(beforeCall).toContain(
      `before=${encodeURIComponent(initialPage[0]!.timestamp)}`,
    );
    expect(beforeCall).toContain("limit=200");
    // 更早消息插入时间线最前（视口位置保持由 scrollTop 增量保证，jsdom 高恒 0 不验）。
    await waitFor(() => {
      expect(
        document.querySelector(`[data-log-id='${earlierPage[0]!.id}']`),
      ).toBeTruthy();
    });
    const rows = Array.from(
      screen
        .getByTestId("group-chat-timeline")
        .querySelectorAll("[data-log-id]"),
    );
    expect(rows[0]!.getAttribute("data-log-id")).toBe(earlierPage[0]!.id);
    // 翻页落不满一页 → 无更早历史 → 入口消失。
    await waitFor(() => {
      expect(screen.queryByTestId("group-load-earlier")).toBeNull();
    });
  });

  it("翻页失败 → 「加载失败，点击重试」；重试成功返回空页 → 入口消失", async () => {
    const initialPage = makePagedReplayLogs({
      count: 200,
      baseMs: Date.UTC(2026, 8, 1, 5, 0, 0),
    });
    let failOnce = true;
    harness.logsByUrl = (url) => {
      if (!url.includes("before=")) return initialPage;
      if (failOnce) {
        failOnce = false;
        throw new Error("boom");
      }
      return [];
    };
    renderPanel();
    await waitForStreamWired();
    await screen.findByTestId("group-load-earlier");
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-load-earlier"));
    });
    await screen.findByText("加载失败，点击重试");
    const failedCalls = harness.calls.filter((u) => u.includes("before=")).length;
    // 点击重试 → 重新发翻页请求；返回空页 → 判无更早历史，入口消失。
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-load-earlier"));
    });
    await waitFor(() => {
      expect(harness.calls.filter((u) => u.includes("before=")).length).toBe(
        failedCalls + 1,
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("group-load-earlier")).toBeNull();
    });
  });
});

describe("群 P3 回到底部悬浮按钮（ql-20260903-010）", () => {
  /** 布局固件：scrollHeight=1000 / clientHeight=500，scrollTop 可写。 */
  function mockTimelineGeometry(el: HTMLElement): {
    scrollToMock: ReturnType<typeof vi.fn>;
    setScrollTop: (_v: number) => void;
  } {
    const scrollToMock = vi.fn();
    Object.defineProperty(el, "scrollTo", {
      value: scrollToMock,
      configurable: true,
    });
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      get: () => 500,
    });
    let scrollTop = 0;
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    return { scrollToMock, setScrollTop: (v) => (scrollTop = v) };
  }

  it("贴底无按钮；上滚出现；离开期间新消息计数；点击平滑回底清零；滚回底部自然清零", async () => {
    harness.logsJson = makeReplayLogs();
    renderPanel();
    await waitForStreamWired();
    await waitFor(() => {
      expect(timelineIdentities()).toEqual(["林一", "鲸落", "小码"]);
    });
    const el = screen.getByTestId("group-chat-timeline");
    const { scrollToMock, setScrollTop } = mockTimelineGeometry(el);

    // 消费「首帧无条件回底」分支（stub scrollTo 后首个 entries 变化进入该分支，
    // 同 ql-20260903-002 用例惯例），避免后续断言被挂载逻辑污染。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-base",
      log_id: "l-base",
      channel: "stdout",
      content: "[ASSISTANT] 基线轮",
      timestamp: "2026-09-01T06:30:00Z",
      member_id: "mem-1",
      member_name: "小码",
    });
    await flushAsync();
    expect(scrollToMock).toHaveBeenCalledTimes(1);
    scrollToMock.mockClear();

    // 贴底 → 无按钮。
    expect(screen.queryByTestId("group-jump-bottom")).toBeNull();
    // 上滚（scrollTop=0 → 距底 500 > 80）→ 按钮出现，无新消息时显示「回到底部」。
    setScrollTop(0);
    await act(async () => {
      fireEvent.scroll(el);
    });
    const btn = await screen.findByTestId("group-jump-bottom");
    expect(btn.textContent).toContain("回到底部");

    // 离开期间到达新消息 → 计数 +1，且上滚不被强制拽底。
    await pushSseEvent({
      event: "log",
      session_id: "s-g-1",
      run_id: "r-new",
      log_id: "l-new",
      channel: "user_input",
      content: "离开期间的新消息",
      timestamp: "2026-09-01T07:00:00Z",
      sender_member_name: "林一",
      sender_user_id: "u-lin",
    });
    await waitFor(() => {
      expect(screen.getByTestId("group-jump-bottom").textContent).toContain(
        "1 条新消息",
      );
    });
    expect(scrollToMock).not.toHaveBeenCalled();

    // 滚回底部（不点按钮）→ 计数清零、按钮消失；再上滚重新锚定（旧消息不计入）。
    setScrollTop(600); // 距底 -100 < 80 → 贴底。
    await act(async () => {
      fireEvent.scroll(el);
    });
    expect(screen.queryByTestId("group-jump-bottom")).toBeNull();
    setScrollTop(0);
    await act(async () => {
      fireEvent.scroll(el);
    });
    expect(screen.getByTestId("group-jump-bottom").textContent).toContain(
      "回到底部",
    );

    // 离开期间再来两条 → 点击按钮平滑回底，计数清零、按钮消失。
    for (const [i, ts] of [
      ["2", "2026-09-01T07:01:00Z"],
      ["3", "2026-09-01T07:02:00Z"],
    ] as const) {
      await pushSseEvent({
        event: "log",
        session_id: "s-g-1",
        run_id: `r-new-${i}`,
        log_id: `l-new-${i}`,
        channel: "user_input",
        content: `离开期间的新消息 ${i}`,
        timestamp: ts,
        sender_member_name: "林一",
        sender_user_id: "u-lin",
      });
    }
    await waitFor(() => {
      expect(screen.getByTestId("group-jump-bottom").textContent).toContain(
        "2 条新消息",
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("group-jump-bottom"));
    });
    expect(scrollToMock).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(screen.queryByTestId("group-jump-bottom")).toBeNull();
  });
});


