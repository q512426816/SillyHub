"use client";

/**
 * PlatformSyncSection — 变更中心「平台同步」处理区卡片（2026-09-04-
 * conflict-resolve-entry task-09 / FR-01~FR-05 / D-002@v1 / D-003@v1）。
 *
 * 依据：
 *   - tasks/task-09.md implementation / acceptance / constraints（视觉基准 =
 *     本变更 prototype-conflict-resolve.html：徽章/危险按钮/STRATEGY_TEXT
 *     弹窗文案/回显状态流）；
 *   - design.md §5 Phase 3：数据链复刻 changes-overview-card——
 *     fetchMyBinding(workspaceId).daemon_id → listDaemonMachines（15s 心跳级
 *     轮询，对齐 useDaemonMachines cadence）按 id 匹配 → 读机器 sillyspec 快照
 *     （冲突/ghost）+ machine.sillyspec_command_result（task-08 命令结果槽，
 *     回显来源）。ql-20260910-012-392f：快照取数对齐总览卡 14a50351d 的
 *     工作区级化——sillyspec_status_map 非空时按当前工作区取（缺席=该工作区
 *     未被采集，整卡不渲染而非串台他区数据——多工作区下机器级单槽位每轮被
 *     最后采集的工作区覆盖，正是本 quick 修的串台根因）；map 为 null（旧
 *     daemon 未启用工作区级采集）回退机器级 sillyspec_status 单槽位；
 *   - 无绑定 / 机器缺失 / sillyspec_status 缺失（含加载中）→ 整卡不渲染
 *     （return null，页面行为与现状一致，design §9 兼容策略）。
 *
 * 操作链（fire-and-forget 无回执，D-001@v1）：冲突行「查看对比」打开
 * ConflictCompareModal（2026-09-07-conflict-diff-compare task-07 产物），
 * 裁决（保本地/取平台）在弹窗内确认并下发（D-002@v1 按钮从行收进弹窗），
 * onDispatched 回调登记回显条目；「一键清理 ghost」仍走 antd App.useApp()
 * 的 modal.confirm（okType:"danger"）→ GhostCleanup。两者结果均经心跳
 * sillyspec_command_result 回传 → action+change 匹配本次下发即认定回报
 * （executed_at 为机器本地钟仅辅助、跨机不比较——X-18）→ 成功 toast（行随
 * 快照 ≤60-75s 消失，R-06）/ 失败红字摘要 + 恢复重试；ECHO_TIMEOUT_MS
 * （150s = 执行上限 120s + 一个心跳周期，X-17）无回报恢复可重试——旧
 * daemon 静默忽略指令的兜底（R-03），不做版本门控。
 *
 * 行改造（2026-09-07-conflict-diff-compare task-08 / D-004@v1）：quick 冲突
 * ql_id 存在时标题显示「【ql 编号】快速修复」+ 灰色小字原始会话 ID，缺失兜底
 * 原变更名；行上补冲突发生时间（created_at 相对时间）。「查看对比」机器离线
 * 禁用（compare 实时读本地快照无缓存，D-001@v1 方案A）并 title 提示；无权限
 * 用户不渲染（与 compare 端点同权限集合，Grill B1）。
 *
 * 权限（D-003@v1）：机器所有者 + 平台管理员可操作，其他成员只读（清单与
 * 计数）——useMachineSyncActionAccess 前端启发式仅控按钮显隐，后端权威。
 *
 * 样式（FRONTEND_PAGE_STYLE §0.5）：语义色走主题 token（success/error/
 * warning/brand 阶），无 hex 硬编码；危险操作用既有 Button variant=
 * "destructive" 先例；antd 组件色经 App 实例不静态调用。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";

import { SectionCard } from "@/components/layout";
import {
  formatAge,
  parseIsoLikeMs,
} from "@/components/changes/change-activity-badge";
import { ConflictCompareModal } from "@/components/changes/conflict-compare-modal";
import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api-types";
import {
  listDaemonMachines,
  triggerMachineSillySpecGhostCleanup,
} from "@/lib/daemon";
import { useNotify } from "@/lib/errors";
import { useMachineSyncActionAccess } from "@/lib/use-machine-sync-action-access";
import { fetchMyBinding } from "@/lib/workspace-binding";
import { cn } from "@/lib/utils";

/** task-08 产物（api-types 生成版，禁止手写）。 */
type SillySpecStatus = components["schemas"]["MachineSillySpecStatusRead"];
type SillySpecChange = components["schemas"]["DaemonHeartbeatSillySpecChange"];
type CommandResult = components["schemas"]["MachineSillySpecCommandResultRead"];
type ResolveStrategy =
  components["schemas"]["MachineSillySpecResolveRequest"]["strategy"];

/** 机器列表轮询间隔（15s 心跳级，对齐 useDaemonMachines；回显优先 ~15s 到达，R-06）。 */
const MACHINES_POLL_MS = 15_000;

/**
 * generated_at 陈旧阈值：与 changes-overview-card 同值同语义（连续多轮采集
 * 未刷新的启发式标记，daemon 瞬态失败保留旧快照时的「数据可能过期」提示）。
 */
const STALE_THRESHOLD_MS = 5 * 60_000;

/** ghost 折叠清单上限（changes[] 本身已被 daemon 摘要截断 N=50，防御性再截）。 */
const GHOST_LIST_LIMIT = 50;

/** 缓存键（allowed_paths 只允许本文件，不进 query-keys.ts 工厂，就地常量）。 */
const QUERY_KEY_ROOT = ["platform-sync-section"] as const;

/**
 * 下发后等待机器回报的恢复上限（导出供测试 fake timers 钉死）：执行上限
 * 120s（sillyspec_command_timeout_sec）+ 一个心跳周期 —— X-17；旧 daemon
 * default 分支静默忽略指令（R-03）也在此窗口后恢复按钮可重试。
 */
export const ECHO_TIMEOUT_MS = 150_000;

/**
 * 下发后短窗加速轮询（ql-20260911-024 回显提速第二级）：daemon 侧结果已落槽
 * 即补发心跳（秒级到 backend），前端 15s 常规轮询成为剩余瓶颈——下发后 15s
 * 窗内以 5s 间隔加速拉取（≈5s×3 次），窗口过后回退常规节拍。
 */
export const ECHO_FAST_POLL_MS = 5_000;
export const ECHO_FAST_WINDOW_MS = 15_000;

// 裁决确认弹窗文案（STRATEGY_TEXT）与下发动作已按 D-002@v1 收进对比弹窗
// （conflict-compare-modal.tsx，2026-09-07-conflict-diff-compare task-07 产物），
// 本文件不再持有行内裁决入口；ACTIVE_WARN_TEXT 活跃警示徽章仍归本文件（行上展示）。

/** 旧 daemon 兜底提示（ghost 清理确认弹窗用，R-03）。 */
const DAEMON_VERSION_NOTE =
  "指令需较新版本 daemon 支持，旧版本会静默忽略（150 秒无回报将自动恢复按钮）。";

// ── 纯函数 helpers（模块级，无 React 依赖）──────────────────────────────────

/**
 * 冲突 type → 徽章元数据（spec=紫 / 进度=琥珀；violet 为固定信息色先例，
 * warning 走主题 token；未知 type 原样中性展示）。changes-overview-card 的
 * conflictTypeMeta 为模块私有——按「模块私有就地内联不 export」惯例内联同值副本。
 */
function conflictTypeMeta(type: string | null | undefined): {
  label: string;
  className: string;
} {
  switch (type) {
    case "spec-tree":
      return { label: "spec", className: "bg-violet-100 text-violet-700" };
    case "progress":
      return { label: "进度", className: "bg-warning/15 text-warning" };
    default:
      return { label: type || "—", className: "bg-muted text-muted-foreground" };
  }
}

/** last_active 排序键（epoch ms；null/畸形沉底，parseIsoLikeMs 白名单解析）。 */
function lastActiveKey(c: SillySpecChange): number {
  if (!c.last_active) return Number.NEGATIVE_INFINITY;
  return parseIsoLikeMs(c.last_active) ?? Number.NEGATIVE_INFINITY;
}

/** ISO 原文 → 相对时间文案；null/畸形回退原文（change-activity-badge 同款）。 */
function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = parseIsoLikeMs(iso);
  return t !== null ? formatAge(Date.now() - t) : iso;
}

/** 命令结果槽结构键（识别「结果槽内容已变化」；null=槽已清空/无回报）。 */
function commandResultKeyOf(r: CommandResult | null | undefined): string | null {
  return r ? JSON.stringify(r) : null;
}

/** 单条下发条目的回显生命周期。 */
type PendingPhase = "waiting" | "succeeded" | "failed" | "timeout";

interface PendingEntry {
  phase: PendingPhase;
  kind: "resolve" | "ghost_cleanup";
  /** resolve 专用：冲突行变更名。 */
  change: string | null;
  /** resolve 专用：裁决方向。 */
  strategy: ResolveStrategy | null;
  /** 下发时刻（epoch ms；150s 恢复计时起点）。 */
  dispatchedAt: number;
  /**
   * 下发时刻命令结果槽的结构键：回显要求「结果已变化」才认定（防止把窗口
   * 内残留的上一条旧结果误当本次回报；latest-wins 只留最新一条，R-07）。
   */
  baselineResultKey: string | null;
  /** failed 阶段的机器错误摘要（daemon 侧已截断 ≤200 字）。 */
  errorText: string | null;
}

/**
 * 回报匹配（design §5 Phase 3 / X-18）：action+change 匹配本次下发即认定；
 * strategy 双方都有值时收紧匹配（同 change 两行连发不同方向的串扰防御）。
 */
function matchesCommandResult(
  r: CommandResult,
  entry: Pick<PendingEntry, "kind" | "change" | "strategy">,
): boolean {
  if (entry.kind === "ghost_cleanup") return r.action === "ghost_cleanup";
  if (r.action !== "resolve" || entry.change === null) return false;
  if (r.change !== entry.change) return false;
  if (entry.strategy && r.strategy && r.strategy !== entry.strategy) {
    return false;
  }
  return true;
}

/** 失败摘要文案（原型失败分支：exit code + daemon 截断的 stderr 摘要）。 */
function failureText(r: CommandResult): string {
  const exit = r.exit_code != null ? `（exit ${r.exit_code}）` : "";
  const err = r.error?.trim() || "未返回错误详情";
  return `执行失败${exit}：${err}`;
}

/**
 * 对比弹窗当前冲突（task-08 接线，ConflictCompareModal props 契约钉死的
 * conflict 形态）：kind 由冲突行 type 投影——progress 原样，其余按 spec-tree
 * （type 不收紧是心跳契约的既定决策，未知值走文件对比兜底）。
 */
interface CompareConflictTarget {
  change: string;
  kind: "spec-tree" | "progress";
  ql_id?: string | null;
  created_at?: string | null;
}

// ── 主组件 ──────────────────────────────────────────────────────────────────

export interface PlatformSyncSectionProps {
  /** 工作区 id（经 my-binding 的 daemon_id 定位数据源机器，同总览卡 FR-06 链路）。 */
  workspaceId: string;
  /** 移动端紧凑布局：冲突行纵向堆叠 + 按钮铺满 44px 触摸热区（m/ 页适配模式）。 */
  compact?: boolean;
  className?: string;
}

export function PlatformSyncSection({
  workspaceId,
  compact = false,
  className,
}: PlatformSyncSectionProps) {
  const { modal } = App.useApp();
  const notify = useNotify();
  // 下发条目表（key：resolve:<change>:<strategy> / ghost_cleanup）。
  const [pendingMap, setPendingMap] = useState<Record<string, PendingEntry>>({});
  // ghost 清单折叠组展开态（默认折一行计数，对齐总览卡 ghost 折叠组交互）。
  const [ghostExpanded, setGhostExpanded] = useState(false);
  // 对比弹窗当前冲突（null=关闭；行点击「查看对比」置值，弹窗关闭清态）。
  const [compareTarget, setCompareTarget] = useState<CompareConflictTarget | null>(
    null,
  );
  // 下发后加速轮询窗口截止时刻（epoch ms；0=未加速，ql-20260911-024）。
  const [pollBoostUntil, setPollBoostUntil] = useState(0);

  // 窗口到期回退常规节拍：到期 setTimeout 清 0 触发重渲染，让 machines 查询的
  // refetchInterval 选项从 5s 切回 15s（react-query 随选项值变化重排轮询定时器）。
  useEffect(() => {
    if (pollBoostUntil <= Date.now()) return;
    const timer = window.setTimeout(
      () => setPollBoostUntil(0),
      pollBoostUntil - Date.now(),
    );
    return () => window.clearTimeout(timer);
  }, [pollBoostUntil]);

  // 数据链（复刻 changes-overview-card）：fetchMyBinding 内部 catch → null。
  const bindingQ = useQuery({
    queryKey: [...QUERY_KEY_ROOT, "binding", workspaceId],
    queryFn: () => fetchMyBinding(workspaceId),
  });
  const daemonId = bindingQ.data?.daemon_id ?? null;

  const machinesQ = useQuery({
    queryKey: [...QUERY_KEY_ROOT, "machines"],
    queryFn: () => listDaemonMachines({ limit: 100 }),
    enabled: daemonId !== null,
    // 下发后加速窗内切 5s 短间隔（ql-20260911-024 第二级），窗外常规 15s。
    refetchInterval:
      Date.now() < pollBoostUntil ? ECHO_FAST_POLL_MS : MACHINES_POLL_MS,
  });

  const machine =
    daemonId !== null
      ? (machinesQ.data?.items.find((m) => m.id === daemonId) ?? null)
      : null;
  // 工作区级快照取数（ql-20260910-012-392f，对齐 changes-overview-card 同款）：
  // map 非空时按当前工作区取——缺席=该工作区未被采集，status=null 整卡不渲染
  // （刻意不回退机器级单槽位，那正是多工作区串台来源）；map 为 null（旧 daemon
  // 未启用）回退机器级 sillyspec_status。
  const statusMap = machine?.sillyspec_status_map ?? null;
  const status: SillySpecStatus | null =
    statusMap !== null
      ? (statusMap[workspaceId] ?? null)
      : (machine?.sillyspec_status ?? null);
  const commandResult: CommandResult | null =
    machine?.sillyspec_command_result ?? null;
  const currentResultKey = commandResultKeyOf(commandResult);

  const access = useMachineSyncActionAccess(machine);

  // 派生数据（status 可能 null——机器缺失/CLI 能力缺失，hooks 顺序恒定）。
  const ghosts = useMemo<SillySpecChange[]>(() => {
    const list = (status?.changes ?? []).filter((c) => c.ghost === true);
    return [...list]
      .sort((a, b) => lastActiveKey(b) - lastActiveKey(a))
      .slice(0, GHOST_LIST_LIMIT);
  }, [status]);

  const activeNames = useMemo(() => {
    // 活跃警示口径：冲突名出现在 changes[] 的非 ghost 行（该变更仍在机器上
    // 活跃推进）；changes 缺失（32KB 降级）时无法判定 → 不加警示。
    const names = new Set<string>();
    for (const c of status?.changes ?? []) {
      if (c.ghost !== true && c.name) names.add(c.name);
    }
    return names;
  }, [status]);

  const conflicts = status?.pending_conflicts ?? [];
  const ghostCount = status?.ghost_count ?? ghosts.length;

  const generatedMs =
    status?.generated_at != null ? parseIsoLikeMs(status.generated_at) : null;
  const stale = generatedMs !== null && Date.now() - generatedMs > STALE_THRESHOLD_MS;

  // 回显效应：命令结果槽内容变化且匹配任一 waiting 条目 → 终态转移 + 成功 toast。
  // pendingRef 让 effect 在结果到达时读到最新条目表（避免闭包过期）。
  const pendingRef = useRef(pendingMap);
  pendingRef.current = pendingMap;

  useEffect(() => {
    if (commandResult === null || currentResultKey === null) return;
    const updates: Record<string, PendingEntry> = {};
    const successToasts: string[] = [];
    for (const [key, entry] of Object.entries(pendingRef.current)) {
      if (entry.phase !== "waiting") continue;
      if (currentResultKey === entry.baselineResultKey) continue; // 仍是旧结果
      if (!matchesCommandResult(commandResult, entry)) continue;
      if (commandResult.state === "success") {
        updates[key] = { ...entry, phase: "succeeded" };
        successToasts.push(
          entry.kind === "ghost_cleanup"
            ? "机器回报：ghost 清理完成，计数将在下一轮采集刷新（≤75 秒）"
            : `机器回报：${entry.change ?? "变更"} 冲突已消解，计数将在下一轮采集刷新（≤75 秒）`,
        );
      } else {
        updates[key] = {
          ...entry,
          phase: "failed",
          errorText: failureText(commandResult),
        };
      }
    }
    if (Object.keys(updates).length === 0) return;
    setPendingMap((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(updates)) {
        if (next[k]?.phase === "waiting") next[k] = v;
      }
      return next;
    });
    for (const msg of successToasts) notify.success(msg);
  }, [commandResult, currentResultKey, notify]);

  // 150s 无回报恢复：每条 waiting 条目一个 setTimeout（按 dispatchedAt 计算
  // 剩余时长；条目表变化时重建未到期计时器，effect cleanup 清掉旧计时器防泄漏）。
  useEffect(() => {
    const timers: number[] = [];
    for (const [key, entry] of Object.entries(pendingMap)) {
      if (entry.phase !== "waiting") continue;
      const remaining = ECHO_TIMEOUT_MS - (Date.now() - entry.dispatchedAt);
      timers.push(
        window.setTimeout(
          () => {
            setPendingMap((prev) => {
              const cur = prev[key];
              if (!cur || cur.phase !== "waiting") return prev;
              return { ...prev, [key]: { ...cur, phase: "timeout" } };
            });
          },
          Math.max(0, remaining),
        ),
      );
    }
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [pendingMap]);

  /**
   * 整卡不渲染条件（design §5 Phase 3 / §9）：无绑定（含加载中）、机器缺失
   * 或 sillyspec_status 缺失（CLI 能力缺失/旧后端）——页面行为与现状一致。
   */
  if (machine === null || status === null) return null;

  // 机器在线判定（session-panel machineOnline 先例）：「查看对比」需实时读取
  // 本地快照（D-001@v1 方案A 无缓存），离线时禁用入口。
  const machineOnline = machine.status === "online";

  // ── 回显登记（对比弹窗裁决下发成功回调 / ghost 清理确认下发）─────────────

  /**
   * 对比弹窗 onDispatched（task-08 / design §5 Phase 3.3）：裁决确认与
   * triggerMachineSillySpecResolve 下发都在弹窗内完成（D-002@v1），本回调仅
   * 登记 waiting 回显条目，走既有 sillyspec_command_result 回显链路。
   */
  const handleCompareDispatched = (change: string, strategy: ResolveStrategy) => {
    setPendingMap((prev) => ({
      ...prev,
      [`resolve:${change}:${strategy}`]: {
        phase: "waiting",
        kind: "resolve",
        change,
        strategy,
        dispatchedAt: Date.now(),
        baselineResultKey: commandResultKeyOf(machine.sillyspec_command_result),
        errorText: null,
      },
    }));
    // 回显提速第二级：daemon 侧结果落槽即补发心跳（秒级到 backend），前端
    // 开 15s 加速窗以 5s 间隔拉取回报（ql-20260911-024）。
    setPollBoostUntil(Date.now() + ECHO_FAST_WINDOW_MS);
    notify.success(
      `指令已下发：${change} → ${
        strategy === "keep_local" ? "保本地" : "取平台"
      }（等待机器回报）`,
    );
  };

  const dispatchGhostCleanup = () => {
    if (ghostCount === 0) return;
    modal.confirm({
      title: "清理 ghost 残留",
      content: (
        <div className="text-[13px] leading-6">
          <p>
            将对数据源机器{" "}
            <b className="font-mono">{machine.hostname}</b> 下发清理指令，波及范围：
          </p>
          <ul className="my-2 list-disc pl-5">
            <li>本地数据库中的幽灵记录（目录已不存在的变更行）→ 归档；</li>
            <li>超过 7 天的空壳变更目录 → 归档；</li>
            <li>随后自动执行平台同步，平台侧终态/墓碑随之收敛。</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            {DAEMON_VERSION_NOTE}清理过程不影响正常活跃变更。
          </p>
        </div>
      ),
      okText: "确认清理",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await triggerMachineSillySpecGhostCleanup(machine.id);
          setPendingMap((prev) => ({
            ...prev,
            ghost_cleanup: {
              phase: "waiting",
              kind: "ghost_cleanup",
              change: null,
              strategy: null,
              dispatchedAt: Date.now(),
              baselineResultKey: commandResultKeyOf(
                machine.sillyspec_command_result,
              ),
              errorText: null,
            },
          }));
          // 回显提速第二级：同 resolve 下发点开 15s 加速窗（ql-20260911-024）。
          setPollBoostUntil(Date.now() + ECHO_FAST_WINDOW_MS);
          notify.success("指令已下发：ghost 清理（等待机器回报）");
        } catch (err) {
          notify.error(err, "下发清理指令失败");
        }
      },
    });
  };

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  /** 行回显状态文案（waiting/succeeded/timeout；failed 走下方红字摘要）。 */
  const rowStateText = (entry: PendingEntry | undefined): string | null => {
    if (!entry) return null;
    switch (entry.phase) {
      case "waiting":
        return "已下发 · 等待机器回报";
      case "succeeded":
        return entry.kind === "ghost_cleanup"
          ? "清理完成 · 等待快照刷新（≤75 秒）"
          : "已消解 · 等待快照刷新（≤75 秒）";
      case "timeout":
        return "150 秒无机器回报（旧版 daemon 可能已忽略）· 可重试";
      default:
        return null;
    }
  };

  const ghostPending = pendingMap["ghost_cleanup"];

  return (
    <SectionCard
      title="平台同步"
      bodyPadding="p-0"
      className={className}
      // 卡头摘要（原型 .card-head）：未决冲突/ghost 计数 + 数据源机器与新鲜度
      extra={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            未决冲突{" "}
            <b className={cn(conflicts.length > 0 && "text-error")}>
              {conflicts.length}
            </b>{" "}
            · ghost{" "}
            <b className={cn(ghostCount > 0 && "text-error")}>{ghostCount}</b>
          </span>
          <span
            className="whitespace-nowrap"
            title={status.generated_at ?? undefined}
          >
            数据源机器：{machine.hostname} · 更新于{" "}
            {generatedMs !== null ? formatAge(Date.now() - generatedMs) : "—"}
          </span>
          {stale && (
            <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
              数据可能过期
            </span>
          )}
        </div>
      }
    >
      {/* 冲突行清单（原型 .row：type 徽章 + 变更名 mono + 活跃警示 + 行内裁决） */}
      {conflicts.length === 0 ? (
        <p className="border-b px-4 py-3 text-xs text-muted-foreground">
          暂无未决同步冲突
        </p>
      ) : (
        <ul className="border-b" data-testid="platform-sync-conflicts">
          {conflicts.map((c, i) => {
            const name = c.change || "—";
            const meta = conflictTypeMeta(c.type);
            const activeWarn = name !== "—" && activeNames.has(name);
            // 行回显条目 = 两方向中已存在的那条（同刻仅一行一发；失败/超时后恢复）。
            const entry =
              pendingMap[`resolve:${name}:keep_local`] ??
              pendingMap[`resolve:${name}:take_platform`];
            const waiting = entry?.phase === "waiting";
            const succeeded = entry?.phase === "succeeded";
            const stateText = rowStateText(entry);
            return (
              <li
                key={`${c.type ?? "?"}-${name}-${i}`}
                className="border-b px-4 py-3 last:border-b-0"
                data-testid="platform-sync-conflict-row"
              >
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-2",
                    compact && "flex-col items-stretch gap-2",
                  )}
                >
                  <div
                    className={cn(
                      "flex min-w-0 flex-wrap items-center gap-2",
                      compact && "items-start",
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
                    {c.ql_id ? (
                      <>
                        {/* ql 标题（D-004@v1）：quick 冲突显示 QUICKLOG 编号，
                            原始会话 ID 降为灰色小字 */}
                        <span className="break-all text-[13px] font-semibold">
                          【{c.ql_id}】快速修复
                        </span>
                        <code className="break-all font-mono text-[11px] text-muted-foreground">
                          {name}
                        </code>
                      </>
                    ) : (
                      <code className="break-all font-mono text-[13px] font-semibold">
                        {name}
                      </code>
                    )}
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      冲突发生于 {relativeAge(c.created_at)}
                    </span>
                    {activeWarn && (
                      <span
                        data-testid="platform-sync-active-warn"
                        className="rounded border border-dashed border-error/50 bg-error/10 px-1.5 py-px text-[11px] font-medium whitespace-nowrap text-error"
                      >
                        ⚠ 活跃变更 · 谨慎裁决
                      </span>
                    )}
                  </div>
                  {stateText && (
                    <span
                      data-testid={`platform-sync-state-${entry?.phase}`}
                      className={cn(
                        "text-xs",
                        entry?.phase === "succeeded" && "text-success",
                        entry?.phase === "timeout" && "text-warning",
                        entry?.phase === "waiting" && "text-brand-600",
                      )}
                    >
                      {stateText}
                    </span>
                  )}
                  {access.canOperate && !succeeded && (
                    <div
                      className={cn(
                        "flex gap-2",
                        compact ? "w-full" : "ml-auto",
                      )}
                    >
                      {/* 按钮收敛（D-002@v1）：裁决收进对比弹窗，行上只留入口；
                          离线禁用（compare 实时读本地快照），waiting 回显期间禁用 */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={waiting || !machineOnline}
                        title={
                          machineOnline
                            ? undefined
                            : "机器离线，无法读取本地内容"
                        }
                        onClick={() => {
                          if (!c.change) return;
                          setCompareTarget({
                            change: c.change,
                            kind: c.type === "progress" ? "progress" : "spec-tree",
                            ql_id: c.ql_id ?? null,
                            created_at: c.created_at ?? null,
                          });
                        }}
                        className={cn(compact && "min-h-[44px] flex-1")}
                      >
                        查看对比
                      </Button>
                    </div>
                  )}
                </div>
                {entry?.phase === "failed" && entry.errorText && (
                  <p
                    className="mt-1.5 break-all text-xs text-error"
                    data-testid="platform-sync-fail-text"
                  >
                    {entry.errorText}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ghost 区（原型 .ghost-zone：计数 + 折叠清单 + 一键清理 danger） */}
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">
            残留记录 (ghost){" "}
            <b className={cn(ghostCount > 0 ? "text-error" : "text-foreground")}>
              {ghostCount}
            </b>{" "}
            个 —— 目录已不存在 · 建议清理
          </span>
          {rowStateText(ghostPending) && (
            <span
              data-testid={`platform-sync-state-${ghostPending?.phase}`}
              className={cn(
                "text-xs",
                ghostPending?.phase === "succeeded" && "text-success",
                ghostPending?.phase === "timeout" && "text-warning",
                ghostPending?.phase === "waiting" && "text-brand-600",
              )}
            >
              {rowStateText(ghostPending)}
            </span>
          )}
          {access.canOperate && ghostPending?.phase !== "succeeded" && (
            <div className={cn("flex", compact ? "w-full" : "ml-auto")}>
              <Button
                size="sm"
                variant="destructive"
                disabled={ghostCount === 0 || ghostPending?.phase === "waiting"}
                onClick={dispatchGhostCleanup}
                className={cn(compact && "min-h-[44px] w-full")}
                data-testid="platform-sync-ghost-cleanup"
              >
                一键清理 ghost
              </Button>
            </div>
          )}
        </div>
        {ghostPending?.phase === "failed" && ghostPending.errorText && (
          <p
            className="mt-1.5 break-all text-xs text-error"
            data-testid="platform-sync-fail-text"
          >
            {ghostPending.errorText}
          </p>
        )}

        {/* 折叠清单（默认折一行，展开逐行 ghost 变更名 mono + 最近活跃） */}
        {ghosts.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              aria-expanded={ghostExpanded}
              onClick={() => setGhostExpanded((v) => !v)}
              className="flex w-full flex-wrap items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-brand-600"
            >
              <span aria-hidden>{ghostExpanded ? "▾" : "▸"}</span>
              <span className="text-brand-600">
                {ghostExpanded ? "收起清单" : `展开查看 ${ghosts.length} 条清单`}
              </span>
            </button>
            {ghostExpanded && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {ghosts.map((g, idx) => (
                  <li
                    key={`${g.name ?? "?"}-${idx}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <code className="break-all font-mono text-[12px]">
                      {g.name || "—"}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      最近活跃 {relativeAge(g.last_active)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 只读视角说明（非机器所有者/平台管理员：无操作按钮，仅清单与计数） */}
      {!access.canOperate && (
        <p className="border-t border-dashed bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          只读视角：仅机器所有者与平台管理员可执行裁决 / 清理操作。
        </p>
      )}

      {/* 对比弹窗（task-07 产物，task-08 接线）：行点击置当前冲突，关闭清态；
          裁决在弹窗内确认下发，onDispatched 仅登记回显条目（D-002@v1） */}
      <ConflictCompareModal
        open={compareTarget !== null}
        onClose={() => setCompareTarget(null)}
        instanceId={machine.id}
        workspaceId={workspaceId}
        conflict={compareTarget}
        canOperate={access.canOperate}
        onDispatched={handleCompareDispatched}
      />
    </SectionCard>
  );
}
