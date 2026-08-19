/**
 * task-15: lib/workspaces.ts scanGenerate spec_strategy 透传测（D-006@v1）。
 *
 * 2026-07-10-remove-server-local-workspace-mode（task-11）：scanGenerate 签名
 * 精简为 (rootPath, provider?, model?, specStrategy?, daemonId?) —— path_source
 * 字段从请求体移除（平台统一 daemon-client），daemon_id 替代旧 daemon_runtime_id。
 *
 * 覆盖：请求体含 spec_strategy 透传给 POST /api/workspaces/scan-generate。
 * 按钮渲染/互斥的 page 层测试见 workspaces/[id]/page.test.tsx。
 *
 * task-05 / 2026-08-18-workspace-role-type：补 CreateWorkspaceInput /
 * UpdateWorkspaceInput 字段断言——Create.type 必填（tsc 层 @ts-expect-error +
 * 运行时请求体透传）、Update 三字段（type/role/description）omit 不传 /
 * 显式传值透传（D-005@v1 的 omit=不改语义由请求体缺键表达，null 清空语义
 * 由 body 显式 null 表达）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkspace,
  scanGenerate,
  updateWorkspace,
  type CreateWorkspaceInput,
} from "@/lib/workspaces";

// ── fetch harness（仿 lib/daemon.test.ts）──────────────────────────────────

function mockFetch(resp: { status: number; body: unknown }) {
  const fetchMock = vi.fn();
  const bodyStr = JSON.stringify(resp.body);
  let lastUrl = "";
  let lastInit: RequestInit | undefined;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    const headers = new Headers({ "content-type": "application/json" });
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status === 200 ? "OK" : "Error",
      headers,
      text: async () => bodyStr,
      json: async () => resp.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    lastUrl: () => lastUrl,
    lastBody: (): Record<string, unknown> | null => {
      if (!lastInit?.body) return null;
      try {
        return JSON.parse(lastInit.body as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
}

describe("scanGenerate spec_strategy 透传（task-14 / D-006@v1）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const OK = { workspace_id: "ws-1", agent_run_id: "run-1" };

  it("传 specStrategy + daemonId 时请求体含 spec_strategy + daemon_id（无 path_source/daemon_runtime_id）", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate(
      "C:/proj",
      null,
      null,
      "repo-native",
      "daemon-1",
    );
    expect(h.lastUrl()).toContain("/api/workspaces/scan-generate");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.root_path).toBe("C:/proj");
    expect(body!.spec_strategy).toBe("repo-native");
    expect(body!.daemon_id).toBe("daemon-1");
    // 2026-07-10：path_source / daemon_runtime_id 已从请求体移除。
    expect(body!.path_source).toBeUndefined();
    expect(body!.daemon_runtime_id).toBeUndefined();
  });

  it("不传 specStrategy 时请求体不含 spec_strategy", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate("C:/proj", null, null, undefined, "daemon-1");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.spec_strategy).toBeUndefined();
    expect(body!.daemon_id).toBe("daemon-1");
  });

  it("三策略值均可透传", async () => {
    const strategies = ["platform-managed", "repo-mirrored", "repo-native"] as const;
    for (const strat of strategies) {
      const h = mockFetch({ status: 200, body: OK });
      await scanGenerate("C:/proj", null, null, strat, "daemon-1");
      expect(h.lastBody()?.spec_strategy).toBe(strat);
    }
  });

  it("仅 rootPath（无 daemon/spec）→ 请求体只含 root_path", async () => {
    const h = mockFetch({ status: 200, body: OK });
    await scanGenerate("C:/proj");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.root_path).toBe("C:/proj");
    expect(body!.spec_strategy).toBeUndefined();
    expect(body!.daemon_id).toBeUndefined();
    expect(body!.path_source).toBeUndefined();
  });
});

// ── task-05 / 2026-08-18-workspace-role-type：Create/Update Input 字段 ──────

describe("createWorkspace Input 字段（task-05 / D-002@v1）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WS_OK = { workspace_id: "ws-1", name: "n", status: "active" };

  it("type 必填：缺 type 的对象过不了类型检查（tsc 层断言）", () => {
    // CreateWorkspaceInput.type 必填——缺字段的对象字面量在编译期即红。
    // @ts-expect-error 若后续误把 type 改回可选，此标记变成「未生效的
    // expect-error」（tsc 报 TS2578），typecheck 即失败提醒词表约束被削弱。
    const missingType: CreateWorkspaceInput = {
      name: "n",
      root_path: "C:/proj",
    };
    expect(missingType.name).toBe("n");
  });

  it("提交体透传 type 与可选 role/description", async () => {
    const h = mockFetch({ status: 200, body: WS_OK });
    await createWorkspace({
      name: "订单服务",
      root_path: "C:/proj/order",
      daemon_id: "daemon-1",
      type: "backend-code",
      role: "订单模块",
      description: "订单域后端服务",
    });
    expect(h.lastUrl()).toContain("/api/workspaces");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.type).toBe("backend-code");
    expect(body!.role).toBe("订单模块");
    expect(body!.description).toBe("订单域后端服务");
  });

  it("可选字段缺省时提交体不含 role/description 键（omit 语义）", async () => {
    const h = mockFetch({ status: 200, body: WS_OK });
    await createWorkspace({ name: "n", root_path: "C:/proj", type: "other" });
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.type).toBe("other");
    expect(body!.role).toBeUndefined();
    expect(body!.description).toBeUndefined();
  });
});

describe("updateWorkspace Input 字段（task-05 / D-005@v1）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WS_OK = { workspace_id: "ws-1", name: "n", status: "active" };

  it("omit：只传意图字段时请求体不含 type/role/description 键", async () => {
    const h = mockFetch({ status: 200, body: WS_OK });
    await updateWorkspace("ws-1", { name: "改名" });
    expect(h.lastUrl()).toContain("/api/workspaces/ws-1");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.name).toBe("改名");
    expect(body!.type).toBeUndefined();
    expect(body!.role).toBeUndefined();
    expect(body!.description).toBeUndefined();
  });

  it("显式传值：type/role/description 三字段均可透传", async () => {
    const h = mockFetch({ status: 200, body: WS_OK });
    await updateWorkspace("ws-1", {
      type: "frontend-code",
      role: "管理后台",
      description: "运营侧管理界面",
    });
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.type).toBe("frontend-code");
    expect(body!.role).toBe("管理后台");
    expect(body!.description).toBe("运营侧管理界面");
  });

  it("显式 null：三字段均以 null 进请求体（D-005 清空语义）", async () => {
    const h = mockFetch({ status: 200, body: WS_OK });
    await updateWorkspace("ws-1", {
      type: null,
      role: null,
      description: null,
    });
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.type).toBeNull();
    expect(body!.role).toBeNull();
    expect(body!.description).toBeNull();
  });
});
