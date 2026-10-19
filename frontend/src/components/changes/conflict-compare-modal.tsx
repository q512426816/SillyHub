"use client";

/**
 * ConflictCompareModal — SillySpec 同步冲突对比弹窗（2026-09-07-
 * conflict-diff-compare task-07 / FR-02~FR-04 / FR-09 / D-002@v1 / D-003@v1）。
 *
 * 依据：
 *   - tasks/task-07.md implementation / acceptance / constraints；
 *   - design §5 Phase 3.3 + §7.2 compare 响应契约——前端纯渲染后端算好的
 *     本地/平台差异（diff_rows / progress_rows），不引入 diff 库；
 *   - 原型 prototype-conflict-diff-compare.html（时间条 / 文件清单 +
 *     side-by-side diff / 进度对比表 / 底部裁决条的布局交互基准）；
 *   - 先例：antd Modal 壳对齐 file-preview-modal.tsx（独立 Modal 不走
 *     App.useApp().modal）；diff 行语义色（bg-error/10 / bg-success/10）对齐
 *     git-log/file-tree.tsx DiffBody；裁决 modal.confirm + STRATEGY_TEXT 文案
 *     逐字对齐 platform-sync-section.tsx（行入口与挂载接线归 task-08）。
 *
 * 结构：打开即 react-query 拉 compare 端点（enabled: open）→ 头部时间条
 * （较旧一侧橙色方向提示，本地时间取自文件 mtime 仅辅助参考）→ spec-tree
 * 模式左文件清单（徽章四分类 + 默认只看差异 + 「涉及 N 个文件，其中归档
 * M 个」）+ 右 side-by-side diff；progress 模式三列对比表（differ 行橙色
 * 高亮，不甩原始 JSON）→ 底部裁决条（STRATEGY_TEXT 二次确认 →
 * triggerMachineSillySpecResolve → 成功 onDispatched + 关闭）。
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Modal } from "antd";

import { parseIsoLikeMs } from "@/components/changes/change-activity-badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import type { components } from "@/lib/api-types";
import {
  getSillySpecConflictCompare,
  triggerMachineSillySpecResolve,
} from "@/lib/daemon";
import { useNotify } from "@/lib/errors";
import { cn } from "@/lib/utils";

type CompareResponse = components["schemas"]["SillySpecConflictCompareResponse"];
type CompareFile = components["schemas"]["SillySpecConflictCompareFile"];
type ResolveStrategy =
  components["schemas"]["MachineSillySpecResolveRequest"]["strategy"];

export interface ConflictCompareModalConflict {
  /** 冲突变更名（quick- 会话名或普通变更名）。 */
  change: string;
  kind: "spec-tree" | "progress";
  /** quick 会话的 QUICKLOG 编号（daemon 心跳补报，best-effort 可缺省）。 */
  ql_id?: string | null;
  /** 冲突发生时间（心跳 pending_conflicts.created_at 原样透传）。 */
  created_at?: string | null;
}

export interface ConflictCompareModalProps {
  /** react-query enabled 门控（关闭不拉取）。 */
  open: boolean;
  onClose: () => void;
  /** compare 端点机器路径参数。 */
  instanceId: string;
  /** compare 端点 query 参数（平台侧 spec_root / progress 定位）。 */
  workspaceId: string;
  /** 待对比的冲突条目（null 时不拉取）。 */
  conflict: ConflictCompareModalConflict | null;
  /** 裁决权限（父级 useMachineSyncActionAccess.canOperate；false 不渲染裁决按钮）。 */
  canOperate: boolean;
  /** 下发成功回调（父级登记回显条目，回显走既有 sillyspec_command_result 链路）。 */
  onDispatched?: (change: string, strategy: ResolveStrategy) => void;
}

/** 缓存键（allowed_paths 只允许本文件 + lib/daemon.ts，就地常量不进 query-keys.ts）。 */
const QUERY_KEY_ROOT = ["conflict-compare-modal"] as const;

/**
 * 确认弹窗文案——文案唯一源在本文件（task-08 起裁决入口收进弹窗，
 * platform-sync-section 的同值副本已移除；覆盖方向 + 适用场景）。
 */
const STRATEGY_TEXT: Record<
  ResolveStrategy,
  { title: string; label: string; body: string; okText: string; danger: boolean }
> = {
  keep_local: {
    title: "保本地（keep-local）",
    label: "保本地",
    body: "用本机版本覆盖平台版本。适用于：本机是最新现场（如本会话刚完成的工作、归档后的终态）。平台端他机未拉取的更新将被本机版本覆盖。",
    okText: "确认 · 保本地",
    danger: false,
  },
  take_platform: {
    title: "取平台（take-platform）",
    label: "取平台",
    body: "用平台版本覆盖本机版本。适用于：他端推进了而你本机落后（如服务器/其他机器已裁决过的最新状态）。本机未推送的本地改动会被覆盖。",
    okText: "确认 · 取平台",
    danger: true,
  },
};

/** 旧 daemon 兜底提示（与 platform-sync-section 同文案）。 */
const DAEMON_VERSION_NOTE =
  "指令需较新版本 daemon 支持，旧版本会静默忽略（150 秒无回报将自动恢复按钮）。";

/** 失败卡分支臂（2026-10-16-conflict-full-tree-compare / FR-03 / D-004@v1 / D-012@v1）。 */
export type FailureCardArm = "record_missing" | "root_unknown" | "offline_timeout" | "generic";

export interface FailureCardBranch {
  arm: FailureCardArm;
  message: string;
  /** false = 不渲染「重试」——记录缺失/工作区未认领时重试必然同样失败。 */
  retry: boolean;
}

/** 外层 504 家族错误码（机器离线 / RPC 超时，runtime/service.py:83-99）。 */
const OFFLINE_TIMEOUT_CODES = new Set([
  "HTTP_504_DAEMON_RUNTIME_OFFLINE",
  "HTTP_504_DAEMON_RPC_TIMEOUT",
]);

/**
 * 失败卡分支判定（纯函数）——匹配键**必须**是 ``details.daemon_code``：
 * daemon 业务失败时外层 code 恒为 ``HTTP_502_DAEMON_RPC_REMOTE``，用它区分
 * ``conflict_record_missing`` 永不命中（D-012@v1，生产实证）。未知码回退
 * 通用失败臂（保留「重试」）。
 */
export function failureCardBranch(err: unknown): FailureCardBranch {
  const code = err instanceof ApiError ? err.code : null;
  const details =
    err instanceof ApiError && err.details !== null && typeof err.details === "object"
      ? (err.details as Record<string, unknown>)
      : null;
  const daemonCode = typeof details?.daemon_code === "string" ? details.daemon_code : null;
  if (daemonCode === "conflict_record_missing") {
    return {
      arm: "record_missing",
      message: "该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。",
      retry: false,
    };
  }
  if (daemonCode === "workspace_root_unknown") {
    return {
      arm: "root_unknown",
      message: "该工作区尚未被本机认领，请先在该工作区发起一次会话后重试。",
      retry: false,
    };
  }
  if (code !== null && OFFLINE_TIMEOUT_CODES.has(code)) {
    return {
      arm: "offline_timeout",
      message: "机器当前离线或响应超时（504），请确认数据源机器在线后重试。",
      retry: true,
    };
  }
  return {
    arm: "generic",
    message: "读取机器侧冲突快照失败，请稍后重试。",
    retry: true,
  };
}

/** 文件清单徽章（四分类；色阶走语义 token，原型 .fstat 视觉基准）。 */
const FILE_STATUS_META: Record<
  CompareFile["status"],
  { label: string; className: string }
> = {
  modified: { label: "修改", className: "bg-warning/15 text-warning" },
  local_only: { label: "仅本地", className: "bg-brand-50 text-brand-700" },
  platform_only: { label: "仅平台", className: "bg-violet-100 text-violet-700" },
  identical: { label: "相同", className: "bg-muted text-muted-foreground" },
};

/** 冲突 kind 徽章（platform-sync-section conflictTypeMeta 同款语义）。 */
function kindMeta(kind: "spec-tree" | "progress"): {
  label: string;
  className: string;
} {
  return kind === "spec-tree"
    ? { label: "spec 树", className: "bg-violet-100 text-violet-700" }
    : { label: "进度", className: "bg-warning/15 text-warning" };
}

/** ISO 原文 → 「YYYY-MM-DD HH:mm:ss」本地时区展示；畸形回退原文（不炸不猜）。 */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = parseIsoLikeMs(iso);
  if (ms === null) return iso;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 归档路径口径（后端排序 archive 沉底，前端仅计数展示）。 */
function isArchivePath(path: string): boolean {
  return path.startsWith("changes/archive/");
}

export function ConflictCompareModal({
  open,
  onClose,
  instanceId,
  workspaceId,
  conflict,
  canOperate,
  onDispatched,
}: ConflictCompareModalProps) {
  const { modal } = App.useApp();
  const notify = useNotify();
  // 文件清单「只看差异 / 全部」切换（默认只看差异，design §5 3.3）。
  const [showAll, setShowAll] = useState(false);
  // 用户点选的文件路径；未点选 / 数据刷新后回退首个可见文件。
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const change = conflict?.change ?? null;
  const kind = conflict?.kind ?? null;

  // 打开即拉取（enabled: open）；kind/workspace 变化走 queryKey 自然重拉。
  const compareQ = useQuery({
    queryKey: [...QUERY_KEY_ROOT, instanceId, change, kind, workspaceId],
    queryFn: () =>
      getSillySpecConflictCompare(
        instanceId,
        change as string,
        kind as "spec-tree" | "progress",
        workspaceId,
      ),
    enabled: open && change !== null,
    refetchOnWindowFocus: false,
  });

  const data = compareQ.data ?? null;
  const loading = open && compareQ.isPending;
  const failed = open && compareQ.isError;

  // ── spec-tree 派生（文件清单 + 选中文件）──────────────────────────────────
  const files = useMemo<CompareFile[]>(() => data?.files ?? [], [data]);
  const archiveCount = useMemo(
    () => files.filter((f) => isArchivePath(f.path)).length,
    [files],
  );
  const visibleFiles = useMemo(
    () => (showAll ? files : files.filter((f) => f.status !== "identical")),
    [files, showAll],
  );
  const selectedFile = useMemo(
    () =>
      visibleFiles.find((f) => f.path === selectedPath) ??
      visibleFiles[0] ??
      null,
    [visibleFiles, selectedPath],
  );

  // ── 时间条方向判定（较旧一侧给橙色回退提示；跨机时钟仅辅助不强断言）──────
  const localMs =
    data?.local_updated_at != null ? parseIsoLikeMs(data.local_updated_at) : null;
  const platformMs =
    data?.platform_updated_at != null
      ? parseIsoLikeMs(data.platform_updated_at)
      : null;
  const localOlder = localMs !== null && platformMs !== null && localMs < platformMs;
  const platformOlder =
    localMs !== null && platformMs !== null && platformMs < localMs;

  // ── 裁决下发（STRATEGY_TEXT modal.confirm 二次确认先例，platform-sync-section 同款）──
  const dispatchResolve = (strategy: ResolveStrategy) => {
    if (change === null) return;
    const text = STRATEGY_TEXT[strategy];
    modal.confirm({
      title: `裁决冲突：${text.title}`,
      content: (
        <div className="text-[13px] leading-6">
          <p className="mb-3">
            变更{" "}
            <code className="rounded border bg-muted px-1.5 py-px font-mono text-xs">
              {change}
            </code>
          </p>
          <p>{text.body}</p>
          <p className="mt-3 text-xs text-muted-foreground">{DAEMON_VERSION_NOTE}</p>
        </div>
      ),
      okText: text.okText,
      okType: text.danger ? "danger" : undefined,
      cancelText: "取消",
      onOk: async () => {
        try {
          await triggerMachineSillySpecResolve(instanceId, {
            change,
            strategy,
            // 2026-09-09-conflict-root-workspace-scoping task-06（FR-01）：裁决
            // 请求携带 workspace_id——daemon 按工作区映射取根，不再依赖单槽位
            //（prop 早已存在 L61，本 change 前未下传）。
            workspace_id: workspaceId,
          });
          // 下发成功：父级回显登记回调 + 关闭弹窗（回显走既有链路，§5 3.3）。
          onDispatched?.(change, strategy);
          onClose();
        } catch (err) {
          // 404（非本机归属）/ 504（机器离线）等统一中文 toast，弹窗保持可重选。
          notify.error(err, "下发裁决指令失败");
        }
      },
    });
  };

  // ── body 分发：loading / 失败重试 / 两种对比模式 ───────────────────────────

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3 text-sm text-muted-foreground">
            正在加载对比数据…（实时读取机器本地内容，可能需要数秒）
          </span>
        </div>
      );
    }
    if (failed) {
      const branch = failureCardBranch(compareQ.error);
      const serverMessage =
        compareQ.error instanceof Error && compareQ.error.message
          ? compareQ.error.message
          : "";
      return (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm font-semibold text-foreground">
            读取对比数据失败
          </p>
          <p
            className="max-w-md text-xs leading-5 text-muted-foreground"
            data-testid="compare-failure-message"
          >
            {branch.message}
          </p>
          {serverMessage && serverMessage !== branch.message ? (
            <p className="max-w-md break-all text-[11px] text-muted-foreground/70">
              服务端消息：{serverMessage}
            </p>
          ) : null}
          {branch.retry ? (
            <Button variant="outline" onClick={() => void compareQ.refetch()}>
              重试
            </Button>
          ) : null}
        </div>
      );
    }
    if (data === null) return null;
    return data.kind === "progress" ? renderProgressBody() : renderSpecTreeBody();
  };

  /** spec-tree 模式：左文件清单 + 右 side-by-side diff。 */
  const renderSpecTreeBody = () => {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* full-tree 兜底来源提示（FR-02 / D-006@v2）：固定说明行、无关闭控件 */}
        {data?.record_label === "full-tree" && (
          <p
            className="border-b bg-muted/60 px-5 py-1.5 text-xs text-muted-foreground"
            data-testid="compare-record-source"
          >
            该记录由全量同步产生（覆盖 {(data.covered_changes ?? []).length} 个变更
            {(data.path_total ?? null) !== null
              ? `，快照共 ${data.path_total} 个路径`
              : ""}
            ），本次仅展示与{" "}
            <code className="font-mono">{data.change}</code> 相关的 {files.length} 个路径。
          </p>
        )}
        {/* 整响应超限提示（2MB 帽丢部分差异明细；措辞避开与单文件截断提示混排） */}
        {data?.response_truncated && (
          <p className="border-b border-warning/30 bg-warning/10 px-5 py-1.5 text-xs text-warning">
            对比结果超出大小上限，部分文件的差异明细已被省略（清单与状态仍完整）。
          </p>
        )}
        <div className="flex min-h-0 flex-1">
          {/* 左栏：文件清单 */}
          <div className="flex w-64 shrink-0 flex-col border-r md:w-80">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">
                涉及 {files.length} 个文件
                {archiveCount > 0 ? `，其中归档 ${archiveCount} 个` : ""}
              </span>
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setShowAll(false)}
                  className={cn(
                    "px-2 py-0.5 text-xs transition-colors",
                    !showAll
                      ? "bg-brand-600 text-white"
                      : "hover:bg-muted",
                  )}
                >
                  只看差异
                </button>
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className={cn(
                    "border-l border-border px-2 py-0.5 text-xs transition-colors",
                    showAll
                      ? "bg-brand-600 text-white"
                      : "hover:bg-muted",
                  )}
                >
                  全部
                </button>
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {visibleFiles.length === 0 ? (
                <li className="px-3 py-3 text-xs text-muted-foreground">
                  无文件清单
                </li>
              ) : (
                visibleFiles.map((f) => {
                  const meta = FILE_STATUS_META[f.status];
                  return (
                    <li key={f.path} className="border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setSelectedPath(f.path)}
                        className={cn(
                          "flex w-full items-start gap-1.5 px-3 py-1.5 text-left transition-colors",
                          selectedFile?.path === f.path
                            ? "bg-brand-50"
                            : "hover:bg-muted/60",
                        )}
                      >
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 text-[10px] leading-4",
                            meta.className,
                          )}
                        >
                          {meta.label}
                        </span>
                        <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-4">
                          {f.path}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            {(data?.dropped_paths ?? 0) > 0 && (
              <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
                另有 {data?.dropped_paths} 个路径双侧内容均已缺失，未列入清单。
              </p>
            )}
          </div>

          {/* 右栏：side-by-side diff（选中文件） */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selectedFile === null ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                {files.length > 0 ? "选择左侧文件查看差异" : "无文件可对比"}
              </div>
            ) : (
              <>
                <div className="flex border-b text-xs font-semibold">
                  <div className="w-1/2 border-r px-3 py-1.5">本地</div>
                  <div className="w-1/2 px-3 py-1.5">平台</div>
                </div>
                {renderDiffPane(selectedFile)}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  /** 选中文件的 diff 区（二进制 / 截断占位 + 对齐行渲染）。 */
  const renderDiffPane = (file: CompareFile) => {
    if (file.binary) {
      return (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          二进制文件无法文本对比（可参考清单徽章与双方修改时间判断方向）
        </div>
      );
    }
    const rows = file.diff_rows ?? [];
    return (
      <>
        {file.local_truncated && (
          <p className="border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            本地内容过大已被截断，未生成完整差异（请以清单状态与修改时间辅助判断）。
          </p>
        )}
        {file.diff_truncated && (
          <p className="border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            差异行数超出展示上限（5000 行），以下仅截断展示部分差异。
          </p>
        )}
        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
            {file.status === "local_only"
              ? "该文件仅存在于本地（平台侧缺失），无逐行差异可对比。"
              : file.status === "platform_only"
                ? "该文件仅存在于平台（本地缺失），无逐行差异可对比。"
                : file.status === "identical"
                  ? "两侧内容一致，无差异。"
                  : "该文件暂无逐行差异内容。"}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-relaxed">
            {rows.map((row, i) => (
              <div key={i} className="flex" data-diff-type={row.type}>
                {/* 本地列：delete 行红底（bg-error/10，file-tree.tsx 同款语义 token） */}
                <div
                  className={cn(
                    "flex w-1/2 min-w-0 items-start border-r",
                    row.type === "delete" && "bg-error/10",
                  )}
                >
                  <span className="w-9 shrink-0 select-none pr-2 text-right text-[11px] text-muted-foreground/70">
                    {row.local_lineno ?? ""}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 break-all whitespace-pre-wrap py-0.5 pl-1 pr-3",
                      row.type === "delete" && "text-error",
                    )}
                  >
                    {row.local_text ?? ""}
                  </span>
                </div>
                {/* 平台列：insert 行绿底（bg-success/10） */}
                <div
                  className={cn(
                    "flex w-1/2 min-w-0 items-start",
                    row.type === "insert" && "bg-success/10",
                  )}
                >
                  <span className="w-9 shrink-0 select-none pr-2 text-right text-[11px] text-muted-foreground/70">
                    {row.platform_lineno ?? ""}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 break-all whitespace-pre-wrap py-0.5 pl-1 pr-3",
                      row.type === "insert" && "text-success",
                    )}
                  >
                    {row.platform_text ?? ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  /** progress 模式：三列关键信息对比表（D-003@v1，不甩原始 JSON）。 */
  const renderProgressBody = () => {
    const rows = data?.progress_rows ?? [];
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="w-44 px-4 py-2 text-left font-medium">对比项</th>
              <th className="px-4 py-2 text-left font-medium">本地</th>
              <th className="px-4 py-2 text-left font-medium">平台</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-center text-xs text-muted-foreground"
                >
                  无进度对比数据
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.label}
                  className={cn(
                    "border-b last:border-b-0",
                    row.differ && "bg-warning/10",
                  )}
                >
                  <td className="px-4 py-2">{row.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.local_value}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {row.platform_value}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const kMeta = kindMeta(kind ?? "spec-tree");

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1080px, 94vw)"
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span>冲突对比</span>
          <span
            className={cn("rounded px-1 text-[10px] leading-4", kMeta.className)}
          >
            {kMeta.label}
          </span>
          {conflict?.ql_id && (
            <span className="font-mono text-xs text-muted-foreground">
              【{conflict.ql_id}】
            </span>
          )}
          <code className="break-all font-mono text-xs text-muted-foreground">
            {change ?? "—"}
          </code>
        </div>
      }
    >
      {/* 头部时间条：双侧最后更新 + 较旧一侧橙色方向提示（原型 .time-strip） */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span>
          本地最后更新：
          <b className="font-mono font-semibold text-foreground">
            {formatDateTime(data?.local_updated_at)}
          </b>
          {localOlder && (
            <span className="ml-1.5 font-medium text-warning">
              本地较旧 · 保本地将回退平台较新内容
            </span>
          )}
        </span>
        <span>
          平台最后更新：
          <b className="font-mono font-semibold text-foreground">
            {formatDateTime(data?.platform_updated_at)}
          </b>
          {platformOlder && (
            <span className="ml-1.5 font-medium text-warning">
              平台较旧 · 取平台将回退本地较新内容
            </span>
          )}
        </span>
        <span className="basis-full text-[11px]">
          本地时间取自文件修改时间，仅辅助参考（机器本地钟，跨机不做强比较）。
        </span>
      </div>

      <div className="flex max-h-[calc(100vh-320px)] min-h-[420px] flex-col">
        {renderBody()}
      </div>

      {/* 底部裁决条（D-002@v1：裁决入口收进弹窗；无权限只读不渲染按钮） */}
      {canOperate && data !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
          <p className="min-w-60 flex-1 text-xs text-muted-foreground">
            裁决影响整个变更的同步方向：
            <b className="text-foreground">保本地</b>{" "}
            = 以这台机器的内容为准覆盖平台；
            <b className="text-foreground">取平台</b> =
            拉平台内容覆盖本机。请核对上方差异后选择。
          </p>
          <Button onClick={() => dispatchResolve("keep_local")}>保本地</Button>
          <Button
            variant="destructive"
            onClick={() => dispatchResolve("take_platform")}
          >
            取平台
          </Button>
        </div>
      )}
      {!canOperate && data !== null && (
        <p className="mt-3 border-t pt-3 text-[11px] text-muted-foreground">
          只读视角：仅机器所有者与平台管理员可执行裁决操作。
        </p>
      )}
    </Modal>
  );
}
