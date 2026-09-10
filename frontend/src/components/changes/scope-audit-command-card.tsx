"use client";

/**
 * ScopeAuditCommandCard — 变更中心「范围对账（scope-audit）」命令卡
 * （ql-20260910-014-6c29）。
 *
 * 挂载两处共用：变更详情页右栏（target.kind=change，identifier=change_key）与
 * 快速修复抽屉（target.kind=quick，identifier=quick-<8hex> 会话名）。命令形态
 * 由用户指定：表格版 + --json 版各一行可复制（sillyspec 工具 scope-audit 命令，
 * 2026-09-10-change-scope-audit 产物）。
 *
 * quick 会话名解析（数据链复刻 platform-sync-section / ql-20260910-012 同款）：
 * fetchMyBinding(workspaceId).daemon_id → listDaemonMachines 按 id 匹配 →
 * sillyspec_status_map 非空按当前工作区取（缺席=null 不回退单槽位，防串台），
 * map 为 null（旧 daemon）回退机器级 sillyspec_status → changes[] 按 ql_id 反查
 * 会话名。ql_id 为 daemon 心跳对 quick-* 名 best-effort 读 guard.json 补报的
 * 可选字段（同 pending_conflicts[].ql_id 先例）——旧 daemon / 会话已结束
 * （guard 已清理）查不到 → 占位符 + 提示手动替换，不阻断展示。
 *
 * 命令前缀单一取值点（SCOPE_AUDIT_CMD_PREFIX）：直接显示 sillyspec 正式命令
 * （本机已安装版本若尚未含 scope-audit，跑命令会得「未知命令」提示升级），
 * 全部命令经 buildScopeAuditCommand 拼接。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { components } from "@/lib/api-types";
import { listDaemonMachines } from "@/lib/daemon";
import { fetchMyBinding } from "@/lib/workspace-binding";

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

/** quick 会话名解析失败时的提示（覆盖旧 daemon / 会话已结束两种常态）。 */
const QUICK_UNRESOLVED_NOTE =
  "未解析到本条对应的 quick 会话 ID：需机器 daemon 为支持补报的版本、且该 quick 会话仍在活跃列表（已结束会话的 guard 记录会被清理）；可在本机跑 sillyspec status 查看 quick- 开头的会话名手动替换。";

export type ScopeAuditTarget =
  | { kind: "change"; changeKey: string }
  | { kind: "quick"; workspaceId: string; qlId: string };

export interface ScopeAuditCommandCardProps {
  target: ScopeAuditTarget;
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

export function ScopeAuditCommandCard({ target }: ScopeAuditCommandCardProps) {
  // quick 会话名解析（仅 quick 分支取数；change 分支 hooks 顺序恒定经 enabled=false 保持）。
  const enabled = target.kind === "quick";
  const workspaceId = target.kind === "quick" ? target.workspaceId : "";
  const qlId = target.kind === "quick" ? target.qlId : "";

  const quickName = useQuickSessionName(workspaceId, qlId, enabled);
  const identifier =
    target.kind === "change" ? target.changeKey : (quickName ?? QUICK_ID_PLACEHOLDER);

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
            只读不设门禁，已归档变更可查。命令复制后在本地执行。
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
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
      {target.kind === "quick" && !quickName && (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          {QUICK_UNRESOLVED_NOTE}
        </p>
      )}
    </section>
  );
}
