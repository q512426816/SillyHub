// ql-20260825-007：dialog 模式（/runtimes 弹窗）附件管线测试。
//
// 背景：ql-20260825-006 给 SessionInputBar 加了 Ctrl+V 粘贴上传（组件内），page
// 模式（/sessions）全链路已通（sendFromQueue → injectSession 带 attachment_ids）；
// dialog 模式此前不传附件 props（R3「createSession 无 attachment_ids」只挡了首句，
// 追问/排队路径后端 inject_session 早已支持），粘贴/📎 能上传但发送被丢。
//
// 本文件覆盖 dialog 接通后的行为：
//   - 门控：idle 首句（createSession 契约无附件，防「传了发不出」）与 codex 引擎
//     禁附件入口，title 区分两种原因；
//   - active 追问：粘贴附件 + 文本发送 → injectSession 收到 attachment_ids，
//     占位轮气泡 prompt 含附件标记行（镜像 page 模式）；
//   - running 排队：附件随消息入队（既有 MessageQueueBar 显示 📎N——排队条 dialog
//     原本就有渲染，缺的只是附件随队列传递），turn 完成后投递时带上 attachment_ids；
//   - D-7：附件非空豁免空文本（看图说话），对齐 page 模式。
//
// mock 结构沿用 session-panel-dialog.test.tsx（lib/daemon + 弹层数据源 + 假 SSE
// 连接工厂），另加 @/lib/api/session-attachments 模块级 mock（上传不打真 fetch）。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  createEvent,
} from "@testing-library/react";

import { SessionPanel } from "../session-panel";
import type { SessionStreamConnection } from "@/lib/daemon";
import {
  uploadSessionAttachment,
  type AttachmentRead,
} from "@/lib/api/session-attachments";

vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="markdown-text">{content}</div>
  ),
}));

// 附件上传模块级 mock（attachment-chips 渲染链同源 import，factory 含
// fetchAttachmentObjectUrl）。
vi.mock("@/lib/api/session-attachments", () => ({
  uploadSessionAttachment: vi.fn(),
  removeSessionAttachment: vi.fn(),
  fetchAttachmentObjectUrl: vi.fn(),
}));

/* ----- mock lib/daemon（同 dialog 测试） ----- */

const sessionApi = vi.hoisted(() => ({
  // 会话用量条（session-usage-bar）自取数：必须 resolve（裸 vi.fn() 返回
  // undefined 会被组件 .then 同步崩）；null = 按无数据不渲染。
  getSessionUsage: vi.fn().mockResolvedValue(null),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn(),
  getAgentSessionLogs: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
  // ql-20260825-011：服务端排队三件套（GET/DELETE/retry）。
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
  // 2026-08-31-session-queue-ux task-09/10：队列三操作（reorder/update/dispatch-now）。
  reorderSessionQueue: vi.fn(),
  updateSessionQueueEntry: vi.fn(),
  dispatchNowSessionQueueEntry: vi.fn(),
}));

const popoverApi = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectWorkspaces: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return {
    ...actual,
    getSessionUsage: sessionApi.getSessionUsage,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
    // 2026-08-31-session-queue-ux task-09/10：队列三操作透出。
    reorderSessionQueue: sessionApi.reorderSessionQueue,
    updateSessionQueueEntry: sessionApi.updateSessionQueueEntry,
    dispatchNowSessionQueueEntry: sessionApi.dispatchNowSessionQueueEntry,
  };
});

vi.mock("@/lib/ppm/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ppm/project")>(
    "@/lib/ppm/project",
  );
  return { ...actual, listProjects: popoverApi.listProjects };
});

vi.mock("@/lib/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace")>(
    "@/lib/workspace",
  );
  return { ...actual, listProjectWorkspaces: popoverApi.listProjectWorkspaces };
});

/* ----- fake SSE connection（同 dialog 测试） ----- */

interface FakeConn extends SessionStreamConnection {
  handlers: {
    route: (env: any, cursor?: string | null) => void;
  };
  closeSpy: ReturnType<typeof vi.fn>;
}

function makeStreamMock(): { conn: FakeConn; factory: ReturnType<typeof vi.fn> } {
  let captured: FakeConn | null = null;
  const factory = vi.fn((sessionId: string, handlers: any): FakeConn => {
    const closeSpy = vi.fn();
    captured = {
      close: closeSpy,
      getLastEventId: () => null,
      closeSpy,
      handlers: {
        route: (env: any, cursor?: string | null) => {
          switch (env.event) {
            case "turn_started": handlers.onTurnStarted(env); break;
            case "log": handlers.onLog(env, cursor ?? null); break;
            case "turn_completed": handlers.onTurnCompleted(env); break;
            case "session_ended": handlers.onSessionEnded(env); break;
            // 2026-08-31-session-queue-ux FR-03：会话级队列变更事件（无 run_id）。
            case "queue_changed": handlers.onQueueChanged?.(env); break;
            case "permission_request": handlers.onPermissionRequest?.(env); break;
            case "permission_resolved": handlers.onPermissionResolved?.(env); break;
          }
        },
      },
    };
    return captured;
  });
  return {
    get conn() { return captured!; },
    factory,
  };
}

function makeEnvelope(event: string, overrides: Record<string, any> = {}): any {
  return {
    event,
    session_id: "sess-1",
    run_id: null,
    turn: null,
    log_id: null,
    timestamp: "t",
    channel: null,
    content: null,
    status: null,
    exit_code: null,
    reason: null,
    ...overrides,
  };
}

function setupPanel(overrides: Record<string, any> = {}) {
  const props = {
    providers: ["claude", "codex"],
    defaultProvider: "claude",
    model: null,
    onModelChange: vi.fn(),
    hasOnlineProvider: true,
    ...overrides,
  };
  return render(<SessionPanel mode="dialog" sessionId={null} {...(props as any)} />);
}

function makeAtt(id: string, name: string, kind: "image" | "file"): AttachmentRead {
  return {
    id,
    kind,
    media_type: kind === "image" ? "image/png" : "text/plain",
    bytes: 2048,
    name,
    created_at: "2026-08-25T00:00:00Z",
  };
}

/** 排队条目 DTO（服务端 GET /sessions/{id}/queue 返回形态，task-10 接线用例）。 */
function makeQueueEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    prompt: "排队消息",
    attachment_ids: [] as string[],
    agent_profile_id: null,
    llm_provider_id: null,
    status: "pending",
    error_msg: null,
    created_at: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

/** 粘贴文件到输入框（dom-testing-library 支持 clipboardData 伪对象）。 */
function pasteFile(input: Element, att: AttachmentRead) {
  const file = new File(["xx"], att.name, {
    type: att.kind === "image" ? "image/png" : "text/plain",
  });
  vi.mocked(uploadSessionAttachment).mockResolvedValue(att);
  return fireEvent.paste(input, {
    clipboardData: { files: [file], getData: () => "" },
  });
}

describe("SessionPanel（dialog）附件管线（ql-20260825-007）", () => {
  let stream: ReturnType<typeof makeStreamMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    // ql-20260825-011：默认空队列（服务端排队三件套）。
    sessionApi.fetchSessionQueue.mockResolvedValue([]);
    sessionApi.deleteSessionQueueEntry.mockResolvedValue(undefined);
    sessionApi.retrySessionQueueEntry.mockResolvedValue({
      id: "entry-1",
      prompt: "",
      attachment_ids: [],
      agent_profile_id: null,
      llm_provider_id: null,
      status: "pending",
      error_msg: null,
      created_at: "2026-08-25T10:00:00Z",
    });
    // 2026-08-31-session-queue-ux task-09/10：队列三操作默认成功（接线断言只看调用参数）。
    sessionApi.reorderSessionQueue.mockResolvedValue(undefined);
    sessionApi.updateSessionQueueEntry.mockResolvedValue(makeQueueEntry());
    sessionApi.dispatchNowSessionQueueEntry.mockResolvedValue({ interrupted: false });
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
    sessionApi.getAgentSessionLogs.mockResolvedValue([]);
    sessionApi.listSessionTeamMissions.mockResolvedValue([]);
    sessionApi.triggerSessionTeamMission.mockResolvedValue({
      mission_id: "m-team-1",
      status: "planning",
      objective: null,
      scope_workspace_ids: [],
      budget_usd: null,
      workers: [],
    });
    popoverApi.listProjects.mockResolvedValue([]);
    popoverApi.listProjectWorkspaces.mockResolvedValue([]);
    sessionApi.createSession.mockResolvedValue({
      session_id: "sess-1",
      run_id: "run-1",
      lease_id: "lease-1",
      status: "active",
      stream_url: "",
    });
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-1",
      run_id: "run-2",
      status: "active",
    });
    stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // ql-20260825-011：默认空队列（服务端排队三件套）。
    sessionApi.fetchSessionQueue.mockResolvedValue([]);
    sessionApi.deleteSessionQueueEntry.mockResolvedValue(undefined);
    sessionApi.retrySessionQueueEntry.mockResolvedValue({
      id: "entry-1",
      prompt: "",
      attachment_ids: [],
      agent_profile_id: null,
      llm_provider_id: null,
      status: "pending",
      error_msg: null,
      created_at: "2026-08-25T10:00:00Z",
    });
  });

  /** 首发建会话并推进到指定态："active-idle"（首轮完成）或 "running"。 */
  async function reachState(target: "active-idle" | "running") {
    setupPanel();
    const input = screen.getByPlaceholderText(/输入首条消息创建会话.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());
    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    });
    if (target === "active-idle") {
      act(() => {
        conn.handlers.route(
          makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
        );
      });
    }
    return conn;
  }

  it("idle 首句：附件入口禁用（createSession 契约无附件），title 提示创建后可用", () => {
    setupPanel();
    // ql-20260827-020：📎 收敛进 ＋ 功能菜单——先开菜单再断言菜单项
    // （＋ 不随输入框 disabled，禁用原因在菜单项 title 上）。
    fireEvent.click(screen.getByRole("button", { name: "更多功能" }));
    const clip = screen.getByTitle("发送首条消息创建会话后可添加附件") as HTMLButtonElement;
    expect(clip.disabled).toBe(true);
  });

  it("codex 引擎：附件入口禁用（D-6 同构），title 提示引擎不支持", () => {
    setupPanel({ providers: ["codex"], defaultProvider: "codex" });
    // 同上：附件入口在 ＋ 功能菜单内。
    fireEvent.click(screen.getByRole("button", { name: "更多功能" }));
    const clip = screen.getByTitle("当前引擎不支持附件") as HTMLButtonElement;
    expect(clip.disabled).toBe(true);
  });

  it("active 追问：粘贴图片 + 文本发送 → injectSession 带 attachment_ids，占位气泡含标记行", async () => {
    await reachState("active-idle");
    const att = makeAtt("att-1", "shot.png", "image");

    const input = screen.getByPlaceholderText(/继续追问.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    expect(pasteFile(input, att)).toBe(false);
    expect(uploadSessionAttachment).toHaveBeenCalledWith(
      expect.any(File),
      "image",
    );
    expect(await screen.findByTitle("shot.png · 2KB")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "看下这张图" } });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-1", "看下这张图", {
      attachment_ids: ["att-1"],
    });
    // 占位轮气泡 prompt = 标记行 + 正文（镜像 page 模式；用户气泡是纯文本
    // 渲染，直接对 body 文本断言避免函数匹配器命中祖先容器）。
    expect(document.body.textContent).toContain("[附件:att-1|image|shot.png]");
    expect(screen.getByText(/看下这张图/)).toBeInTheDocument();
  });

  it("running 排队（服务端 ql-20260825-011）：忙轮附件消息直达后端入队（inject 带 attachment_ids），队列条显示 📎1", async () => {
    const conn = await reachState("running");
    const att = makeAtt("att-2", "note.md", "file");
    // 忙轮 inject → 后端排队；队列条数据源 = GET /queue。
    sessionApi.injectSession.mockResolvedValue({
      session_id: "sess-1", run_id: null, status: "queued", queued: true,
      queue_entry_id: "entry-2",
    });
    sessionApi.fetchSessionQueue.mockResolvedValue([
      {
        id: "entry-2",
        prompt: "排队带附件",
        attachment_ids: ["att-2"],
        agent_profile_id: null,
        llm_provider_id: null,
        status: "pending",
        error_msg: null,
        created_at: "2026-08-25T10:00:00Z",
      },
    ]);

    const input = screen.getByPlaceholderText(/排队/) as HTMLTextAreaElement;
    pasteFile(input, att);
    await screen.findByTitle("note.md · 2KB");
    fireEvent.change(input, { target: { value: "排队带附件" } });
    fireEvent.click(screen.getByTitle("发送"));

    // 忙轮消息（含附件引用）直达后端入队。
    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-1", "排队带附件", {
      attachment_ids: ["att-2"],
    });
    // 排队条可见且带附件数（计数文本被插值拆多节点，按 span 精确断言）。
    const queueLabels = await screen.findAllByText(
      (_, el) => el?.tagName === "SPAN" && el.textContent === "排队消息（1）",
    );
    expect(queueLabels.length).toBeGreaterThanOrEqual(1);
    const clipBadges = screen.getAllByText(
      (_, el) => el?.tagName === "SPAN" && el.textContent === "📎 1",
    );
    expect(clipBadges.length).toBeGreaterThanOrEqual(1);

    // 本轮完成 → SSE 触发队列刷新（服务端自动派发，队列清空）。
    sessionApi.fetchSessionQueue.mockResolvedValue([]);
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
      );
    });
    await waitFor(() =>
      expect(
        screen.queryAllByText(
          (_, el) => el?.tagName === "SPAN" && el.textContent === "排队消息（1）",
        ),
      ).toHaveLength(0),
    );
  });

  it("D-7：附件非空豁免空文本（看图说话），发送按钮可点且 prompt 为空串", async () => {
    await reachState("active-idle");
    const att = makeAtt("att-3", "shot.png", "image");

    const input = screen.getByPlaceholderText(/继续追问.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    pasteFile(input, att);
    await screen.findByTitle("shot.png · 2KB");

    // 空文本 + 有附件：发送按钮可点
    const sendBtn = screen.getByTitle("发送") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);

    await waitFor(() => expect(sessionApi.injectSession).toHaveBeenCalledTimes(1));
    expect(sessionApi.injectSession).toHaveBeenCalledWith("sess-1", "", {
      attachment_ids: ["att-3"],
    });
  });

  // 2026-08-31-session-queue-ux task-09/10：panel 队列接线（FR-03/04/05/06）——
  // SSE queue_changed 即时刷新 + MessageQueueBar 三回调透传三个队列操作端点。
  it("队列三操作接线：queue_changed SSE → 重新拉取队列；⚡/✎/拖拽分别透传 dispatch-now/update/reorder 端点", async () => {
    // 首句建会话前预置两条排队条目（GET /queue 返回序即 bar 渲染序）。
    sessionApi.fetchSessionQueue.mockResolvedValue([
      makeQueueEntry({ id: "entry-2", prompt: "排队甲" }),
      makeQueueEntry({ id: "entry-3", prompt: "排队乙" }),
    ]);
    const conn = await reachState("running");
    await screen.findByText("排队甲");

    // ① SSE queue_changed（FR-03）→ panel 接 onQueueChanged 调 hook refresh 重新拉取。
    const callsBefore = sessionApi.fetchSessionQueue.mock.calls.length;
    act(() => {
      conn.handlers.route(makeEnvelope("queue_changed", { action: "reordered" }));
    });
    await waitFor(() =>
      expect(sessionApi.fetchSessionQueue.mock.calls.length).toBeGreaterThan(callsBefore),
    );

    // ② ⚡ 立即发送（FR-05）：透传 dispatch-now 端点（sess-1 + 条目 id）。
    fireEvent.click(screen.getAllByLabelText("打断当前轮，立即发送这条")[0]!);
    await waitFor(() =>
      expect(sessionApi.dispatchNowSessionQueueEntry).toHaveBeenCalledWith("sess-1", "entry-2"),
    );

    // ③ ✎ 重新编辑（FR-06）：textarea 预填原文，保存透传 update 端点带新文本
    //    （antd 两字中文自动插空格，按可访问名正则匹配「保 存」）。
    fireEvent.click(screen.getAllByLabelText("重新编辑该消息")[0]!);
    const editor = screen.getByLabelText("重新编辑排队消息文本") as HTMLTextAreaElement;
    expect(editor.value).toBe("排队甲");
    fireEvent.change(editor, { target: { value: "排队甲（改）" } });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() =>
      expect(sessionApi.updateSessionQueueEntry).toHaveBeenCalledWith("sess-1", "entry-2", "排队甲（改）"),
    );

    // ④ 拖拽换位（FR-04 / D-003）：dragStart → dragOver 目标后半区 → drop，
    //    全量有序 ids 透传 reorder 端点。jsdom 无布局与 DragEvent：目标 chip
    //    rect 打元素级 spy，dragOver 按 MouseEvent 手工构造携带 clientX。
    const handles = screen.getAllByTitle("拖拽排序");
    const chipFirst = handles[0]!.closest('[draggable="true"]') as HTMLElement;
    const chipSecond = handles[1]!.closest('[draggable="true"]') as HTMLElement;
    vi.spyOn(chipSecond, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    } as DOMRect);
    const dt = { effectAllowed: "none", dropEffect: "none", setData: vi.fn() };
    fireEvent.dragStart(chipFirst, { dataTransfer: dt });
    fireEvent(
      chipSecond,
      createEvent(
        "dragover",
        chipSecond,
        { clientX: 75, bubbles: true, cancelable: true, dataTransfer: dt },
        { EventType: "MouseEvent" },
      ),
    );
    fireEvent.drop(chipSecond, { dataTransfer: dt });
    fireEvent.dragEnd(chipFirst);
    await waitFor(() =>
      expect(sessionApi.reorderSessionQueue).toHaveBeenCalledWith("sess-1", [
        "entry-3",
        "entry-2",
      ]),
    );
  });
});
