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
 *
 * 契约 v2 分组形态（2026-09-20-scope-audit-cross-repo-platform，D-003/D-005）：
 * 信封 repos 非空数组且 mode==='full-flow' 时卡面按仓分组——全表合计行 +
 * 每仓一段（仓标识/锚点档 chip/三态 chips 计数取信封 repos[].totals 单一源），
 * degraded 仓段整段 ⚠️ 原因不渲染 chips；明细弹窗按行 cross_repo 分桶（无键归
 * main 桶，桶序=repos[] 序，孤儿桶尾随首现序）+ 粘性小节头 + 跨仓行仓标徽章；
 * note 顶摘要层。repos 空/null 或 quick → 现状单段渲染回退（DOM/testid 原样，
 * note 不渲染——兼容策略 6）。
 *
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

import { Fragment, useMemo, useState } from "react";
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
/** 信封级 repos[] 单项（契约 v2，api-types 生成版，禁止手写）。 */
type ScopeAuditRepoDto = components["schemas"]["ScopeAuditRepo"];

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

/** 仓标识显示名：main → 「主仓」（brand 色由调用方上），其余显示 repo key 原文。 */
function repoDisplayName(key: string): string {
  return key === "main" ? "主仓" : key;
}

/**
 * 仓锚点档 chip（契约 v2，2026-09-20-scope-audit-cross-repo-platform）：
 * anchor.label 文案 + anchor_label 短 hash（base 7 位短化，daemon 侧产出）；
 * 语义锚（B/C 档降级无 base）anchor_label=null → hash 位显示 —。
 * 卡面仓段头与明细弹窗小节头共用同一形态。
 */
function RepoAnchorChip({ repo }: { repo: ScopeAuditRepoDto }) {
  const label = repo.anchor?.label ?? null;
  const hash = repo.anchor_label ?? null;
  return (
    <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground">
      {label ? `${label} ` : ""}
      <span className="font-semibold text-foreground">{hash ?? "—"}</span>
    </span>
  );
}

/**
 * 明细行渲染（回退平铺与按仓分桶共用；行点击联动单文件 diff 不变）。
 * repoBadge 非空时（分组形态下的跨仓行）在路径后加仓标徽章（brand 色小标签，
 * 对齐 ATTR_META soft 形态——design D-003）。
 */
function DetailRow({
  row,
  mode,
  repoBadge,
  onOpenDiff,
}: {
  row: ScopeAuditRow;
  mode: string;
  repoBadge?: string | null;
  onOpenDiff: (path: string) => void;
}) {
  const badge = rowBadge(row, mode);
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        data-testid={`scope-audit-row-${row.path}`}
        onClick={() => onOpenDiff(row.path)}
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
        {repoBadge && (
          <span className="shrink-0 rounded bg-brand-50 px-1 text-[10px] leading-4 text-brand-700">
            {repoBadge}
          </span>
        )}
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

  // ql-xxx 直发（2026-09-14 sillyspec 仓 ql-xxx 反查支持落地——patches 持久映射让历史条目
  // 不再降级）：quick 直接用条目号 ql-xxx 发起对账（CLI 侧 findQuickSessionByQlId 反查
  // quick-xxxx 出记录态）；daemon 心跳反查到的 quick-<8hex> 作优先（会话仍活跃时走实时链，
  // 而非记录态）。
  const quickName = useQuickSessionName(workspaceId, qlId, enabled);
  const identifier =
    target.kind === "change" ? target.changeKey : (quickName ?? qlId);

  // 对账表取数（identifier 就绪即拉；change 直代，quick 反查成功后拉）。
  const auditQ = useQuery({
    queryKey: ["scope-audit-card", "audit", workspaceId, identifier],
    queryFn: () => getScopeAudit(workspaceId, identifier!),
    enabled: identifier !== "",
    refetchOnWindowFocus: false,
  });
  const audit = auditQ.data ?? null;
  const auditLoading = identifier !== "" && auditQ.isPending;

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

  // 分组激活（契约 v2，D-002/D-003）：repos 非空数组且 mode==='full-flow' → 按仓分组
  // 形态；repos 空/null（旧 CLI/旧 daemon/单仓变更）或 quick → 现状单段渲染（回退，
  // DOM/testid 原样，note 不渲染——兼容策略 6）。
  const groupedRepos =
    audit?.mode === "full-flow" &&
    Array.isArray(audit.repos) &&
    audit.repos.length > 0
      ? audit.repos
      : null;

  // 明细分桶（仅分组形态）：行 cross_repo ?? 'main' 归桶；桶序 = repos[] 序（main
  // 首位，CLI 保证），repos[] 未列出的孤儿 repo 桶按首现顺序尾随（Map 插入序）。
  // chips 计数单一源是信封 repos[].totals——分桶只管行归属，两者不一致时以信封为准
  // （CLI 单一源原则，design 消费语义）。
  const detailBuckets = useMemo(() => {
    if (!groupedRepos) return null;
    const rows = audit?.rows ?? [];
    const byKey = new Map<string, ScopeAuditRow[]>();
    for (const r of rows) {
      const key = r.cross_repo ?? "main";
      const bucket = byKey.get(key);
      if (bucket) bucket.push(r);
      else byKey.set(key, [r]);
    }
    const ordered: {
      repo: ScopeAuditRepoDto | null;
      key: string;
      rows: ScopeAuditRow[];
    }[] = [];
    for (const repo of groupedRepos) {
      const bucket = byKey.get(repo.key);
      if (bucket) {
        ordered.push({ repo, key: repo.key, rows: bucket });
        byKey.delete(repo.key);
      }
    }
    for (const [key, bucket] of byKey) {
      ordered.push({ repo: null, key, rows: bucket });
    }
    return ordered;
  }, [audit, groupedRepos]);

  // 明细弹窗 + 行点击联动的单文件 diff 弹窗。
  const [detailOpen, setDetailOpen] = useState(false);
  const [diffRow, setDiffRow] = useState<string | null>(null);

  const renderSummary = () => {
    if (identifier === "") {
      // quick 分支且 qlId 为空（理论不触发，防御）：降级为提示。
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

    // 分组形态（契约 v2，2026-09-20-scope-audit-cross-repo-platform，D-003/D-005）：
    // 全表合计行 + 每仓一段（段头=仓标识+锚点档 chip；chips 计数取信封
    // repos[].totals 单一源，不前端重算）；degraded 仓段整段 ⚠️ 原因不渲染 chips。
    if (groupedRepos) {
      const verdictOrder = ["planned", "unplanned", "untouched"] as const;
      return (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              全表{" "}
              <b className="font-mono font-semibold text-foreground">
                {audit.totals?.files ?? (audit.rows?.length ?? 0)}
              </b>{" "}
              文件
            </span>
            <span>
              <span className="text-success">+{fmtNum(audit.totals?.additions)}</span>{" "}
              /{" "}
              <span className="text-error">−{fmtNum(audit.totals?.deletions)}</span>
            </span>
            <span>{groupedRepos.length} 个仓库</span>
          </p>
          {groupedRepos.map((repo) => (
            <div
              key={repo.key}
              data-testid={`scope-audit-repo-seg-${repo.key}`}
              className="mt-2 border-t border-dashed border-border pt-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    repo.key === "main" ? "text-brand-700" : "text-foreground",
                  )}
                >
                  {repoDisplayName(repo.key)}
                </span>
                <RepoAnchorChip repo={repo} />
              </div>
              {repo.degraded ? (
                <p
                  className="mt-1.5 text-[11px] leading-relaxed text-warning"
                  data-testid={`scope-audit-repo-degraded-${repo.key}`}
                >
                  ⚠️{" "}
                  {repo.degraded_reason ??
                    "该仓跨仓对账不可达（未注册/路径不可达），请人工到对应仓核对"}
                </p>
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {verdictOrder.map((verdict) => {
                    const meta = VERDICT_META[verdict];
                    if (!meta) return null;
                    return (
                      <span
                        key={verdict}
                        data-testid={`scope-audit-chip-${repo.key}-${verdict}`}
                        className={cn(
                          "rounded-full px-2 py-px text-[11px] font-medium",
                          meta.className,
                        )}
                      >
                        {meta.label} {repo.totals?.[verdict] ?? 0}
                      </span>
                    );
                  })}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {fmtNum(repo.totals?.files)} 文件{" "}
                    <span className="text-success">
                      +{fmtNum(repo.totals?.additions)}
                    </span>{" "}
                    /{" "}
                    <span className="text-error">
                      −{fmtNum(repo.totals?.deletions)}
                    </span>
                  </span>
                </div>
              )}
            </div>
          ))}
          {audit.note && (
            <p
              className="mt-2 border-t border-dashed border-border pt-1.5 text-[11px] leading-relaxed text-muted-foreground"
              data-testid="scope-audit-note"
            >
              {audit.note}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
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
    }

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
          {detailBuckets
            ? detailBuckets.map((bucket) => {
                const repo = bucket.repo;
                return (
                  <Fragment key={bucket.key}>
                    {/* 粘性小节头：仓标识 + 该仓锚点档（孤儿桶无信封条目，仅显示 key） */}
                    <li
                      data-testid={`scope-audit-detail-group-${bucket.key}`}
                      className="sticky top-0 z-10 flex flex-wrap items-baseline gap-x-2 border-b bg-muted px-3 py-1"
                    >
                      <span
                        className={cn(
                          "text-[11px] font-semibold",
                          bucket.key === "main"
                            ? "text-brand-700"
                            : "text-foreground",
                        )}
                      >
                        {repoDisplayName(bucket.key)}
                      </span>
                      {repo && <RepoAnchorChip repo={repo} />}
                    </li>
                    {bucket.rows.map((row) => (
                      <DetailRow
                        key={row.path}
                        row={row}
                        mode={audit?.mode ?? "full-flow"}
                        repoBadge={bucket.key === "main" ? null : bucket.key}
                        onOpenDiff={setDiffRow}
                      />
                    ))}
                  </Fragment>
                );
              })
            : (audit?.rows ?? []).map((row) => (
                <DetailRow
                  key={row.path}
                  row={row}
                  mode={audit?.mode ?? "full-flow"}
                  onOpenDiff={setDiffRow}
                />
              ))}
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
