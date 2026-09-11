"use client";

/**
 * ScopeAuditCommandCard — 变更中心「范围对账（scope-audit）」结果卡
 * （ql-20260910-014-6c29 命令卡 → ql-20260911-001-c0be 升级为结果卡）。
 *
 * 不再只展示可复制命令：挂载即经平台链路（GET /sillyspec/scope-audit →
 * daemon RPC → 本机 sillyspec scope-audit --json 表模式）跑出对账结果——
 * 卡面显示锚点 + 文件/行数合计 + 三态计数（full-flow：✓ 计划内 / ⚠️ 计划外 /
 * ⚠️ 计划未动；quick：✓ 已声明 / 🔍 软归属 / ⚠️ 未声明），「查看明细」开宽
 * 弹窗渲染三态全表（行点击联动 scope-file-diff-modal 看单文件 diff）。
 * 两条本地命令（表格版 / --json 版）折叠为卡尾次要区保留——链路不可用
 * （旧版本/离线）时的兜底与 CLI 习惯入口。
 *
 * 挂载两处：变更详情页右辅侧栏尾（target.kind=change，identifier=change_key）
 * 与快速修复抽屉（target.kind=quick，identifier=quick-<8hex> 会话名，经
 * useQuickSessionName 反查）。反查失败 / ok=false（会话已清理等）→ 降级为
 * 命令 + 提示，不阻断展示（advisory 语义）。
 *
 * 命令前缀单一取值点（SCOPE_AUDIT_CMD_PREFIX）：直接显示 sillyspec 正式命令
 * （本机已安装版本若尚未含 scope-audit，跑命令会得「未知命令」提示升级），
 * 全部命令经 buildScopeAuditCommand 拼接。
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "antd";

import { ScopeFileDiffModal } from "@/components/changes/scope-file-diff-modal";
import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api-types";
import { getScopeAudit, type ScopeAuditRow } from "@/lib/changes";
import { listDaemonMachines } from "@/lib/daemon";
import { fetchMyBinding } from "@/lib/workspace-binding";
import { cn } from "@/lib/utils";

/** 心跳 sillyspec_status.changes[] 单项（api-types 生成版，禁止手写）。 */
type SillySpecChange = components["schemas"]["DaemonHeartbeatSillySpecChange"];
type SillySpecStatus = components["schemas"]["MachineSillySpecStatusRead"];

/** scope-audit 命令前缀（单一取值点，2026-09-10 由 node src/index.js 切换）。 */
export const SCOPE_AUDIT_CMD_PREFIX = "sillyspec";

/** scope-audit 命令拼接（导出供测试）：--change 必填，--json 可选结构化输出。 */
export function buildScopeAuditCommand(
  identifier: string,
  json = false,
): string {
  return `${SCOPE_AUDIT_CMD_PREFIX} scope-audit --change ${identifier}${json ? " --json" : ""}`;
}

/** quick 会话 ID 占位符（解析不到时展示，用户按提示手动替换）。 */
export const QUICK_ID_PLACEHOLDER = "<quick会话ID>";

/**
 * 机器 sillyspec 快照 changes[] 按 ql_id 反查 quick 会话名（quick-<8hex>）。
 * 导出供测试；多条命中取首条（ql_id ↔ 会话一对一，多条属异常数据不敏感）。
 */
export function findQuickSessionName(
  status: SillySpecStatus | null,
  qlId: string,
): string | null {
  for (const c of (status?.changes ?? []) as SillySpecChange[]) {
    if (c.ql_id === qlId && c.name) return c.name;
  }
  return null;
}

/** quick 会话 ID 解析失败时的提示（覆盖旧 daemon / 会话已结束两种常态）。 */
const QUICK_UNRESOLVED_NOTE =
  "未解析到本条对应的 quick 会话 ID：需机器 daemon 为支持补报的版本、且该 quick 会话仍在活跃列表（已结束会话的 guard 记录会被清理）；可在本机跑 sillyspec status 查看 quick- 开头的会话名手动替换。";

/**
 * quick 会话名反查 hook（ql-20260910-017-2006 抽出，命令卡与单文件比对弹窗
 * 共用）：fetchMyBinding → listDaemonMachines → sillyspec_status_map 工作区级
 * 优先 → changes[] 按 ql_id 反查 quick-<8hex>。解析中/查不到（旧 daemon、
 * 会话已结束 guard 清理）返回 null，调用方自行兜底。
 */
export function useQuickSessionName(
  workspaceId: string,
  qlId: string,
  enabled = true,
): string | null {
  const bindingQ = useQuery({
    queryKey: ["scope-audit-command-card", "binding", workspaceId],
    queryFn: () => fetchMyBinding(workspaceId),
    enabled,
  });
  const daemonId = bindingQ.data?.daemon_id ?? null;
  const machinesQ = useQuery({
    queryKey: ["scope-audit-command-card", "machines"],
    queryFn: () => listDaemonMachines({ limit: 100 }),
    enabled: enabled && daemonId !== null,
  });
  const machine =
    daemonId !== null
      ? (machinesQ.data?.items.find((m) => m.id === daemonId) ?? null)
      : null;
  // 工作区级快照取数（对齐 platform-sync-section / ql-20260910-012 同款口径）：
  // map 非空按当前工作区取（缺席不回退单槽位防串台）；map null（旧 daemon）
  // 回退机器级 sillyspec_status。
  const statusMap = machine?.sillyspec_status_map ?? null;
  const status: SillySpecStatus | null =
    statusMap !== null
      ? (statusMap[workspaceId] ?? null)
      : (machine?.sillyspec_status ?? null);
  return findQuickSessionName(status, qlId);
}

export type ScopeAuditTarget =
  | { kind: "change"; workspaceId: string; changeKey: string }
  | { kind: "quick"; workspaceId: string; qlId: string };

export interface ScopeAuditCommandCardProps {
  target: ScopeAuditTarget;
}

/** full-flow verdict 徽章（色阶走语义 token，✓/⚠️ 与工具表同款标记）。 */
const VERDICT_META: Record<string, { label: string; className: string }> = {
  planned: { label: "✓ 计划内", className: "bg-success/15 text-success" },
  unplanned: { label: "⚠️ 计划外", className: "bg-warning/15 text-warning" },
  untouched: { label: "⚠️ 计划未动", className: "bg-muted text-muted-foreground" },
};

/** quick attribution 徽章（归属三态）。 */
const ATTR_META: Record<string, { label: string; className: string }> = {
  declared: { label: "✓ 已声明", className: "bg-success/15 text-success" },
  soft: { label: "🔍 软归属", className: "bg-brand-50 text-brand-700" },
  undeclared: { label: "⚠️ 未声明", className: "bg-warning/15 text-warning" },
};

/** kind 中文标签。 */
const KIND_LABEL: Record<string, string> = {
  new: "新增",
  modified: "修改",
  deleted: "删除",
  binary: "二进制",
};

/** 行徽章（mode 分派：full-flow 取 verdict，quick 取 attribution）。 */
function rowBadge(row: ScopeAuditRow, mode: string) {
  const key = mode === "quick" ? row.attribution : row.verdict;
  const meta =
    (mode === "quick" ? ATTR_META : VERDICT_META)[key ?? ""] ?? null;
  return meta ?? { label: key ?? "—", className: "bg-muted text-muted-foreground" };
}

/** 行数紧凑展示（+N 绿 / −M 红；null=二进制/降级 → —）。 */
function fmtNum(n: number | null | undefined): string {
  return typeof n === "number" ? String(n) : "—";
}

/** 单行命令 + 复制按钮（复制交互对齐 change-stage-actions 内联先例）。 */
function CommandRow({
  label,
  command,
  testId,
}: {
  label: string;
  command: string;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard 写入被拒时静默 */
    }
  };
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 pt-1 text-[11px] text-muted-foreground">
        {label}
      </span>
      <code
        data-testid={testId}
        className="min-w-0 flex-1 rounded border bg-muted/40 px-2 py-1 font-mono text-[11px] break-all text-foreground"
      >
        {command}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`复制${label}命令`}
        data-testid={`${testId}-copy`}
        className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

/** 命令折叠区（卡尾次要入口：链路不可用兜底 + CLI 习惯）。 */
function CommandSection({ identifier }: { identifier: string }) {
  return (
    <details data-testid="scope-audit-commands" className="mt-2 group">
      <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
        本地命令（表格版 / JSON 版）
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5">
        <CommandRow
          label="表格版"
          command={buildScopeAuditCommand(identifier)}
          testId="scope-audit-cmd-table"
        />
        <CommandRow
          label="JSON 版"
          command={buildScopeAuditCommand(identifier, true)}
          testId="scope-audit-cmd-json"
        />
      </div>
    </details>
  );
}

export function ScopeAuditCommandCard({ target }: ScopeAuditCommandCardProps) {
  // quick 会话名解析（仅 quick 分支取数；change 分支 hooks 顺序恒定经 enabled=false 保持）。
  const enabled = target.kind === "quick";
  const workspaceId = target.workspaceId;
  const qlId = target.kind === "quick" ? target.qlId : "";

  const quickName = useQuickSessionName(workspaceId, qlId, enabled);
  const identifier =
    target.kind === "change" ? target.changeKey : quickName;

  // 对账表取数（identifier 就绪即拉；change 直代，quick 反查成功后拉）。
  const auditQ = useQuery({
    queryKey: ["scope-audit-card", "audit", workspaceId, identifier],
    queryFn: () => getScopeAudit(workspaceId, identifier!),
    enabled: identifier !== null,
    refetchOnWindowFocus: false,
  });
  const audit = auditQ.data ?? null;
  const auditLoading = identifier !== null && auditQ.isPending;

  // 三态计数（mode 分派）。
  const counts = useMemo(() => {
    const rows = audit?.rows ?? [];
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = audit?.mode === "quick" ? r.attribution : r.verdict;
      map.set(key ?? "unknown", (map.get(key ?? "unknown") ?? 0) + 1);
    }
    return map;
  }, [audit]);

  // 明细弹窗 + 行点击联动的单文件 diff 弹窗。
  const [detailOpen, setDetailOpen] = useState(false);
  const [diffRow, setDiffRow] = useState<string | null>(null);

  const renderSummary = () => {
    if (identifier === null) {
      // quick 反查失败：降级为提示 + 命令（不发起对账）。
      return (
        <>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {QUICK_UNRESOLVED_NOTE}
          </p>
          <CommandSection identifier={QUICK_ID_PLACEHOLDER} />
        </>
      );
    }
    if (auditLoading) {
      return (
        <p className="text-[11px] leading-4 text-muted-foreground" data-testid="scope-audit-loading">
          正在对账…（本机实时计算，可能需要数秒）
        </p>
      );
    }
    if (auditQ.error !== null) {
      // 失败/版本不足：错误文案（简短）+ 命令兜底。
      return (
        <>
          <p className="text-[11px] leading-4 text-warning" data-testid="scope-audit-error">
            {auditQ.error instanceof Error ? auditQ.error.message : "对账执行失败"}
          </p>
          <CommandSection identifier={identifier} />
        </>
      );
    }
    if (audit === null) return null;
    if (!audit.ok) {
      return (
        <>
          <p className="text-[11px] leading-4 text-muted-foreground" data-testid="scope-audit-degraded">
            对账不可用：{audit.degraded_reason ?? "未知原因"}
          </p>
          <CommandSection identifier={identifier} />
        </>
      );
    }
    const isQuick = audit.mode === "quick";
    const badgeMap = isQuick ? ATTR_META : VERDICT_META;
    const order = isQuick
      ? ["declared", "soft", "undeclared"]
      : ["planned", "unplanned", "untouched"];
    return (
      <>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            锚点{" "}
            <b className="font-mono font-semibold text-foreground">
              {audit.anchor_label ?? "—"}
            </b>
          </span>
          <span>{audit.totals?.files ?? (audit.rows?.length ?? 0)} 文件</span>
          <span>
            <span className="text-success">+{fmtNum(audit.totals?.additions)}</span>{" "}
            /{" "}
            <span className="text-error">−{fmtNum(audit.totals?.deletions)}</span>
          </span>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {order.map((key) => {
            const meta = badgeMap[key];
            if (!meta) return null;
            return (
              <span
                key={key}
                data-testid={`scope-audit-chip-${key}`}
                className={cn(
                  "rounded-full px-2 py-px text-[11px] font-medium",
                  meta.className,
                )}
              >
                {meta.label} {counts.get(key) ?? 0}
              </span>
            );
          })}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => setDetailOpen(true)}
            data-testid="scope-audit-detail-entry"
          >
            查看明细（{audit.rows?.length ?? 0}）
          </Button>
        </div>
        {audit.truncated && (
          <p className="mt-1 text-[11px] text-warning">
            差异文件过多，明细表已截断（仅前 500 行）。
          </p>
        )}
        <CommandSection identifier={identifier} />
      </>
    );
  };

  return (
    <section
      data-testid="scope-audit-command-card"
      className="rounded-md border bg-card px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium">⚖️ 范围对账（scope-audit）</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            「计划改动 × 实际改动」对账：三态全表 + 行数；advisory
            只读不设门禁，已归档变更可查。
          </p>
        </div>
      </div>
      <div className="mt-2" data-testid="scope-audit-summary">
        {renderSummary()}
      </div>

      {/* 明细弹窗：三态全表，行点击联动单文件 diff（ql-20260911-001-c0be） */}
      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width="min(1080px, 94vw)"
        title={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span>范围对账明细</span>
            <span className="rounded bg-brand-50 px-1 text-[10px] leading-4 text-brand-700">
              {audit?.mode === "quick" ? "快速修复" : "变更"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              锚点 <code className="font-mono">{audit?.anchor_label ?? "—"}</code>
              {" · 点击行查看该文件变化比对"}
            </span>
          </div>
        }
      >
        <ul
          data-testid="scope-audit-detail-rows"
          className="max-h-[calc(100vh-320px)] min-h-[240px] overflow-auto rounded border bg-card"
        >
          {(audit?.rows ?? []).map((row) => {
            const badge = rowBadge(row, audit?.mode ?? "full-flow");
            return (
              <li key={row.path} className="border-b last:border-b-0">
                <button
                  type="button"
                  data-testid={`scope-audit-row-${row.path}`}
                  onClick={() => setDiffRow(row.path)}
                  title="点击查看该文件的变化比对（对账同源锚点 diff）"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 text-[10px] leading-4",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {row.path}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums">
                    <span className="text-success">+{fmtNum(row.additions)}</span>
                    <span className="mx-1 text-muted-foreground">/</span>
                    <span className="text-error">−{fmtNum(row.deletions)}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {(audit?.rows?.length ?? 0) === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              无对账行
            </li>
          )}
        </ul>
        {(audit?.excluded_foreign_declared?.length ?? 0) > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            另有 {audit?.excluded_foreign_declared?.length ?? 0} 个他者已声明文件不在本
            窗口对账内（quick 窗口剔除清单）。
          </p>
        )}
      </Modal>

      {/* 行点击联动：单文件变化比对（对账同源锚点） */}
      <ScopeFileDiffModal
        open={diffRow !== null}
        onClose={() => setDiffRow(null)}
        workspaceId={workspaceId}
        change={identifier}
        filePath={diffRow}
      />
    </section>
  );
}
