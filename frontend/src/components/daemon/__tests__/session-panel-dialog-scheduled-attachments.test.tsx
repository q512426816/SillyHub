// 2026-10-27-scheduled-send-attachments：dialog 模式定时消息携带附件测试。
//
// 背景：用户报障定时消息发送后 agent 收不到附件。排查确认后端全链路已支持
// （ScheduledMessageCreateRequest.attachment_ids → 落库快照 → 到点 sweeper 派发
// 重放走 inject 附件管线），缺口在前端——confirmSchedCreate 只组装
// prompt+dispatch_at，附件被静默丢弃；且创建成功只清文本不清附件 chips（残留
// 误导重复发送）。
//
// 本文件覆盖 dialog 模式修复后的行为（page 模式 confirmSchedCreate 与 dialog
// 逐字对齐，展示面由 dialog 侧代表）：
//   - FR-03：定时弹窗展示附件预览行（图标+文件名），无附件不渲染；
//   - FR-01：创建请求携带 attachment_ids；无附件请求形态与现状一致（零回归）；
//   - FR-02：创建成功清附件 chips + 元数据镜像；失败保留现场；
//   - FR-04：带附件空文本可创建（D-7 看图说话），空文本且无附件仍禁用确认。
//
// mock 结构沿用 session-panel-dialog-attachments.test.tsx（lib/daemon + 弹层数据
// 源 + 假 SSE 连接工厂 + 附件上传模块级 mock），另补 createScheduledMessage /
// listScheduledMessages 两个定时域函数。

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
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

// 附件上传模块级 mock（上传不打真 fetch）。
vi.mock("@/lib/api/session-attachments", () => ({
  uploadSessionAttachment: vi.fn(),
  removeSessionAttachment: vi.fn(),
  fetchAttachmentObjectUrl: vi.fn(),
  fetchAttachmentBlob: vi.fn(async () => new Blob(["x"])),
}));

// useNotify spy（测试环境无 <AntApp> 包裹，不起 message DOM——照
// scheduled-messages-bar.test.tsx 先例；errMessage 保真用真实现）。
vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return {
    errMessage: actual.errMessage,
    useNotify: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
  };
});

/* ----- mock lib/daemon（同 dialog 附件测试） ----- */

const sessionApi = vi.hoisted(() => ({
  getSessionUsage: vi.fn().mockResolvedValue(null),
  listSessionTasks: vi.fn().mockResolvedValue([]),
  listScheduledMessages: vi.fn().mockResolvedValue([]),
  createScheduledMessage: vi.fn(),
  createSession: vi.fn(),
  injectSession: vi.fn(),
  interruptSession: vi.fn(),
  endSession: vi.fn(),
  streamSession: vi.fn(),
  getAgentSession: vi.fn().mockResolvedValue(null),
  listSessionRuns: vi.fn().mockResolvedValue([]),
  getAgentSessionLogs: vi.fn(),
  fetchSessionTurnOutline: vi.fn(),
  fetchPendingDialogs: vi.fn(),
  fetchSessionDialogHistory: vi.fn(),
  listSessionTeamMissions: vi.fn(),
  triggerSessionTeamMission: vi.fn(),
  fetchSessionQueue: vi.fn(),
  deleteSessionQueueEntry: vi.fn(),
  retrySessionQueueEntry: vi.fn(),
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
    listSessionTasks: sessionApi.listSessionTasks,
    // 定时消息域（ScheduledMessagesBar 挂载即取数 + 本文件被测的创建入口）。
    listScheduledMessages: sessionApi.listScheduledMessages,
    createScheduledMessage: sessionApi.createScheduledMessage,
    createSession: sessionApi.createSession,
    injectSession: sessionApi.injectSession,
    interruptSession: sessionApi.interruptSession,
    endSession: sessionApi.endSession,
    streamSession: sessionApi.streamSession,
    getAgentSession: sessionApi.getAgentSession,
    listSessionRuns: sessionApi.listSessionRuns,
    getAgentSessionLogs: sessionApi.getAgentSessionLogs,
    fetchSessionTurnOutline: sessionApi.fetchSessionTurnOutline,
    fetchPendingDialogs: sessionApi.fetchPendingDialogs,
    fetchSessionDialogHistory: sessionApi.fetchSessionDialogHistory,
    listSessionTeamMissions: sessionApi.listSessionTeamMissions,
    triggerSessionTeamMission: sessionApi.triggerSessionTeamMission,
    fetchSessionQueue: sessionApi.fetchSessionQueue,
    deleteSessionQueueEntry: sessionApi.deleteSessionQueueEntry,
    retrySessionQueueEntry: sessionApi.retrySessionQueueEntry,
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

/* ----- fake SSE connection（同 dialog 附件测试） ----- */

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

/** 粘贴文件到输入框（同 dialog 附件测试——📎/粘贴同一上传管线）。 */
function pasteFile(input: Element, att: AttachmentRead) {
  const file = new File(["xx"], att.name, {
    type: att.kind === "image" ? "image/png" : "text/plain",
  });
  vi.mocked(uploadSessionAttachment).mockResolvedValue(att);
  return fireEvent.paste(input, {
    clipboardData: { files: [file], getData: () => "" },
  });
}

describe("SessionPanel（dialog）定时消息携带附件（2026-10-27-scheduled-send-attachments）", () => {
  let stream: ReturnType<typeof makeStreamMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionApi.fetchSessionQueue.mockResolvedValue([]);
    sessionApi.fetchPendingDialogs.mockResolvedValue([]);
    sessionApi.fetchSessionDialogHistory.mockResolvedValue([]);
    sessionApi.getAgentSessionLogs.mockResolvedValue([]);
    sessionApi.fetchSessionTurnOutline.mockResolvedValue({ session_id: "s-1", total_turns: 0, items: [] });
    sessionApi.listSessionTeamMissions.mockResolvedValue([]);
    sessionApi.triggerSessionTeamMission.mockResolvedValue({
      mission_id: "m-team-1",
      status: "planning",
      objective: null,
      scope_workspace_ids: [],
      budget_usd: null,
      workers: [],
    });
    sessionApi.listScheduledMessages.mockResolvedValue([]);
    // 创建成功默认响应（ScheduledMessageRead 形态，本文件只断言入参）。
    sessionApi.createScheduledMessage.mockResolvedValue({
      id: "sched-1",
      agent_session_id: "sess-1",
      sender_user_id: "u-1",
      prompt: "",
      attachment_ids: null,
      agent_profile_id: null,
      llm_provider_id: null,
      dispatch_at: "2026-10-27T12:00:00Z",
      status: "pending",
      error_code: null,
      error_message: null,
      dispatched_at: null,
      cancelled_at: null,
      created_at: "2026-10-27T00:00:00Z",
      updated_at: null,
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
    stream = makeStreamMock();
    sessionApi.streamSession.mockImplementation(stream.factory);
  });

  /** 首发建会话并推进到 active-idle（首轮完成，追问输入可用）。 */
  async function reachActiveIdle() {
    setupPanel();
    const input = screen.getByPlaceholderText(/输入首条消息创建会话.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByTitle("发送"));
    await waitFor(() => expect(sessionApi.createSession).toHaveBeenCalled());
    const conn = stream.conn;
    act(() => {
      conn.handlers.route(makeEnvelope("turn_started", { run_id: "run-1", turn: 1 }));
    });
    act(() => {
      conn.handlers.route(
        makeEnvelope("turn_completed", { run_id: "run-1", status: "completed" }),
      );
    });
    return input;
  }

  /** 上传两个附件（图 + 文件）并等 chips 到位，返回追问输入框。 */
  async function attachTwoFiles() {
    const input = screen.getByPlaceholderText(/继续追问.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    pasteFile(input, makeAtt("att-img", "shot.png", "image"));
    pasteFile(input, makeAtt("att-doc", "note.md", "file"));
    await screen.findByTitle("shot.png · 2KB（点击在线预览 / 右击插入正文引用）");
    await screen.findByTitle("note.md · 2KB（点击在线预览 / 右击插入正文引用）");
    return input;
  }

  it("FR-03：定时弹窗展示附件预览列表（图标+文件名）", async () => {
    await reachActiveIdle();
    await attachTwoFiles();
    fireEvent.click(screen.getByRole("button", { name: "定时发送" }));

    const previews = await screen.findAllByTestId("scheduled-attachment-preview");
    expect(previews).toHaveLength(2);
    const previewText = previews.map((p) => p.textContent ?? "").join("|");
    expect(previewText).toContain("shot.png");
    expect(previewText).toContain("note.md");
  });

  it("FR-01：定时创建请求携带附件 id；创建成功后附件 chips 清空（FR-02）", async () => {
    await reachActiveIdle();
    await attachTwoFiles();
    const input = screen.getByPlaceholderText(/继续追问.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "看下这两份材料" } });
    fireEvent.click(screen.getByRole("button", { name: "定时发送" }));

    fireEvent.click(await screen.findByRole("button", { name: "创建定时消息" }));

    await waitFor(() => expect(sessionApi.createScheduledMessage).toHaveBeenCalledTimes(1));
    const [sid, body] = sessionApi.createScheduledMessage.mock.calls[0] ?? [];
    expect(sid).toBe("sess-1");
    expect(body.prompt).toBe("看下这两份材料");
    expect(typeof body.dispatch_at).toBe("string");
    // FR-01 核心断言：附件 id 随请求体携带。
    expect(body.attachment_ids).toEqual(["att-img", "att-doc"]);

    // FR-02：创建成功 → 附件 chips 全部消失（输入区不再有待发附件）。
    await waitFor(() => {
      expect(screen.queryByTitle("shot.png · 2KB（点击在线预览 / 右击插入正文引用）")).toBeNull();
    });
    expect(screen.queryByTitle("note.md · 2KB（点击在线预览 / 右击插入正文引用）")).toBeNull();
    // 文本草稿同步清空（既有口径不回归）。
    expect(input.value).toBe("");
  });

  it("FR-01 零回归：无附件创建请求体保持既有形态（不携带 attachment_ids 键）", async () => {
    await reachActiveIdle();
    const input = screen.getByPlaceholderText(/继续追问.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "纯文本定时" } });
    fireEvent.click(screen.getByRole("button", { name: "定时发送" }));

    fireEvent.click(await screen.findByRole("button", { name: "创建定时消息" }));

    await waitFor(() => expect(sessionApi.createScheduledMessage).toHaveBeenCalledTimes(1));
    const [, body] = sessionApi.createScheduledMessage.mock.calls[0] ?? [];
    // 严格相等：请求体仅 prompt + dispatch_at，无空数组占位键。
    expect(Object.keys(body).sort()).toEqual(["dispatch_at", "prompt"]);
  });

  it("FR-04：带附件空文本可创建（看图说话），请求 prompt 空串 + 附件携带", async () => {
    await reachActiveIdle();
    await attachTwoFiles();
    // 不输入文本直接开弹窗。
    fireEvent.click(screen.getByRole("button", { name: "定时发送" }));

    // 附件豁免空文本：确认按钮可用（空文本且无附件才禁用）。
    const confirm = (await screen.findByRole("button", { name: "创建定时消息" })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(sessionApi.createScheduledMessage).toHaveBeenCalledTimes(1));
    const [, body] = sessionApi.createScheduledMessage.mock.calls[0] ?? [];
    expect(body.prompt).toBe("");
    expect(body.attachment_ids).toEqual(["att-img", "att-doc"]);
  });

  it("FR-04 兜底：空文本且无附件仍禁用确认（现状行为不变）", async () => {
    await reachActiveIdle();
    fireEvent.click(screen.getByRole("button", { name: "定时发送" }));

    const confirm = (await screen.findByRole("button", { name: "创建定时消息" })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    // 空态提示文案仍在。
    expect(screen.getByText(/输入内容为空，无法创建定时消息/)).toBeInTheDocument();
  });

  it("FR-02 失败路径：创建失败附件 chips 原地保留可重试", async () => {
    await reachActiveIdle();
    await attachTwoFiles();
    const input = screen.getByPlaceholderText(/继续追问.*\/ 唤起技能 · @ 关联变更/) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "定时带附件" } });
    sessionApi.createScheduledMessage.mockRejectedValueOnce(
      Object.assign(new Error("定时发送时间必须至少在 60 秒之后。"), { status: 422 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "定时发送" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建定时消息" }));

    await waitFor(() => expect(sessionApi.createScheduledMessage).toHaveBeenCalledTimes(1));
    // 失败：附件 chips 与文本保留，弹窗保持打开可改后重试。
    expect(screen.getByTitle("shot.png · 2KB（点击在线预览 / 右击插入正文引用）")).toBeInTheDocument();
    expect(screen.getByTitle("note.md · 2KB（点击在线预览 / 右击插入正文引用）")).toBeInTheDocument();
    expect(input.value).toBe("定时带附件");
    expect(screen.getByRole("button", { name: "创建定时消息" })).toBeInTheDocument();
  });
});
