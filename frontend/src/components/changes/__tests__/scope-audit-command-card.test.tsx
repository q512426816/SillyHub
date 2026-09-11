/**
 * scope-audit 范围对账结果卡测试（ql-20260910-014-6c29 命令卡 →
 * ql-20260911-001-c0be 升级结果卡）。
 *
 * 覆盖：
 *   1. 纯函数：buildScopeAuditCommand（前缀 / identifier / --json 追加）+
 *      SCOPE_AUDIT_CMD_PREFIX 单一取值点 + findQuickSessionName
 *   2. change 目标：对账取数 → 锚点/文件·行数合计/full-flow 三态计数 + 命令
 *      折叠区仍在（兜底入口）
 *   3. quick 目标已解析：反查会话名后取数出 quick 三态计数（attribution）
 *   4. quick 目标未解析：不发起对账，占位提示 + 占位命令
 *   5. 降级：ok=false 出 degraded 文案 + 命令兜底
 *   6. 明细弹窗：查看明细 → 三态行渲染，行点击联动单文件 diff 弹窗
 *
 * mock 范式照 quicklog-drawer.test：importActual 部分 mock +
 * QueryClientProvider（retry: false）。
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
  getScopeAudit: vi.fn(),
  getScopeFileDiff: vi.fn(),
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

vi.mock("@/lib/changes", async () => {
  const actual = await vi.importActual<typeof import("@/lib/changes")>(
    "@/lib/changes",
  );
  return {
    ...actual,
    getScopeAudit: mocks.getScopeAudit,
    getScopeFileDiff: mocks.getScopeFileDiff,
  };
});

type SillySpecStatus = components["schemas"]["MachineSillySpecStatusRead"];
type ScopeAuditResponse = components["schemas"]["ScopeAuditResponse"];

/** 机器 fixture：sillyspec_status_map["ws-1"] 含带 ql_id 的 quick 条。 */
function makeMachine(
  overrides: Partial<DaemonMachineRead> = {},
): DaemonMachineRead {
  const status: SillySpecStatus = {
    changes: [
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

/** full-flow 对账结果 fixture。 */
function makeFullFlowAudit(): ScopeAuditResponse {
  return {
    change: "2026-09-10-mcp-central-registry",
    ok: true,
    mode: "full-flow",
    base_ref: "3f22d6b9b6d1f85415be416c5086e29cfd9998a4",
    anchor_label: "3f22d6b",
    degraded_reason: null,
    totals: { files: 17, additions: 2196, deletions: 254 },
    rows: [
      {
        path: "src/index.js",
        additions: 426,
        deletions: 17,
        kind: "modified",
        planned: "修改",
        verdict: "planned",
        declared: null,
        attribution: null,
      },
      {
        path: "logo.png",
        additions: null,
        deletions: null,
        kind: "binary",
        planned: null,
        verdict: "unplanned",
        declared: null,
        attribution: null,
      },
      {
        path: "docs/never-touched.md",
        additions: 0,
        deletions: 0,
        kind: "modified",
        planned: "修改",
        verdict: "untouched",
        declared: null,
        attribution: null,
      },
    ],
    excluded_foreign_declared: [],
    note: null,
    truncated: false,
  };
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

describe("ql-20260911-001-c0be 纯函数：命令拼接与会话名反查", () => {
  it("buildScopeAuditCommand：前缀 + identifier；--json 追加尾参；前缀单一取值点为 sillyspec", () => {
    expect(SCOPE_AUDIT_CMD_PREFIX).toBe("sillyspec");
    expect(buildScopeAuditCommand("2026-09-10-mcp-central-registry")).toBe(
      "sillyspec scope-audit --change 2026-09-10-mcp-central-registry",
    );
    expect(buildScopeAuditCommand("quick-a1b2c3d4", true)).toBe(
      "sillyspec scope-audit --change quick-a1b2c3d4 --json",
    );
  });

  it("findQuickSessionName：ql_id 命中返回会话名；不命中 / 空 status → null", () => {
    const status = makeMachine().sillyspec_status_map!["ws-1"]!;
    expect(findQuickSessionName(status, "ql-20260910-014-6c29")).toBe(
      "quick-a1b2c3d4",
    );
    expect(findQuickSessionName(status, "ql-9999-unknown")).toBeNull();
    expect(findQuickSessionName(null, "ql-20260910-014-6c29")).toBeNull();
  });
});

describe("ql-20260911-001-c0be change 目标：对账结果摘要", () => {
  it("取数出锚点/文件·行数合计/full-flow 三态计数；本地命令折叠区仍在", async () => {
    mocks.getScopeAudit.mockResolvedValue(makeFullFlowAudit());
    renderCard(
      <ScopeAuditCommandCard
        target={{
          kind: "change",
          workspaceId: "ws-1",
          changeKey: "2026-09-10-mcp-central-registry",
        }}
      />,
    );
    // 摘要：锚点 + 合计 + 三态 chips
    await waitFor(() =>
      expect(screen.getByTestId("scope-audit-chip-planned")).toHaveTextContent(
        "计划内 1",
      ),
    );
    expect(screen.getByTestId("scope-audit-chip-unplanned")).toHaveTextContent(
      "计划外 1",
    );
    expect(screen.getByTestId("scope-audit-chip-untouched")).toHaveTextContent(
      "计划未动 1",
    );
    expect(screen.getByText("3f22d6b")).toBeInTheDocument();
    expect(screen.getByText("17 文件")).toBeInTheDocument();
    expect(screen.getByText("+2196")).toBeInTheDocument();
    // 命令折叠区保留（兜底入口；details 默认收起但内容在 DOM）
    expect(screen.getByTestId("scope-audit-commands")).toBeInTheDocument();
    expect(
      screen.getByText(
        "sillyspec scope-audit --change 2026-09-10-mcp-central-registry --json",
      ),
    ).toBeInTheDocument();
    // 取数参数
    expect(mocks.getScopeAudit).toHaveBeenCalledWith(
      "ws-1",
      "2026-09-10-mcp-central-registry",
    );
  });

  it("ok=false 降级：degraded 文案 + 命令兜底（quick 会话已清理常态）", async () => {
    mocks.getScopeAudit.mockResolvedValue({
      ...makeFullFlowAudit(),
      ok: false,
      degraded_reason: "quick 会话 quick-xxxx 不存在（guard 已清理）",
      rows: [],
    });
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "change", workspaceId: "ws-1", changeKey: "c1" }}
      />,
    );
    expect(
      await screen.findByTestId("scope-audit-degraded"),
    ).toHaveTextContent(/guard 已清理/);
    expect(screen.getByTestId("scope-audit-commands")).toBeInTheDocument();
  });
});

describe("ql-20260911-001-c0be quick 目标：反查后取数", () => {
  it("反查命中 → 以会话名取数出 quick 三态计数（attribution）", async () => {
    mocks.fetchMyBinding.mockResolvedValue({ daemon_id: "dm-1" });
    mocks.listDaemonMachines.mockResolvedValue({
      items: [makeMachine()],
      total: 1,
    });
    mocks.getScopeAudit.mockResolvedValue({
      change: "quick-a1b2c3d4",
      ok: true,
      mode: "quick",
      base_ref: null,
      anchor_label: null,
      degraded_reason: null,
      totals: { files: 2, additions: 10, deletions: 74 },
      rows: [
        {
          path: "docs/a.md",
          additions: 0,
          deletions: 72,
          kind: "deleted",
          planned: null,
          verdict: null,
          declared: false,
          attribution: "undeclared",
        },
        {
          path: "src/b.ts",
          additions: 10,
          deletions: 2,
          kind: "modified",
          planned: null,
          verdict: null,
          declared: true,
          attribution: "declared",
        },
      ],
      excluded_foreign_declared: ["frontend/src/x.ts"],
      note: null,
      truncated: false,
    });
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "quick", workspaceId: "ws-1", qlId: "ql-20260910-014-6c29" }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("scope-audit-chip-declared")).toHaveTextContent(
        "已声明 1",
      ),
    );
    expect(
      screen.getByTestId("scope-audit-chip-undeclared"),
    ).toHaveTextContent("未声明 1");
    await waitFor(() =>
      expect(mocks.getScopeAudit).toHaveBeenCalledWith("ws-1", "quick-a1b2c3d4"),
    );
  });

  it("反查失败 → 不发起对账；占位提示 + 占位命令", async () => {
    mocks.fetchMyBinding.mockResolvedValue(null);
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "quick", workspaceId: "ws-1", qlId: "ql-20260910-014-6c29" }}
      />,
    );
    expect(
      await screen.findByText(/未解析到本条对应的 quick 会话 ID/),
    ).toBeInTheDocument();
    expect(mocks.getScopeAudit).not.toHaveBeenCalled();
    expect(screen.getByTestId("scope-audit-commands")).toBeInTheDocument();
    expect(
      screen.getByText(
        `sillyspec scope-audit --change ${QUICK_ID_PLACEHOLDER}`,
      ),
    ).toBeInTheDocument();
  });
});

describe("ql-20260911-001-c0be 明细弹窗与行联动", () => {
  it("查看明细 → 三态行渲染；行点击打开单文件变化比对弹窗", async () => {
    mocks.getScopeAudit.mockResolvedValue(makeFullFlowAudit());
    renderCard(
      <ScopeAuditCommandCard
        target={{
          kind: "change",
          workspaceId: "ws-1",
          changeKey: "2026-09-10-mcp-central-registry",
        }}
      />,
    );
    fireEvent.click(await screen.findByTestId("scope-audit-detail-entry"));
    // 明细行（含 verdict 徽章文本）
    expect(
      await screen.findByTestId("scope-audit-row-src/index.js"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("scope-audit-detail-rows")).toBeInTheDocument();
    expect(screen.getByText("✓ 计划内")).toBeInTheDocument();

    // 行点击 → ScopeFileDiffModal 打开（标题出现 + 取数参数）
    mocks.getScopeFileDiff.mockResolvedValue({
      change: "2026-09-10-mcp-central-registry",
      file: "src/index.js",
      ok: true,
      mode: "full-flow",
      base_ref: "3f22d6b",
      anchor_label: "3f22d6b",
      diff: "@@ -1 +1 @@\n-a\n+b\n",
      note: null,
      truncated: false,
    });
    fireEvent.click(screen.getByTestId("scope-audit-row-src/index.js"));
    expect(await screen.findByText("文件变化比对")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.getScopeFileDiff).toHaveBeenCalledWith(
        "ws-1",
        "2026-09-10-mcp-central-registry",
        "src/index.js",
      ),
    );
  });
});
