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
 *      尾 400 字、发送后 typing=false）。
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

import {
  GroupChatPanel,
  applyGroupTimelineEvent,
  buildTimelineFromReplay,
  entryFromReplayLog,
  sortGroupTimeline,
} from "@/components/group-chat/group-chat-panel";
import type { GroupReplayLogEntry } from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getGroupChat: vi.fn(),
  listGroupChats: vi.fn(),
  sendGroupMessage: vi.fn(),
  sendGroupTyping: vi.fn(),
  machinesHook: vi.fn(),
  listProviders: vi.fn(),
  profilesHook: vi.fn(),
  listWorkspaces: vi.fn(),
  uploadSessionAttachment: vi.fn(),
  removeSessionAttachment: vi.fn(),
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
  useNotify: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
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
          new Response(JSON.stringify(harness.logsJson), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
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

function renderPanel(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <GroupChatPanel groupId="g-1" group={null} onSessionListRefresh={vi.fn()} />
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

  it("typing 气泡：出现（昵称+预览）→ typing=false 显式消失；TTL 2.5s 过期自动消失", async () => {
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

    // agent typing（后端代发）：显示成员昵称 + 正在生成回复。
    await pushSseEvent({
      event: "typing",
      member_name: "小码",
      member_kind: "agent",
      typing: true,
      preview: null,
      ts: "2026-09-01T06:06:01Z",
    });
    expect(screen.getAllByTestId("group-typing-bubble")).toHaveLength(2);

    // typing=false（发送/停顿收口）→ 指示器移除。
    await pushSseEvent({
      event: "typing",
      member_name: "林一",
      member_kind: "user",
      typing: false,
      preview: null,
      ts: "2026-09-01T06:06:02Z",
    });
    expect(screen.getAllByTestId("group-typing-bubble")).toHaveLength(1);

    // TTL 2.5s 过期：无后续帧 → 剩余指示器自动消失（500ms 裁剪周期）。
    await waitFor(
      () => {
        expect(screen.queryByTestId("group-typing-bubble")).toBeNull();
      },
      { timeout: 4000 },
    );
  }, 10_000);
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

    // ↓ 移到「小码」+ Enter 选中 → 回填 "@小码 "（尾随空格关层）。
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe("@小码 ");
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
      ]),
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

describe("GroupChatPanel 成员头像（quick）", () => {
  it("avatar 有值 → antd Avatar 图片（blob objectURL）；无值 → 首字回退", async () => {
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
