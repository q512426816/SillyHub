"use client";

/**
 * PreSessionPicker — 全部态新建的两步轻选择浮层（task-04 / FR-04 / D-107，
 * 2026-08-23-sessions-workspace-hub）。
 *
 * 依据：
 *   - tasks/task-04.md（allowed_paths / implementation / acceptance）
 *   - design.md §5 Wave3「组头＋：全部态先弹两步浮层」+ §11 D-107（两层筛选
 *     tab+全部按钮；筛选态＋直带上下文、全部态＋两步浮层——本组件只承载后者）
 *   - prototype-sessions-workspace-hub.html v2 .picker（.picker-mask 浮层视觉：
 *     ① 机器（仅在线）→ ② 智能体，两步即达非配置表单）
 *
 * 形态（纯展示受控组件，不自建数据请求——machines 由父层注入）：
 *   - 第一步仅在线机器卡（在线徽标 + 心跳时间，机器卡样式语义复用
 *     new-session-form.tsx ① 区：Badge status / display_alias || hostname /
 *     formatHeartbeat）；
 *   - 第二步该机器 runtimes 过滤 provider∈{claude, codex} 且在线，默认
 *     Claude Code 高亮（主色边框 + 「默认」Tag，同 new-session-form ② 区）；
 *   - 选完智能体立即 onPick(runtimeId) 关闭，无确认按钮（两步即达）；
 *   - 取消/遮罩点击仅回调 onCancel，不清父层状态（open 受控于父层）；
 *   - 空态引导：无在线机器 / 该机器无可用智能体。
 *
 * 门户接线（何时打开/上下文合成 onPick → preContext）归 task-06。
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Tag } from "antd";

import {
  PROVIDER_META,
  type DaemonMachineRead,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/** 支持交互式会话的引擎白名单（与 new-session-form 同源约束，D-107）。 */
const SESSION_SUPPORTED_PROVIDERS = new Set(["claude", "codex"]);

export interface PreSessionPickerProps {
  /** 受控开关（父层持有；取消/遮罩点击仅回调 onCancel）。 */
  open: boolean;
  /** 机器列表（父层注入，本组件零数据请求）。 */
  machines: DaemonMachineRead[];
  /** 取消回调（✕ / 遮罩点击）。 */
  onCancel: () => void;
  /** 选定智能体（runtimeId）立即回调并关闭（无确认按钮）。 */
  onPick: (_runtimeId: string) => void;
}

/* ────────────────────── 纯辅助（new-session-form 同款语义） ────────────────────── */

/** 机器展示名：别名优先，回退 hostname。 */
function machineLabel(m: DaemonMachineRead): string {
  return m.display_alias?.trim() || m.hostname;
}

/** 智能体展示名：主显引擎名（Claude Code/Codex），用户自定义别名时「别名 · 引擎」并呈。 */
function runtimeLabel(r: DaemonRuntimeRead): string {
  const engine = PROVIDER_META[r.provider ?? ""]?.label ?? r.provider ?? r.id;
  const alias = r.display_alias?.trim();
  return alias ? `${alias} · ${engine}` : engine;
}

/** ISO → "MM-DD HH:mm"；空/非法 → —（FRONTEND_PAGE_STYLE 空值统一）。 */
function formatHeartbeat(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 引擎图标（原型语义：claude ⚡ / codex ◎）。 */
function engineIcon(provider: string | null): string {
  if (provider === "claude") return "⚡";
  if (provider === "codex") return "◎";
  return "✦";
}

/* ────────────────────── 组件 ────────────────────── */

export function PreSessionPicker({
  open,
  machines,
  onCancel,
  onPick,
}: PreSessionPickerProps) {
  /** 第一步选中的机器 id（null = 停在第一步）。 */
  const [machineId, setMachineId] = useState<string | null>(null);
  // 打开时重置回第一步（取消不清父层状态，重开从机器列表重新开始）。
  useEffect(() => {
    if (open) setMachineId(null);
  }, [open]);

  // ① 仅在线机器（D-107：第一步机器白名单 = status online）。
  const onlineMachines = useMemo(
    () => machines.filter((m) => m.status === "online"),
    [machines],
  );
  const machine = useMemo(
    () => onlineMachines.find((m) => m.id === machineId) ?? null,
    [onlineMachines, machineId],
  );

  // ② 该机器可会话智能体：provider∈{claude,codex} 且在线。
  const supportedRuntimes = useMemo(
    () =>
      (machine?.runtimes ?? []).filter(
        (r) =>
          r.status === "online" &&
          SESSION_SUPPORTED_PROVIDERS.has(r.provider ?? ""),
      ),
    [machine],
  );

  if (!open) return null;

  return (
    <div
      data-testid="pre-session-picker-mask"
      aria-label="新建会话选择浮层"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // 遮罩自身点击才取消（浮层内点击不冒泡取消）。
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新建会话 · 选择运行位置"
        className="w-full max-w-[360px] rounded-xl border border-border bg-card p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            新建会话 · 选择运行位置
          </h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onCancel}
            className="shrink-0 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {!machine ? (
          <>
            {/* ① 机器（仅在线）——原型 .picker #pickStep1/#pickMachines。 */}
            <p className="mt-2 text-xs text-muted-foreground">① 机器（仅在线）</p>
            {onlineMachines.length === 0 ? (
              <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                暂无在线机器，请先启动 daemon 后再新建会话
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2" aria-label="机器列表">
                {onlineMachines.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-label={`选择机器 ${machineLabel(m)}`}
                    onClick={() => setMachineId(m.id)}
                    className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/60"
                  >
                    <span className="flex items-center gap-2">
                      <Badge status="success" />
                      <span className="text-sm font-medium text-foreground">
                        {machineLabel(m)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {m.online_runtime_count} 个智能体在线
                      </span>
                    </span>
                    <span className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {m.os ?? "—"} · {m.arch ?? "—"}
                      </span>
                      <span>心跳 {formatHeartbeat(m.last_heartbeat_at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* ② 智能体——原型 .picker #pickStep2/#pickAgents，选完即 onPick 关闭。 */}
            <p className="mt-2 text-xs text-muted-foreground">
              ② 智能体 · {machineLabel(machine)}（默认 Claude Code）
            </p>
            {supportedRuntimes.length === 0 ? (
              <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                该机器暂无可会话智能体（需要 Claude Code 或 Codex 在线）
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2" aria-label="智能体列表">
                {supportedRuntimes.map((r) => {
                  // 默认 Claude Code 高亮（new-session-form ② 区同款主色语义）。
                  const isDefault = r.provider === "claude";
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-label={`选择智能体 ${runtimeLabel(r)}`}
                      aria-pressed={isDefault}
                      onClick={() => onPick(r.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors",
                        isDefault
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border bg-card text-foreground hover:border-primary/60",
                      )}
                    >
                      <span aria-hidden>{engineIcon(r.provider)}</span>
                      <span>{runtimeLabel(r)}</span>
                      {isDefault && <Tag>默认</Tag>}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
