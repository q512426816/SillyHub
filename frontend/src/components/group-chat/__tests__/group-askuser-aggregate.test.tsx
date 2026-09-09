/**
 * 群聊 AskUser 聚合单测（2026-09-09-askuser-pi-cursor task-11 / FR-05 /
 * D-004@v2，design §Wave C.2/3 + 原型 prototype-askuser-cards.html 场景二）。
 *
 * 依据：
 *   - components/group-chat/group-chat-panel.tsx（本 task 实现：成员 pending
 *     原生提问聚合 + 群消息行 marker 卡 + 先到先得关闭态 + 404 静默降级）
 *   - tasks/task-11.md acceptance：聚合卡渲染（来源标注/推荐条）/群成员提交
 *     作答/已被回答关闭态/cursor 标记卡与 sendGroupMessage 作答
 *   - task-09 契约：影子会话答题放行（respondSessionPermission 走成员影子
 *     会话 id）+ 读侧 list_pending_dialogs 仍 owner-only（404 静默降级面）
 *   - task-10 契约：AskUserDialogCard answered 关闭态 + recommendResponders 条
 *
 * mock 策略（对齐 group-chat-panel.test 惯例）：
 *   - @/lib/daemon importActual 部分覆写：群 CRUD/发送/typing/pending 拉取/
 *     答题提交 mock 断言；streamGroupChat / getAgentSessionLogs / maxLogTimestamp
 *     保真——经路由 fetch（/stream 假 SSE 流 + /logs JSON）驱动真实 SSE 消费；
 *   - @/stores/session / 附件 / MemberPanel 数据源 hook / useNotify /
 *     MarkdownText 逐一 mock（group-chat-panel.test 同款）。
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
  collectAskUserMarkers,
  type GroupTimelineEntry,
} from "@/components/group-chat/group-chat-panel";
import type { GroupReplayLogEntry } from "@/lib/daemon";

// ── hoisted mock 状态 ─────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getGroupChat: vi.fn(),
  listGroupChats: vi.fn(),
  sendGroupMessage: vi.fn(),
  sendGroupTyping: vi.fn(),
  pinGroupMessage: vi.fn(),
  unpinGroupMessage: vi.fn(),
  markGroupRead: vi.fn(),
  // task-11：成员影子会话 pending 拉取 + 答题提交（卡内既有链路）mock 断言。
  fetchPendingDialogs: vi.fn(),
  respondSessionPermission: vi.fn(),
  machinesHook: vi.fn(),
  listProviders: vi.fn(),
  profilesHook: vi.fn(),
  listWorkspaces: vi.fn(),
  uploadSessionAttachment: vi.fn(),
  removeSessionAttachment: vi.fn(),
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
    getGroupChat: (...args: unknown[]) => mocks.getGroupChat(...args),
    listGroupChats: (...args: unknown[]) => mocks.listGroupChats(...args),
    sendGroupMessage: (...args: unknown[]) => mocks.sendGroupMessage(...args),
    sendGroupTyping: (...args: unknown[]) => mocks.sendGroupTyping(...args),
    pinGroupMessage: (...args: unknown[]) => mocks.pinGroupMessage(...args),
    unpinGroupMessage: (...args: unknown[]) => mocks.unpinGroupMessage(...args),
    markGroupRead: (...args: unknown[]) => mocks.markGroupRead(...args),
    fetchPendingDialogs: (...args: unknown[]) => mocks.fetchPendingDialogs(...args),
    respondSessionPermission: (...args: unknown[]) =>
      mocks.respondSessionPermission(...args),
    // streamGroupChat / getAgentSessionLogs / maxLogTimestamp 保真——真 SSE
    // 消费循环经路由 fetch 驱动。
  };
});

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

vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return {
    errMessage: actual.errMessage,
    useNotify: () => mocks.notify,
  };
});

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

vi.mock("@/lib/file/api", () => ({
  fetchFileBlob: vi.fn(async () => new Blob(["x"])),
  uploadFile: vi.fn(),
  getFileDownloadUrl: (id: string) => `/api/file/${id}`,
}));

// ── 路由 fetch 假 SSE 流（group-chat-panel.test 同款） ─────────────────────

interface StreamHarness {
  calls: string[];
  stream: { push: (_text: string) => void } | null;
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

async function flushAsync(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ── 固件 ─────────────────────────────────────────────────────────────────

/** 群详情：agent 成员带影子会话（task-11 聚合拉取面）。 */
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
        shadow_session_id: "sh-1",
        shadow_status: "active",
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
        shadow_session_id: "sh-2",
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

/** 成员 pending 原生提问（pi_extension_ui 归一 questions[] + 推荐人平铺）。 */
function makePendingDialog(): Record<string, unknown> {
  return {
    session_id: "sh-1",
    run_id: "run-9",
    request_id: "req-1",
    tool_name: "extension_ui_request",
    input: {},
    dialog_kind: "pi_extension_ui",
    dialog_payload: {
      questions: [
        {
          question: "当前线上部署的是哪个版本？",
          options: [
            { label: "v1.2.0（上周四发）" },
            { label: "v1.3.0-rc2" },
          ],
        },
      ],
      recommendResponders: ["鲸落"],
    },
  };
}

const MARKER_JSON = JSON.stringify({
  kind: "select",
  question: "重构范围选哪个？",
  options: [{ label: "全量重构（含调用方适配，约 2 天）" }, { label: "只拆文件不动逻辑（半天）" }],
});

/** 回放日志：用户消息 + agent 气泡（尾部 askuser 标记）。 */
function makeMarkerReplayLogs(withLaterUser: boolean): GroupReplayLogEntry[] {
  const logs: GroupReplayLogEntry[] = [
    {
      id: "l-1",
      run_id: "r-1",
      timestamp: "2026-09-01T06:05:00Z",
      channel: "user_input",
      content_redacted: "帮我重构 utils 目录",
      metadata: { sender_member_name: "鲸落", sender_user_id: "u-me" },
    },
    {
      id: "l-2",
      run_id: "r-2",
      timestamp: "2026-09-01T06:06:00Z",
      channel: "stdout",
      content_redacted:
        "[ASSISTANT] utils 下有 3 个模块耦合较深，我需要你确认范围。\n```askuser\n" +
        MARKER_JSON +
        "\n```",
      metadata: { member_id: "mem-1", member_name: "小码" },
    },
  ];
  if (withLaterUser) {
    logs.push({
      id: "l-3",
      run_id: "r-3",
      timestamp: "2026-09-01T06:07:00Z",
      channel: "user_input",
      content_redacted: "全量重构（含调用方适配）",
      metadata: { sender_member_name: "鲸落", sender_user_id: "u-me" },
    });
  }
  return logs;
}

/** 普通回放日志（无标记——404 降级用例的时间线主体）。 */
function makePlainReplayLogs(): GroupReplayLogEntry[] {
  return [
    {
      id: "l-1",
      run_id: "r-1",
      timestamp: "2026-09-01T06:05:00Z",
      channel: "user_input",
      content_redacted: "大家一起把这个 bug 排了",
      metadata: { sender_member_name: "林一", sender_user_id: "u-lin" },
    },
    {
      id: "l-2",
      run_id: "r-2",
      timestamp: "2026-09-01T06:06:00Z",
      channel: "stdout",
      content_redacted: "[ASSISTANT] 已定位：问题在 hooks 依赖数组漏了 tenantId",
      metadata: { member_id: "mem-1", member_name: "小码" },
    },
  ];
}

// ── 渲染助手 ─────────────────────────────────────────────────────────────

let panelQc: QueryClient | null = null;

function renderPanel(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  panelQc = qc;
  return render(
    <QueryClientProvider client={qc}>
      <GroupChatPanel groupId="g-1" group={null} onSessionListRefresh={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function waitForPanelReady(): Promise<void> {
  await waitFor(() => {
    expect(harness.calls.some((u) => u.includes("/stream"))).toBe(true);
    expect(harness.stream).toBeTruthy();
  });
  await flushAsync();
}

/** 聚合 pending 卡元素（按 request id 定位；关闭态/开放态同锚）。 */
function pendingCard(requestId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-testid='group-askuser-pending'][data-request-id='${requestId}']`,
  );
  if (!el) throw new Error(`pending card ${requestId} not rendered`);
  return el;
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
  mocks.pinGroupMessage.mockResolvedValue(null);
  mocks.unpinGroupMessage.mockResolvedValue(null);
  mocks.markGroupRead.mockResolvedValue(undefined);
  // task-11：默认两影子会话都无 pending（多数用例不涉及聚合）。
  mocks.fetchPendingDialogs.mockResolvedValue([]);
  mocks.respondSessionPermission.mockResolvedValue({ accepted: true });
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
  mocks.uploadSessionAttachment.mockImplementation(
    async (_file: File, kind: string) => ({
      id: "att-1",
      kind,
      media_type: "text/plain",
      bytes: 64,
      name: "x.txt",
    }),
  );
  mocks.removeSessionAttachment.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GroupChatPanel AskUser 聚合（task-11 / FR-05 / D-004@v2）", () => {
  it("成员影子会话 pending 原生提问聚合渲染：来源成员标注 + 推荐回答人条 + 只拉 agent 影子成员", async () => {
    harness.logsJson = makePlainReplayLogs();
    mocks.fetchPendingDialogs.mockImplementation(async (sid: string) =>
      sid === "sh-1" ? [makePendingDialog()] : [],
    );
    renderPanel();
    await waitForPanelReady();

    // 聚合卡出现在消息流末尾（普通消息行之后）。
    await waitFor(() => {
      expect(pendingCard("req-1")).toBeTruthy();
    });
    const card = pendingCard("req-1");
    // 来源成员标注：头像行昵称 + data-member-id（原型场景二 ask-card 头部语义）。
    expect(card.getAttribute("data-member-id")).toBe("mem-1");
    expect(card.textContent).toContain("小码");
    expect(card.textContent).toContain("任何成员可答，先到先得");
    // 卡内：问题文本 + 选项（AskUserDialogCard 开放态）+ 推荐条（task-10）。
    expect(card.textContent).toContain("当前线上部署的是哪个版本？");
    expect(card.textContent).toContain("v1.3.0-rc2");
    expect(card.textContent).toContain("推荐");
    expect(card.textContent).toContain("@鲸落");
    expect(
      card.querySelector("article[data-request-id='req-1'][data-answered]"),
    ).toBeNull();

    // 只拉 agent 影子成员（shadow_session_id 非空，≤5 并行）。
    await waitFor(() => {
      const sids = mocks.fetchPendingDialogs.mock.calls.map((c) => c[0]);
      expect(sids).toContain("sh-1");
      expect(sids).toContain("sh-2");
      expect(sids).not.toContain(undefined);
    });
  });

  it("群成员提交作答：respondSessionPermission 走成员影子会话 + 本端转「×× 已回答」关闭态", async () => {
    harness.logsJson = makePlainReplayLogs();
    mocks.fetchPendingDialogs.mockImplementation(async (sid: string) =>
      sid === "sh-1" ? [makePendingDialog()] : [],
    );
    renderPanel();
    await waitForPanelReady();

    await waitFor(() => {
      expect(pendingCard("req-1")).toBeTruthy();
    });
    // 选选项 → 提交回答（卡内既有链路；群成员授权已由 task-09 放行）。
    fireEvent.click(screen.getByText("v1.3.0-rc2"));
    fireEvent.click(screen.getByTitle("提交回答"));

    await waitFor(() => {
      expect(mocks.respondSessionPermission).toHaveBeenCalledTimes(1);
    });
    const args = mocks.respondSessionPermission.mock.calls[0]!;
    expect(args[0]).toBe("sh-1");
    expect(args[1]).toBe("req-1");
    expect(args[2]).toBe("allow");
    expect(args[4]).toEqual({
      answers: [{ question: "当前线上部署的是哪个版本？", answer: "v1.3.0-rc2" }],
    });

    // 先到先得关闭态：本端提交成功 →「鲸落 已回答」（当前用户群内昵称）。
    await waitFor(() => {
      expect(
        pendingCard("req-1").querySelector("article[data-answered='true']"),
      ).toBeTruthy();
    });
    expect(pendingCard("req-1").textContent).toContain("鲸落");
    expect(pendingCard("req-1").textContent).toContain("已回答，本题已关闭");
  });

  it("先到者已答（轮询不再 pending）→ 后答者关闭态（人名数据不可得降级不带名）", async () => {
    harness.logsJson = makePlainReplayLogs();
    mocks.fetchPendingDialogs
      .mockResolvedValueOnce([makePendingDialog()])
      .mockResolvedValue([]);
    renderPanel();
    await waitForPanelReady();

    await waitFor(() => {
      expect(pendingCard("req-1")).toBeTruthy();
    });
    // 下一拍轮询：request 不再 pending（先到者已答）→ 关闭态而非表单消失。
    await act(async () => {
      await panelQc!.invalidateQueries({
        queryKey: ["groupChat", "g-1", "askUserDialogs"],
      });
    });
    await waitFor(() => {
      expect(
        pendingCard("req-1").querySelector("article[data-answered='true']"),
      ).toBeTruthy();
    });
    const text = pendingCard("req-1").textContent ?? "";
    expect(text).toContain("已回答，本题已关闭");
    // 降级：答题人 user_id 不可得（群频道不携带 permission_resolved SSE）——
    // 不显示任何成员名作答题人（鲸落/林一均不出现在关闭条）。
    expect(text).not.toContain("鲸落 已回答");
    expect(text).not.toContain("林一 已回答");
    // 只读态：无提交交互入口。
    expect(
      pendingCard("req-1").querySelector("button[title='提交回答']"),
    ).toBeNull();
  });

  it("成员拉取瞬时失败（ql-20260910-002）：已见 pending 卡不误转已答，快照维持开放态", async () => {
    harness.logsJson = makePlainReplayLogs();
    // 按 sid 确定性编排：sh-1 首轮有卡，第二轮起拉取失败（网络抖动/401）。
    let failSh1 = false;
    mocks.fetchPendingDialogs.mockImplementation(async (sid: string) => {
      if (sid === "sh-1") {
        if (failSh1) throw new Error("network blip");
        return [makePendingDialog()];
      }
      return [];
    });
    renderPanel();
    await waitForPanelReady();

    await waitFor(() => {
      expect(pendingCard("req-1")).toBeTruthy();
    });
    failSh1 = true;
    // 下一拍轮询：sh-1 拉取失败——卡缺席是传输问题，不得误判「已答」转
    // 关闭态（曾因此永久死路：resolvedDialogs 只增不减）。
    await act(async () => {
      await panelQc!.invalidateQueries({
        queryKey: ["groupChat", "g-1", "askUserDialogs"],
      });
    });
    await waitFor(() => {
      expect(mocks.fetchPendingDialogs.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
    await flushAsync();
    const card = pendingCard("req-1");
    expect(card.querySelector("article[data-answered='true']")).toBeNull();
    // 快照维持开放态：提交入口仍在（群主仍可作答）。
    expect(card.querySelector("button[title='提交回答']")).toBeTruthy();
  });

  it("读侧 404（非群主视角）静默降级：无聚合卡、时间线正常渲染不崩", async () => {
    harness.logsJson = makePlainReplayLogs();
    // task-09 遗留：list_pending_dialogs 读侧 owner-only——非群主拉成员影子
    // 会话 404；聚合查询逐成员 catch 静默。
    mocks.fetchPendingDialogs.mockRejectedValue(new Error("404 not found"));
    renderPanel();
    await waitForPanelReady();

    await waitFor(() => {
      expect(mocks.fetchPendingDialogs.mock.calls.length).toBeGreaterThan(0);
    });
    await flushAsync();
    expect(
      screen.queryByTestId("group-askuser-pending"),
    ).toBeNull();
    // 普通群消息渲染零回归 + 无错误横幅/报错打断。
    expect(screen.getByText("已定位：问题在 hooks 依赖数组漏了 tenantId")).toBeTruthy();
    expect(screen.queryByTestId("group-sse-banner")).toBeNull();
    expect(mocks.notify.error).not.toHaveBeenCalled();
  });

  it("agent 气泡 askuser 标记 → marker 卡渲染 + 标记原文隐藏 + engineLabel=成员名", async () => {
    harness.logsJson = makeMarkerReplayLogs(false);
    renderPanel();
    await waitForPanelReady();

    const markerRow = screen.getByTestId("group-askuser-marker");
    expect(markerRow.getAttribute("data-log-id")).toBe("l-2");
    // marker 卡本体（开放态）+ engineLabel=来源成员名。
    const card = within(markerRow).getByTestId("ask-user-marker-card");
    expect(card.textContent).toContain("重构范围选哪个？");
    expect(card.textContent).toContain("小码");
    expect(card.textContent).toContain("本轮结束");
    // 标记原文隐藏：正文为 textBefore（不含 fenced 块与 JSON）。
    const bubble = screen.getAllByTestId("markdown-text").find(
      (n) => n.textContent?.includes("耦合较深"),
    );
    expect(bubble).toBeTruthy();
    expect(bubble!.textContent).not.toContain("askuser");
    expect(bubble!.textContent).not.toContain("重构范围选哪个");
  });

  it("marker 卡作答：组装答案走既有 sendGroupMessage（发消息即答案）", async () => {
    harness.logsJson = makeMarkerReplayLogs(false);
    renderPanel();
    await waitForPanelReady();

    fireEvent.click(screen.getByText("只拆文件不动逻辑（半天）"));
    fireEvent.click(screen.getByTitle("提交并发送"));

    await waitFor(() => {
      expect(mocks.sendGroupMessage).toHaveBeenCalledWith(
        "g-1",
        "只拆文件不动逻辑（半天）",
      );
    });
    // 本地即转已答态（提交后回显所发答案）。
    expect(screen.getByTestId("ask-user-marker-card").textContent).toContain(
      "只拆文件不动逻辑（半天）",
    );
  });

  it("marker 已答 best-effort（标记行之后已存在用户消息）→ 关闭态", async () => {
    harness.logsJson = makeMarkerReplayLogs(true);
    renderPanel();
    await waitForPanelReady();

    const card = screen.getByTestId("ask-user-marker-card");
    expect(card.textContent).toContain("已回答");
    expect(card.textContent).toContain("已收到新的回答消息，本题已关闭");
    // 关闭态无提交入口。
    expect(screen.queryByTitle("提交并发送")).toBeNull();
  });
});

describe("collectAskUserMarkers（纯函数）", () => {
  const agentEntry = (
    id: string,
    content: string,
    timestamp: string,
  ): GroupTimelineEntry => ({
    kind: "agent",
    id,
    timestamp,
    memberId: "mem-1",
    memberName: "小码",
    memberSessionId: null,
    runId: "r",
    content,
    segmentId: null,
  });
  const userEntry = (id: string, timestamp: string): GroupTimelineEntry => ({
    kind: "user",
    id,
    timestamp,
    senderName: "鲸落",
    senderUserId: "u-me",
    content: "答：全量重构",
    isSelf: true,
    attachments: null,
    replyTo: null,
  });

  it("命中行进表：其后存在用户消息 → answered=true，标记前正文保留", () => {
    const markerText =
      "需要确认范围。\n```askuser\n" + MARKER_JSON + "\n```";
    const entries = [
      agentEntry("a-1", markerText, "2026-09-01T06:06:00Z"),
      userEntry("u-1", "2026-09-01T06:07:00Z"),
    ];
    const map = collectAskUserMarkers(entries);
    expect(map.size).toBe(1);
    const info = map.get("a-1")!;
    expect(info.answered).toBe(true);
    expect(info.textBefore).toBe("需要确认范围。\n");
    expect(info.payload.kind).toBe("select");
    expect(info.payload.question).toBe("重构范围选哪个？");
  });

  it("标记行之后无用户消息 → answered=false（开放态）；普通文本行不进表", () => {
    const entries = [
      userEntry("u-0", "2026-09-01T06:05:00Z"),
      agentEntry(
        "a-1",
        "需要确认范围。\n```askuser\n" + MARKER_JSON + "\n```",
        "2026-09-01T06:06:00Z",
      ),
      agentEntry("a-2", "普通回复，无标记", "2026-09-01T06:06:30Z"),
    ];
    const map = collectAskUserMarkers(entries);
    expect(map.size).toBe(1);
    expect(map.get("a-1")!.answered).toBe(false);
    expect(map.has("a-2")).toBe(false);
  });

  it("标记出现在文本中部（闭合围栏后还有正文）不认——普通文本", () => {
    const entries = [
      agentEntry(
        "a-1",
        "前文\n```askuser\n" + MARKER_JSON + "\n```\n后文",
        "2026-09-01T06:06:00Z",
      ),
    ];
    expect(collectAskUserMarkers(entries).size).toBe(0);
  });
});

