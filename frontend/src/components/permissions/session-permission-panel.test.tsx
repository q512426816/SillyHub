/**
 * SessionPermissionPanel 测试（2026-07-09-ask-user-question-approval task-09）。
 *
 * 覆盖（design §4.2/§4.3/§4.4）：
 *   - 渲染分流：dialog_kind 有 → AskUserDialogCard；无 → PermissionApprovalCard（AC-1/6）；
 *   - 聚合去重：同 request_id 的 SSE 推入与查询兜底合并后只一张卡（AC-2）；
 *   - SSE 占位→查询回填：SSE 推入时 session_type 缺省→占位「加载中」；查询注入同
 *     request_id 带真实来源字段→占位被覆盖回填（design §4.4 C4：查询覆盖 SSE，不反向）；
 *   - permission_resolved 按 request_id 移除卡片。
 *
 * EventSource mock：捕获每个 session 的 onmessage 句柄，测试手动 dispatch
 * MessageEvent 触发 SSE 路径（与 session-permission-panel.tsx:50 解析路径一致）。
 */

import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPermissionPanel } from "@/components/permissions/session-permission-panel";
import { mergeDialogRequests } from "@/components/permissions/session-permission-panel";
import type { SessionPermissionRequest } from "@/lib/daemon";

// ── next/link mock（DialogContextBar 用 Link）──
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ── useSession mock（panel 读 accessToken）──
vi.mock("@/stores/session", () => ({
  useSession: (selector: (s: { accessToken: string }) => string) =>
    selector({ accessToken: "test-token" }),
}));

// ── getApiBaseUrl mock（SSE URL 构造）──
vi.mock("@/lib/api", () => ({
  getApiBaseUrl: () => "http://localhost",
}));

// ── EventSource mock：暴露 onmessage 供测试 dispatch ──

interface MockEventSourceInstance {
  url: string;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

const instances: MockEventSourceInstance[] = [];

class FakeEventSource {
  url: string;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    instances.push(this as unknown as MockEventSourceInstance);
  }
  close() {
    /* no-op */
  }
}

function dispatchMessage(inst: MockEventSourceInstance, data: unknown) {
  const event = {
    data: JSON.stringify(data),
    lastEventId: "",
  } as MessageEvent<string>;
  act(() => {
    inst.onmessage?.(event);
  });
}

function makeDialogRequest(
  overrides: Partial<SessionPermissionRequest> = {},
): SessionPermissionRequest {
  return {
    session_id: "sess-1",
    run_id: "run-1",
    request_id: "req-1",
    tool_name: "AskUserQuestion",
    input: {},
    dialog_kind: "ask_user",
    dialog_payload: {
      questions: [
        {
          question: "前端框架是？",
          header: "框架",
          options: [{ label: "Next.js" }, { label: "Vue" }],
        },
      ],
    },
    ...overrides,
  };
}

describe("SessionPermissionPanel", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    instances.length = 0;
  });

  it("dialog_kind 非空 → 渲染 AskUserDialogCard（结构化问答）", () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest(),
    });
    // AskUserDialogCard 渲染问题文本 + 提交按钮
    expect(screen.getByText("前端框架是？")).toBeInTheDocument();
    expect(screen.getByText("Next.js")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /提交回答/ }),
    ).toBeInTheDocument();
  });

  it("dialog_kind 缺失 → 渲染 PermissionApprovalCard（allow/deny）", () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;
    dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({
        request_id: "req-no-dialog",
        tool_name: "Bash",
        dialog_kind: undefined,
        dialog_payload: undefined,
        input: { command: "ls" },
      }),
    });
    // PermissionApprovalCard 渲染允许/拒绝按钮 + tool_name badge
    expect(screen.getByRole("button", { name: /允许/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /拒绝/ })).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
  });

  it("聚合去重：同 request_id SSE + 查询兜底合并后只一张卡", () => {
    const req = makeDialogRequest();
    render(
      <SessionPermissionPanel
        sessionIds={["sess-1"]}
        pendingFallback={[req]}
      />,
    );
    // pendingFallback 注入一次（查询路），SSE 再推同 request_id
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"));
    if (inst) {
      dispatchMessage(inst, { event: "permission_request", ...req });
    }
    // 只渲染一张问答卡（去重）
    const submitBtns = screen.getAllByRole("button", { name: /提交回答/ });
    expect(submitBtns).toHaveLength(1);
  });

  it("SSE 占位「加载中」→ 查询回填覆盖（C4：查询覆盖 SSE，不反向）", () => {
    // 单组件实例：先无 pendingFallback 渲染并推 SSE 占位，再 rerender 注入查询兜底。
    // sessionIds 用稳定引用常量，避免 rerender 传新数组触发 sessionIds useEffect 清空 cards。
    const sessionIds = ["sess-1"];
    const { rerender } = render(
      <SessionPermissionPanel sessionIds={sessionIds} />,
    );
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;

    // SSE 推入：来源字段缺省 → 占位「加载中」
    dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({ session_type: undefined }),
    });
    expect(screen.getByText("加载中")).toBeInTheDocument();

    // 单组件 rerender 注入查询兜底：同 request_id 带真实来源字段（fromQuery=true 覆盖占位）
    rerender(
      <SessionPermissionPanel
        sessionIds={sessionIds}
        pendingFallback={[
          makeDialogRequest({
            session_type: "scan",
            run_summary: "扫描工作区",
          }),
        ]}
      />,
    );
    expect(screen.queryByText("加载中")).not.toBeInTheDocument();
    expect(screen.getByText("扫描")).toBeInTheDocument();
    expect(screen.getByText("扫描工作区")).toBeInTheDocument();
  });

  it("permission_resolved 按 request_id 移除卡片", () => {
    render(<SessionPermissionPanel sessionIds={["sess-1"]} />);
    const inst = instances.find((i) => i.url.includes("/sess-1/stream"))!;

    dispatchMessage(inst, {
      event: "permission_request",
      ...makeDialogRequest({ request_id: "req-to-remove" }),
    });
    expect(screen.getByText("前端框架是？")).toBeInTheDocument();

    dispatchMessage(inst, {
      event: "permission_resolved",
      session_id: "sess-1",
      request_id: "req-to-remove",
      decision: "allow",
      reason: "manual",
    });
    expect(screen.queryByText("前端框架是？")).not.toBeInTheDocument();
  });

  it("无 sessionIds 且无 pendingFallback → 不渲染（返回 null）", () => {
    const { container } = render(
      <SessionPermissionPanel sessionIds={[]} pendingFallback={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("task-10/NFR-1：sessionIds 超 SSE 硬上限（50）时只开 50 个 EventSource", () => {
    // 51 个 active session：超出部分不开 SSE，靠 GET /dialogs refetch 兜底。
    const sessionIds = Array.from({ length: 51 }, (_, i) => `sess-${i}`);
    render(<SessionPermissionPanel sessionIds={sessionIds} />);
    expect(instances).toHaveLength(50);
    // 前 50 个 session 均开了 SSE
    for (let i = 0; i < 50; i++) {
      expect(instances.some((ins) => ins.url.includes(`/sess-${i}/stream`))).toBe(
        true,
      );
    }
    // 第 51 个（index 50）未开 SSE
    expect(instances.some((ins) => ins.url.includes("/sess-50/stream"))).toBe(
      false,
    );
  });
});

describe("mergeDialogRequests（纯函数）", () => {
  const base: SessionPermissionRequest = {
    session_id: "s",
    run_id: "r",
    request_id: "req-1",
    tool_name: "AskUserQuestion",
    input: {},
  };

  it("新 request_id → 追加", () => {
    const result = mergeDialogRequests([], base);
    expect(result).toHaveLength(1);
    expect(result[0]!.request_id).toBe("req-1");
  });

  it("查询回填覆盖 SSE 占位：来源字段从 undefined 回填为真实值（fromQuery=true）", () => {
    const sseReq: SessionPermissionRequest = {
      ...base,
      session_type: undefined,
      run_summary: undefined,
      workspace_name: undefined,
    };
    const queryReq: SessionPermissionRequest = {
      ...base,
      session_type: "scan",
      run_summary: "扫描中",
      workspace_name: "ws-name",
    };
    const result = mergeDialogRequests([sseReq], queryReq, true);
    expect(result).toHaveLength(1);
    expect(result[0]!.session_type).toBe("scan");
    expect(result[0]!.run_summary).toBe("扫描中");
    expect(result[0]!.workspace_name).toBe("ws-name");
  });

  it("SSE 不反向覆盖查询：SSE 推入缺省来源时不覆盖已有真实值（fromQuery=false）", () => {
    const queryReq: SessionPermissionRequest = {
      ...base,
      session_type: "scan",
      run_summary: "扫描中",
      workspace_name: "ws-name",
    };
    // SSE 再推同 id，来源字段全缺省
    const sseReq: SessionPermissionRequest = {
      ...base,
      session_type: undefined,
      run_summary: undefined,
      workspace_name: undefined,
    };
    const result = mergeDialogRequests([queryReq], sseReq, false);
    expect(result).toHaveLength(1);
    // 真实来源字段保留，不被 undefined 覆盖（C4：不反向）
    expect(result[0]!.session_type).toBe("scan");
    expect(result[0]!.run_summary).toBe("扫描中");
    expect(result[0]!.workspace_name).toBe("ws-name");
  });

  it("run_summary=null 不回填（保留旧值，避免 null 反向覆盖）", () => {
    const queryReq: SessionPermissionRequest = {
      ...base,
      run_summary: "旧值",
    };
    const incomingNull: SessionPermissionRequest = {
      ...base,
      run_summary: null,
    };
    const result = mergeDialogRequests([queryReq], incomingNull, true);
    expect(result[0]!.run_summary).toBe("旧值");
  });
});
