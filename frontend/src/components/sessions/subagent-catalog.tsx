"use client";

/**
 * task-08（2026-08-19-session-stream-ux / FR-04 / D-003@v1）：子代理目录。
 *
 * 会话头部触发按钮 + 下拉清单 + 点击行定位跳转，视觉/交互对齐原型
 * prototype-session-stream.html 的 .subagent-catalog-btn /
 * .subagent-catalog-popover / jumpTo()（D-003 视觉基准）。
 *
 * 数据与职责边界（design §5 Phase3）：
 *   - 只消费派生数据：从当前运行中（缺则最新）turn 的 segments 经
 *     deriveTurnActivity（task-07）派生 SubagentActivity[]，不解析日志；
 *   - 点击行只调 onJumpTo(segmentId)——切进度视图 + 展开对应子代理块 +
 *     scrollIntoView 滚动定位均由父层（task-09 接线）完成，本组件不直接
 *     操作 DOM 滚动（受控纯粹性；原型 jumpTo 的三动作属父层职责）；
 *   - 时长如实显示：运行中 = (now - startedAt) 客户端每秒 tick 补足
 *     （deepseek subagentTiming 模式：服务端只推边界时刻）；已完成 =
 *     endedAt - startedAt；时间戳缺失显示「—」。token 无数据不显示（design
 *     非目标，不编造）。
 *
 * 渲染经济性（FR-06）：每秒 tick 是局部 state，仅存在 running 子代理时启动
 * （卸载清理）；派生清单 useMemo（turns 引用未变时跳过重算）。
 * 子代理清单为空（turns 空 / 无 segments / 无子代理段）→ 整体不渲染（返回
 * null，空态不崩）。
 *
 * 挂载范围（Grill X-09）：仅 /sessions 页头部（task-09 接线）；runtimes
 * 弹窗不挂。antd 不用——轻量自绘，与 sessions 组件现有 tailwind 风格一致。
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import {
  deriveTurnActivity,
  formatElapsedMmss,
  type SubagentActivity,
} from "@/components/daemon/turn-status-bar";
import { cn } from "@/lib/utils";

export interface SubagentCatalogProps {
  /** 会话轮次序列（组件内自行选当前运行中/最新轮派生子代理清单）。 */
  turns: SessionTurnView[];
  /**
   * 点击清单行的定位跳转回调（父层负责切进度视图 + 展开对应子代理块 +
   * scrollIntoView 滚动居中，原型 jumpTo 三动作）。可选：未提供时行仍可
   * 点击（只收起下拉）。
   */
  onJumpTo?: (segmentId: string) => void;
}

/**
 * 目录数据源轮选择（task-08 implementation：当前运行中（缺则最新）turn）。
 * 运行中 = pending/running/interrupting（同 TurnStatusBar 渲染门控口径）；
 * 从后往前找第一个运行中轮；都终态则取末位（最新）轮。turns 空返回 null。
 */
function pickCatalogTurn(turns: SessionTurnView[]): SessionTurnView | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t && (t.status === "running" || t.status === "pending" || t.status === "interrupting")) {
      return t;
    }
  }
  return turns.length > 0 ? (turns[turns.length - 1] ?? null) : null;
}

/** 行状态点样式（原型 .catalog-row .st：running=brand 阶 pulse / done 绿 / deny 红）。 */
const STATUS_DOT_CLS: Record<"running" | "done" | "deny", string> = {
  running: "animate-pulse bg-brand-600",
  done: "bg-emerald-600",
  deny: "bg-destructive",
};

/** 单行时长：运行中 = now 补秒；已完成 = endedAt - startedAt；锚点缺失「—」。 */
function subagentDuration(sa: SubagentActivity, now: number): string {
  if (sa.status === "running") {
    return sa.startedAt != null ? formatElapsedMmss(now - sa.startedAt) : "—";
  }
  return sa.startedAt != null && sa.endedAt != null
    ? formatElapsedMmss(sa.endedAt - sa.startedAt)
    : "—";
}

/**
 * 子代理目录（FR-04）：头部「子代理 ▾」按钮（运行中脉冲点 + 计数）+
 * 下拉清单（状态点/名称/类型/时长 mono）+ 点击行 onJumpTo 定位。
 * 无任何子代理段时返回 null（不占位）。
 */
export function SubagentCatalog({ turns, onJumpTo }: SubagentCatalogProps) {
  const [open, setOpen] = useState(false);

  // 每秒 tick（FR-06 局部 state）：仅存在 running 子代理时启动，卸载/转终态清理。
  const [now, setNow] = useState<number>(() => Date.now());

  /** 数据源轮的派生子代理清单（turns 引用未变时跳过重算）。 */
  const subagents = useMemo(() => {
    const turn = pickCatalogTurn(turns);
    return turn?.segments ? deriveTurnActivity(turn.segments).subagents : [];
  }, [turns]);

  const runningCount = useMemo(
    () => subagents.filter((s) => s.status === "running").length,
    [subagents],
  );
  const hasRunning = runningCount > 0;

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  // 开合：点击组件外区域收起（原型 document click 模式；按钮/弹层内点击
  // stopPropagation 防误关）+ Escape 收起（键盘可达）。
  useEffect(() => {
    if (!open) return;
    const onDocClick = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 空态：无任何子代理段 → 整体不渲染（acceptance：清单为空不崩）。
  if (subagents.length === 0) return null;

  return (
    <div className="relative inline-flex">
      {/* 触发按钮（原型 .subagent-catalog-btn：边框 6px 圆角小按钮 +
          运行脉冲点 + 计数 ▾；计数 = 有运行中显示运行中数，否则总数）。 */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`子代理目录，共 ${subagents.length} 个${
          hasRunning ? `，${runningCount} 个运行中` : ""
        }`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-[3px] text-xs text-foreground hover:bg-muted"
      >
        {hasRunning && (
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-600" />
        )}
        <span>子代理</span>
        <span className="rounded-full bg-brand-100 px-1.5 text-[10.5px] font-semibold leading-4 text-brand-700">
          {hasRunning ? runningCount : subagents.length}
        </span>
        <ChevronDown aria-hidden className="h-3 w-3 text-muted-foreground" />
      </button>

      {/* 下拉清单（原型 .subagent-catalog-popover：右对齐 380px 级卡片 +
          标题 + 行列表）。弹层内点击 stopPropagation，仅行点击/外部/Escape 收起。 */}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-30 mt-1.5 w-96 overflow-hidden rounded-xl border border-border bg-card shadow-md"
        >
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-foreground">
            子代理目录
            <span className="rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold leading-4 text-brand-700">
              {subagents.length}
            </span>
          </div>
          <ul role="list" className="max-h-80 overflow-y-auto">
            {subagents.map((sa) => (
              <li key={sa.segmentId} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onJumpTo?.(sa.segmentId);
                  }}
                  title={`${sa.name}${sa.subagentType ? ` · ${sa.subagentType}` : ""}${
                    sa.latestActivity ? `\n${sa.latestActivity}` : ""
                  }`}
                  className="flex w-full items-center gap-2 px-3 py-[7px] text-left text-xs hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT_CLS[sa.status])}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{sa.name}</span>
                  {sa.subagentType && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {sa.subagentType}
                    </span>
                  )}
                  {/* 时长 mono（运行中每秒跳动；token 无数据不显示）。 */}
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {subagentDuration(sa, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
