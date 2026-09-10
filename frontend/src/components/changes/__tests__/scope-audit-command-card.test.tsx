/**
 * scope-audit 范围对账命令卡测试（ql-20260910-014-6c29）。
 *
 * 覆盖：
 *   1. 纯函数：buildScopeAuditCommand（前缀 / identifier / --json 追加）+
 *      SCOPE_AUDIT_CMD_PREFIX 单一取值点 + findQuickSessionName（命中 / ql_id
 *      缺失 / 空 status）
 *   2. change 目标：表格版与 JSON 版两行命令代入 change_key，无占位提示
 *   3. quick 目标已解析：机器快照 sillyspec_status_map 按 ql_id 反查
 *      quick-<8hex> 会话名代入两行命令
 *   4. quick 目标未解析（无绑定 daemon）：占位符 <quick会话ID> + 手动替换提示
 *   5. 复制交互：clipboard.writeText 收到完整命令文本
 *
 * mock 范式照 quicklog-drawer.test：importActual 部分 mock +
 * QueryClientProvider（retry: false 防失败查询重试拖慢）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QUICK_ID_PLACEHOLDER,
  SCOPE_AUDIT_CMD_PREFIX,
  ScopeAuditCommandCard,
  buildScopeAuditCommand,
  findQuickSessionName,
} from "@/components/changes/scope-audit-command-card";
import type { DaemonMachineRead } from "@/lib/daemon";
import type { components } from "@/lib/api-types";

const mocks = vi.hoisted(() => ({
  fetchMyBinding: vi.fn(),
  listDaemonMachines: vi.fn(),
}));

vi.mock("@/lib/workspace-binding", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspace-binding")>(
      "@/lib/workspace-binding",
    );
  return { ...actual, fetchMyBinding: mocks.fetchMyBinding };
});

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>(
    "@/lib/daemon",
  );
  return { ...actual, listDaemonMachines: mocks.listDaemonMachines };
});

type SillySpecStatus = components["schemas"]["MachineSillySpecStatusRead"];

/** 机器 fixture：sillyspec_status_map["ws-1"] 含普通变更 + 带 ql_id 的 quick 条。 */
function makeMachine(
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
  const status: SillySpecStatus = {
    changes: [
      {
        name: "2026-09-10-mcp-central-registry",
        ghost: false,
        current_stage: "execute",
        stage_label: "执行",
        last_active: "2026-09-10T11:59:00+00:00",
        steps: { total: 8, completed: 3 },
      },
      {
        name: "quick-a1b2c3d4",
        ghost: false,
        current_stage: "quick",
        stage_label: "快速任务",
        last_active: "2026-09-10T11:58:00+00:00",
        steps: { total: 3, completed: 1 },
        ql_id: "ql-20260910-014-6c29",
      },
    ],
  };
  return {
    id: "dm-1",
    hostname: "dev-host",
    display_alias: null,
    os: null,
    arch: null,
    status: "online",
    last_heartbeat_at: null,
    version: null,
    build_id: null,
    started_at: null,
    created_at: "2026-09-10T00:00:00Z",
    runtime_count: 0,
    online_runtime_count: 0,
    runtimes: [],
    sillyspec_status_map: { "ws-1": status },
    ...overrides,
  } as DaemonMachineRead;
}

/** 渲染包裹（QueryClientProvider；retry: false）。 */
function renderCard(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ql-20260910-014-6c29 纯函数：命令拼接与会话名反查", () => {
  it("buildScopeAuditCommand：前缀 + identifier；--json 追加尾参；前缀单一取值点为 sillyspec", () => {
    expect(SCOPE_AUDIT_CMD_PREFIX).toBe("sillyspec");
    expect(buildScopeAuditCommand("2026-09-10-mcp-central-registry")).toBe(
      "sillyspec scope-audit --change 2026-09-10-mcp-central-registry",
    );
    expect(buildScopeAuditCommand("quick-a1b2c3d4", true)).toBe(
      "sillyspec scope-audit --change quick-a1b2c3d4 --json",
    );
  });

  it("findQuickSessionName：ql_id 命中返回会话名；不命中 / ql_id 缺失 / 空 status → null", () => {
    const status = makeMachine().sillyspec_status_map!["ws-1"]!;
    expect(findQuickSessionName(status, "ql-20260910-014-6c29")).toBe(
      "quick-a1b2c3d4",
    );
    expect(findQuickSessionName(status, "ql-9999-unknown")).toBeNull();
    expect(findQuickSessionName(null, "ql-20260910-014-6c29")).toBeNull();
  });
});

describe("ql-20260910-014-6c29 change 目标：变更详情页命令代入", () => {
  it("表格版与 JSON 版均代入 change_key；不渲染 quick 占位提示", async () => {
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "change", changeKey: "2026-09-10-mcp-central-registry" }}
      />,
    );
    expect(
      await screen.findByTestId("scope-audit-cmd-table"),
    ).toHaveTextContent(
      "sillyspec scope-audit --change 2026-09-10-mcp-central-registry",
    );
    expect(screen.getByTestId("scope-audit-cmd-json")).toHaveTextContent(
      "sillyspec scope-audit --change 2026-09-10-mcp-central-registry --json",
    );
    // change 目标无需 quick 会话 ID，不出现未解析提示。
    expect(screen.queryByText(/未解析到本条对应的 quick 会话 ID/)).toBeNull();
  });
});

describe("ql-20260910-014-6c29 quick 目标：抽屉会话名反查代入", () => {
  it("机器快照 map 按 ql_id 反查命中 → quick-<8hex> 代入两行命令", async () => {
    mocks.fetchMyBinding.mockResolvedValue({ daemon_id: "dm-1" });
    mocks.listDaemonMachines.mockResolvedValue({
      items: [makeMachine()],
      total: 1,
    });
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "quick", workspaceId: "ws-1", qlId: "ql-20260910-014-6c29" }}
      />,
    );
    // 反查经两跳 useQuery 异步解析，命令行先以占位符渲染——等内容替换为会话名。
    await waitFor(() =>
      expect(screen.getByTestId("scope-audit-cmd-table")).toHaveTextContent(
        "sillyspec scope-audit --change quick-a1b2c3d4",
      ),
    );
    expect(screen.getByTestId("scope-audit-cmd-json")).toHaveTextContent(
      "sillyspec scope-audit --change quick-a1b2c3d4 --json",
    );
    expect(screen.queryByText(/未解析到本条对应的 quick 会话 ID/)).toBeNull();
  });

  it("无绑定 daemon → 占位符 + 手动替换提示（旧 daemon / 会话已结束的常态兜底）", async () => {
    mocks.fetchMyBinding.mockResolvedValue(null);
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "quick", workspaceId: "ws-1", qlId: "ql-20260910-014-6c29" }}
      />,
    );
    expect(
      await screen.findByTestId("scope-audit-cmd-table"),
    ).toHaveTextContent(
      `sillyspec scope-audit --change ${QUICK_ID_PLACEHOLDER}`,
    );
    expect(
      screen.getByText(/未解析到本条对应的 quick 会话 ID/),
    ).toBeInTheDocument();
  });
});

describe("ql-20260910-014-6c29 复制交互", () => {
  it("点击复制按钮 → clipboard.writeText 收到完整命令文本", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "change", changeKey: "2026-09-10-mcp-central-registry" }}
      />,
    );
    fireEvent.click(await screen.findByTestId("scope-audit-cmd-json-copy"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "sillyspec scope-audit --change 2026-09-10-mcp-central-registry --json",
      ),
    );
  });
});
