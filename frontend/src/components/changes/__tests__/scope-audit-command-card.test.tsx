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
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/**
 * 契约 v2 三仓夹具（f85a6650 类多仓变更，2026-09-20-scope-audit-cross-repo-platform）：
 * main 20/2（post-apply 主仓锚）+ sub-grid-security 13/1（reviews 锚点档）+
 * spdemo 9/1（B 档降级：语义锚 anchor_label=null、行数 null）。
 * rows 只造 3 行——chips 数字必须取信封 repos[].totals（20/13/9）而非行重算，
 * 行数与 totals 故意不一致正是「单一源」断言的钉子（design 消费语义）。
 */
function makeCrossRepoAudit(): ScopeAuditResponse {
  return {
    change: "2026-09-18-ehs-back-multi-repo",
    ok: true,
    mode: "full-flow",
    base_ref: "214151b0c0d0e0f0a1b2c3d4e5f6a7b8c9d0e1f2",
    anchor_label: "214151b",
    degraded_reason: null,
    totals: { files: 46, additions: 6040, deletions: 340 },
    rows: [
      {
        path: "src/main/java/com/ehs/RewardController.java",
        additions: 210,
        deletions: 18,
        kind: "modified",
        planned: "修改",
        verdict: "planned",
        declared: null,
        attribution: null,
        cross_repo: null,
      },
      {
        path: "pkg/reward/service.go",
        additions: 430,
        deletions: 0,
        kind: "new",
        planned: "新增",
        verdict: "planned",
        declared: null,
        attribution: null,
        cross_repo: "sub-grid-security",
      },
      {
        path: "app/demo/page.tsx",
        additions: null,
        deletions: null,
        kind: "modified",
        planned: "修改",
        verdict: "planned",
        declared: null,
        attribution: null,
        cross_repo: "spdemo",
      },
    ],
    excluded_foreign_declared: [],
    note: "计划侧含 22 个跨仓文件（repo：sub-grid-security、spdemo）——已按 local.yaml repos 注册表分仓对账（各仓锚点档见分段）",
    truncated: false,
    repos: [
      {
        key: "main",
        anchor: {
          source: "main-post-apply",
          base: "214151b0c0d0e0f0a1b2c3d4e5f6a7b8c9d0e1f2",
          head: "8f9e0d1c2b3a49586775849realsub0",
          label: "post-apply 主仓锚",
        },
        anchor_label: "214151b",
        totals: {
          files: 22,
          additions: 5300,
          deletions: 310,
          planned: 20,
          unplanned: 2,
          untouched: 0,
        },
        degraded: false,
        degraded_reason: null,
      },
      {
        key: "sub-grid-security",
        anchor: {
          source: "reviews-range",
          base: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          head: "11223344556677889900aabbccddeeff0011223",
          label: "reviews base..head（execute task 锚点，2 task 区间并集）",
        },
        anchor_label: "a1b2c3d",
        totals: {
          files: 14,
          additions: 740,
          deletions: 30,
          planned: 13,
          unplanned: 1,
          untouched: 0,
        },
        degraded: false,
        degraded_reason: null,
      },
      {
        key: "spdemo",
        anchor: {
          source: "head~1-window",
          base: null,
          head: "0a1b2c3d4e5f6789abcdef0123456789abcdef01",
          label: "HEAD~1..HEAD 最近提交窗口（降级——无可用 reviews）",
        },
        anchor_label: null,
        totals: {
          files: 10,
          additions: null,
          deletions: null,
          planned: 9,
          unplanned: 1,
          untouched: 0,
        },
        degraded: false,
        degraded_reason: null,
      },
    ],
  };
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

  it("反查失败 → ql-xxx 直发对账（sillyspec 仓 ql-xxx 反查支持；历史条目不再降级）", async () => {
    // 2026-09-14：useQuickSessionName 反查失败（fetchMyBinding=null 模拟旧 daemon /
    // 会话已结束 guard 清理）→ 不再占位降级，直接用条目号 ql-xxx 发起——CLI 侧
    // findQuickSessionByQlId 走 patches 持久映射出记录态。
    mocks.fetchMyBinding.mockResolvedValue(null);
    mocks.getScopeAudit.mockResolvedValue({
      change: "ql-20260910-014-6c29",
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
          kind: "modified",
          planned: null,
          verdict: null,
          declared: false,
          attribution: "declared",
        },
        {
          path: "docs/b.md",
          additions: 10,
          deletions: 2,
          kind: "modified",
          planned: null,
          verdict: null,
          declared: false,
          attribution: "soft",
        },
      ],
      excluded_foreign_declared: [],
      note: "quick 会话已收尾——记录态",
      truncated: false,
    });
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "quick", workspaceId: "ws-1", qlId: "ql-20260910-014-6c29" }}
      />,
    );
    await waitFor(() =>
      expect(mocks.getScopeAudit).toHaveBeenCalledWith("ws-1", "ql-20260910-014-6c29"),
    );
    // 命令展示也用 ql-xxx（用户可直接复制执行）；等取数完成渲染后断言。
    await waitFor(() =>
      expect(screen.getByTestId("scope-audit-cmd-table")).toHaveTextContent(
        "sillyspec scope-audit --change ql-20260910-014-6c29",
      ),
    );
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

describe("2026-09-20-scope-audit-cross-repo-platform 分组形态：三仓分组渲染", () => {
  it("全表合计 + 主仓/跨仓段各带真实三态与锚点档；chips 数字=信封 totals 不重算；note 渲染", async () => {
    mocks.getScopeAudit.mockResolvedValue(makeCrossRepoAudit());
    renderCard(
      <ScopeAuditCommandCard
        target={{
          kind: "change",
          workspaceId: "ws-1",
          changeKey: "2026-09-18-ehs-back-multi-repo",
        }}
      />,
    );
    // 三仓段头（主仓 brand 位 + 各仓锚点档 chip：label + 短 hash；spdemo 语义锚 hash 位 —）
    expect(
      await screen.findByTestId("scope-audit-repo-seg-main"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("scope-audit-repo-seg-sub-grid-security")).toBeInTheDocument();
    expect(screen.getByTestId("scope-audit-repo-seg-spdemo")).toBeInTheDocument();
    expect(screen.getByText("主仓")).toBeInTheDocument();
    expect(screen.getByText("sub-grid-security")).toBeInTheDocument();
    expect(screen.getByText("214151b")).toBeInTheDocument();
    expect(screen.getByText("a1b2c3d")).toBeInTheDocument();
    expect(screen.getByText(/HEAD~1\.\.HEAD 最近提交窗口/)).toBeInTheDocument();
    // 语义锚（B 档降级无 base）→ anchor_label null 显示 —
    expect(screen.getByTestId("scope-audit-repo-seg-spdemo")).toHaveTextContent(
      /最近提交窗口（降级——无可用 reviews）\s*—/,
    );
    // 全表合计行（信封 totals + 仓数；挂摘要容器断言——数字在 <b> 嵌套节点里）
    expect(screen.getByTestId("scope-audit-summary")).toHaveTextContent(
      "全表 46 文件",
    );
    expect(screen.getByText("3 个仓库")).toBeInTheDocument();
    expect(screen.getByText("+6040")).toBeInTheDocument();
    // 三态 chips 计数取信封 repos[].totals（rows 仅 3 行，20/13/9 只能来自信封）
    expect(screen.getByTestId("scope-audit-chip-main-planned")).toHaveTextContent(
      "计划内 20",
    );
    expect(screen.getByTestId("scope-audit-chip-main-unplanned")).toHaveTextContent(
      "计划外 2",
    );
    expect(screen.getByTestId("scope-audit-chip-main-untouched")).toHaveTextContent(
      "计划未动 0",
    );
    expect(
      screen.getByTestId("scope-audit-chip-sub-grid-security-planned"),
    ).toHaveTextContent("计划内 13");
    expect(
      screen.getByTestId("scope-audit-chip-sub-grid-security-unplanned"),
    ).toHaveTextContent("计划外 1");
    expect(screen.getByTestId("scope-audit-chip-spdemo-planned")).toHaveTextContent(
      "计划内 9",
    );
    // 该仓 files/+−（spdemo 降级档行数 null → —）
    expect(screen.getByTestId("scope-audit-repo-seg-main")).toHaveTextContent(
      "22 文件",
    );
    expect(
      screen.getByTestId("scope-audit-repo-seg-sub-grid-security"),
    ).toHaveTextContent("14 文件");
    expect(screen.getByTestId("scope-audit-repo-seg-spdemo")).toHaveTextContent(
      "10 文件",
    );
    expect(screen.getByTestId("scope-audit-repo-seg-spdemo")).toHaveTextContent(
      "+—",
    );
    expect(screen.getByTestId("scope-audit-repo-seg-spdemo")).toHaveTextContent(
      "−—",
    );
    // 旧形态单段 testid 不存在（分组形态下升级为每仓前缀）
    expect(screen.queryByTestId("scope-audit-chip-planned")).not.toBeInTheDocument();
    // note 顶摘要层（muted 单行）
    expect(screen.getByTestId("scope-audit-note")).toHaveTextContent(
      "已按 local.yaml repos 注册表分仓对账",
    );
  });

  it("degraded 仓段：整段 ⚠️ 原因文案、不渲染伪三态 chips", async () => {
    const audit = makeCrossRepoAudit();
    audit.repos = [
      ...audit.repos!.slice(0, 1),
      {
        key: "repo-x",
        anchor: { source: "degraded", base: null, head: null, label: null },
        anchor_label: null,
        totals: {
          files: 9,
          additions: null,
          deletions: null,
          planned: null,
          unplanned: null,
          untouched: null,
        },
        degraded: true,
        degraded_reason:
          "repo key「repo-x」未在 local.yaml repos 注册——跨仓对账不可达，请人工到对应仓核对（该仓 9 个计划文件未对账）",
      },
    ];
    mocks.getScopeAudit.mockResolvedValue(audit);
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "change", workspaceId: "ws-1", changeKey: "c-multi" }}
      />,
    );
    expect(
      await screen.findByTestId("scope-audit-repo-degraded-repo-x"),
    ).toHaveTextContent("未在 local.yaml repos 注册");
    expect(screen.getByTestId("scope-audit-repo-degraded-repo-x")).toHaveTextContent(
      "⚠️",
    );
    // degraded 段不渲染三态 chips（无伪计数）
    expect(
      screen.queryByTestId("scope-audit-chip-repo-x-planned"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("scope-audit-chip-repo-x-unplanned"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("scope-audit-chip-repo-x-untouched"),
    ).not.toBeInTheDocument();
  });
});

describe("2026-09-20-scope-audit-cross-repo-platform 分组形态：明细弹窗按仓分桶", () => {
  it("桶序=repos[] 序 + 孤儿桶尾随；跨仓行仓标徽章、主仓行无徽章；null 行数 —；行点击联动不变", async () => {
    const audit = makeCrossRepoAudit();
    // 孤儿桶：行 cross_repo 指向 repos[] 未列出的 key（畸形信封防御）
    audit.rows = [
      ...audit.rows!,
      {
        path: "legacy/orphan.go",
        additions: 5,
        deletions: 1,
        kind: "modified",
        planned: "修改",
        verdict: "unplanned",
        declared: null,
        attribution: null,
        cross_repo: "ghost-repo",
      },
    ];
    mocks.getScopeAudit.mockResolvedValue(audit);
    renderCard(
      <ScopeAuditCommandCard
        target={{ kind: "change", workspaceId: "ws-1", changeKey: "2026-09-18-ehs-back-multi-repo" }}
      />,
    );
    fireEvent.click(await screen.findByTestId("scope-audit-detail-entry"));
    // 分桶小节头（粘性）：repos[] 序 main → sub-grid-security → spdemo，孤儿桶尾随
    expect(
      await screen.findByTestId("scope-audit-detail-group-main"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("scope-audit-detail-group-sub-grid-security"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("scope-audit-detail-group-spdemo")).toBeInTheDocument();
    expect(screen.getByTestId("scope-audit-detail-group-ghost-repo")).toBeInTheDocument();
    const groups = screen
      .getAllByTestId(/^scope-audit-detail-group-/)
      .map((el) => el.dataset.testid);
    expect(groups).toEqual([
      "scope-audit-detail-group-main",
      "scope-audit-detail-group-sub-grid-security",
      "scope-audit-detail-group-spdemo",
      "scope-audit-detail-group-ghost-repo",
    ]);
    // 跨仓行仓标徽章（brand 小标签）；主仓行无徽章
    const crossRow = screen.getByTestId("scope-audit-row-pkg/reward/service.go");
    expect(within(crossRow).getByText("sub-grid-security")).toBeInTheDocument();
    const mainRow = screen.getByTestId(
      "scope-audit-row-src/main/java/com/ehs/RewardController.java",
    );
    expect(within(mainRow).queryByText("main")).not.toBeInTheDocument();
    expect(within(mainRow).queryByText("主仓")).not.toBeInTheDocument();
    // spdemo 行（B 档降级）行数 null → —
    const spdemoRow = screen.getByTestId("scope-audit-row-app/demo/page.tsx");
    expect(spdemoRow).toHaveTextContent("+—");
    // 行点击联动单文件 diff 不变（分组形态 DetailRow 同一 onOpenDiff 链路）
    mocks.getScopeFileDiff.mockResolvedValue({
      change: "2026-09-18-ehs-back-multi-repo",
      file: "pkg/reward/service.go",
      ok: true,
      mode: "full-flow",
      base_ref: "a1b2c3d",
      anchor_label: "a1b2c3d",
      diff: "@@ -1 +1 @@\n-a\n+b\n",
      note: null,
      truncated: false,
    });
    fireEvent.click(crossRow);
    expect(await screen.findByText("文件变化比对")).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.getScopeFileDiff).toHaveBeenCalledWith(
        "ws-1",
        "2026-09-18-ehs-back-multi-repo",
        "pkg/reward/service.go",
      ),
    );
  });
});

describe("2026-09-20-scope-audit-cross-repo-platform 回退形态：无 repos 渲染与现状等价", () => {
  it("无 repos 单段（旧 testid）+ note 不渲染；旧形态跨仓行归主仓平铺渲染、无分组头与仓标", async () => {
    // 旧 CLI/旧 daemon：信封无 repos 键（或空数组）；note 非 null 也不渲染（兼容策略 6）；
    // 行可能带 cross_repo 键（v3.29.3~v2 间旧快照 ⊘ 标记）→ 回退形态不消费、按普通行渲染。
    mocks.getScopeAudit.mockResolvedValue({
      change: "2026-09-10-mcp-central-registry",
      ok: true,
      mode: "full-flow",
      base_ref: "3f22d6b9b6d1f85415be416c5086e29cfd9998a4",
      anchor_label: "3f22d6b",
      degraded_reason: null,
      totals: { files: 3, additions: 436, deletions: 19 },
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
          cross_repo: null,
        },
        {
          path: "vendor/legacy.ts",
          additions: 10,
          deletions: 2,
          kind: "modified",
          planned: null,
          verdict: "untouched",
          declared: null,
          attribution: null,
          cross_repo: "some-old-repo",
        },
      ],
      excluded_foreign_declared: [],
      note: "旧快照 note 不应在回退形态渲染",
      truncated: false,
    });
    renderCard(
      <ScopeAuditCommandCard
        target={{
          kind: "change",
          workspaceId: "ws-1",
          changeKey: "2026-09-10-mcp-central-registry",
        }}
      />,
    );
    // 单段：既有 testid 原样（counts-from-rows：planned 1 / untouched 1）
    expect(
      await screen.findByTestId("scope-audit-chip-planned"),
    ).toHaveTextContent("计划内 1");
    expect(screen.getByTestId("scope-audit-chip-untouched")).toHaveTextContent(
      "计划未动 1",
    );
    expect(screen.getByTestId("scope-audit-summary")).toHaveTextContent("锚点");
    // 分组形态 testid 均不出现；note 不渲染
    expect(screen.queryByTestId("scope-audit-repo-seg-main")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scope-audit-note")).not.toBeInTheDocument();
    expect(screen.queryByText("旧快照 note 不应在回退形态渲染")).not.toBeInTheDocument();
    // 明细平铺：跨仓行按普通行渲染（无分桶头、无仓标徽章）
    fireEvent.click(screen.getByTestId("scope-audit-detail-entry"));
    expect(
      await screen.findByTestId("scope-audit-row-vendor/legacy.ts"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("scope-audit-detail-group-main"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("scope-audit-row-vendor/legacy.ts")).queryByText(
        "some-old-repo",
      ),
    ).not.toBeInTheDocument();
  });
});
