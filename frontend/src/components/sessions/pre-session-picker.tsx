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
 *   - 第二步该机器 runtimes 过滤 provider∈{claude, codex, pi} 且在线，默认
 *     Claude Code 高亮（主色边框 + 「默认」Tag，同 new-session-form ② 区）；
 *   - 选完智能体立即 onPick(runtimeId) 关闭，无确认按钮（两步即达）；
 *   - 取消/遮罩点击仅回调 onCancel，不清父层状态（open 受控于父层）；
 *   - 空态引导：无在线机器 / 该机器无可用智能体。
 *   - 容器双形态 variant（task-13 / 2026-08-26-mobile-workspace-page / FR-08 / FR-11）：
 *     center=居中卡（默认，既有调用点不传 → 桌面零回归）；bottomSheet=移动贴底抽屉
 *     （items-end 满宽 + rounded-t-2xl + max-h-[80dvh] 滚动 + 底部安全区留白，选项
 *     min-h-[44px] 触摸热区，对齐原型 prototype-mobile-workspace.html 屏幕7）——
 *     仅容器定位/外观类差异，两步选择逻辑零分叉。
 *
 * 门户接线（何时打开/上下文合成 onPick → preContext）归 task-06。
 *
 * 工作区绑定机器模式（2026-10-15-workspace-session-agent-only）：新增可选 prop
 * boundMachineId——非空即「绑定模式」，跳过「① 机器」步直接列该机器智能体
 * （机器已由工作区对本人的 per-member binding 钉定，无需也不允许再选机器；
 * 绑定机器离线/不可见时给专门空态，不落回全机器列表）。缺省/null/空串 =
 * 原两步流程，零回归。三宿主（门户/悬浮宿主/移动页）共用的解析纯函数
 * （boundMachineIdFor / pickDefaultRuntimeOnMachine / pickRuntimeByProvider）
 * 同文件导出，避免三处重复实现。
 */

import { useEffect, useMemo, useState } from "react";
import { Bot, Command, Plus, Zap } from "lucide-react";
import { Tag } from "antd";

import {
  PROVIDER_META,
  SESSION_SUPPORTED_PROVIDERS,
  type DaemonMachineRead,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import type { MemberBindingView } from "@/lib/workspace-binding";
import { cn } from "@/lib/utils";

/**
 * 支持交互式会话的引擎白名单（ql-20260908-007 起单一源 lib/daemon/
 * runtimes.ts，与 session-list-panel 智能体筛选下拉 / runtime 悬浮助手
 * 共用；此处建 Set 供 .has 快查）；引擎变迁史见源注释（pi 2026-09-04 /
 * cursor 2026-09-08）。
 */
const SESSION_SUPPORTED_PROVIDER_SET = new Set<string>(
  SESSION_SUPPORTED_PROVIDERS,
);

export interface PreSessionPickerProps {
  /**
   * 容器形态（task-13 / FR-08 / FR-11）：center=居中卡（默认，桌面零回归）；
   * bottomSheet=移动贴底抽屉（仅容器定位/外观类差异，两步逻辑零分叉）。
   */
  variant?: "center" | "bottomSheet";
  /** 受控开关（父层持有；取消/遮罩点击仅回调 onCancel）。 */
  open: boolean;
  /** 机器列表（父层注入，本组件零数据请求）。 */
  machines: DaemonMachineRead[];
  /**
   * 工作区绑定机器 id（2026-10-15-workspace-session-agent-only）：非空 =
   * 绑定模式——跳过「① 机器」步，直接列该机器智能体（机器离线/不可见时给
   * 专门空态，不落回全机器列表）；缺省/null/空串 = 原两步流程（零回归）。
   * 由宿主经 boundMachineIdFor(bindings, workspaceId) 解析注入。
   */
  boundMachineId?: string | null;
  /** 取消回调（✕ / 遮罩点击）。 */
  onCancel: () => void;
  /** 选定智能体（runtimeId）立即回调并关闭（无确认按钮）。 */
  onPick: (_runtimeId: string) => void;
}

/* ────────────────────── 新建选点解析纯函数（三宿主共用） ────────────────────── */

/**
 * 工作区绑定机器 id（2026-10-15-workspace-session-agent-only）：当前用户对该
 * 工作区的 per-member binding（MemberBindingView.daemon_id）→ 机器 id。
 * 无 workspaceId / 无 binding / daemon_id 空 → null（调用方回退原两步流程）。
 */
export function boundMachineIdFor(
  bindings:
    | Array<Pick<MemberBindingView, "workspace_id" | "daemon_id">>
    | null
    | undefined,
  workspaceId: string | null | undefined,
): string | null {
  if (!workspaceId) return null;
  const hit = (bindings ?? []).find((b) => b.workspace_id === workspaceId);
  return hit?.daemon_id ?? null;
}

/**
 * 机器上的默认直带 runtime：在线且 provider∈{claude, codex}，claude 优先。
 * 与既有 ?new=1 / 悬浮宿主默认解析同语义（单一实现）；pi/cursor 不参与
 * 自动默认（可经浮层显式选择），无命中返回 null。
 */
export function pickDefaultRuntimeOnMachine(
  machine: DaemonMachineRead | null | undefined,
): DaemonRuntimeRead | null {
  const runtimes = (machine?.runtimes ?? []).filter(
    (r) => r.status === "online" && (r.provider === "claude" || r.provider === "codex"),
  );
  return runtimes.find((r) => r.provider === "claude") ?? runtimes[0] ?? null;
}

/** 机器上指定引擎的在线 runtime（列表筛选直带用）；无命中返回 null。 */
export function pickRuntimeByProvider(
  machine: DaemonMachineRead | null | undefined,
  provider: string,
): DaemonRuntimeRead | null {
  return (
    (machine?.runtimes ?? []).find(
      (r) => r.status === "online" && r.provider === provider,
    ) ?? null
  );
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

/** 引擎图标（线性统一，2026-08-24 emoji 退役）：claude=Zap / codex=Command / 其它=Bot。 */
function engineIcon(provider: string | null): React.ReactNode {
  const cls = "h-3.5 w-3.5";
  if (provider === "claude") return <Zap aria-hidden className={cls} />;
  if (provider === "codex") return <Command aria-hidden className={cls} />;
  return <Bot aria-hidden className={cls} />;
}

/* ────────────────────── 组件 ────────────────────── */

export function PreSessionPicker({
  variant = "center",
  open,
  machines,
  boundMachineId,
  onCancel,
  onPick,
}: PreSessionPickerProps) {
  /** 第一步选中的机器 id（null = 停在第一步）。 */
  const [machineId, setMachineId] = useState<string | null>(null);
  // 打开时重置回第一步（取消不清父层状态，重开从机器列表重新开始）。
  useEffect(() => {
    if (open) setMachineId(null);
  }, [open]);

  // 绑定模式（2026-10-15-workspace-session-agent-only）：非空 id 即跳过机器步
  // （空串按未绑定——防宿主以空值误入绑定模式）。
  const boundMode = typeof boundMachineId === "string" && boundMachineId.length > 0;

  // ① 仅在线机器（D-107：第一步机器白名单 = status online）。
  const onlineMachines = useMemo(
    () => machines.filter((m) => m.status === "online"),
    [machines],
  );
  // 当前机器：绑定模式=绑定机器原样（含离线/不可见，供专门空态展示）；非绑定
  // =第一步选中（在线白名单内）。
  const machine = useMemo(
    () =>
      boundMode
        ? (machines.find((m) => m.id === boundMachineId) ?? null)
        : (onlineMachines.find((m) => m.id === machineId) ?? null),
    [boundMode, boundMachineId, machines, onlineMachines, machineId],
  );

  // ② 该机器可会话智能体：provider∈SESSION_SUPPORTED_PROVIDERS 且在线。
  const supportedRuntimes = useMemo(
    () =>
      (machine?.runtimes ?? []).filter(
        (r) =>
          r.status === "online" &&
          SESSION_SUPPORTED_PROVIDER_SET.has(r.provider ?? ""),
      ),
    [machine],
  );

  // 绑定模式空态（优先级：机器不可见 > 机器离线 > 在线但无白名单引擎在线）；
  // 不落回全机器列表（选到与工作区无关的机器＝cwd 语义错，需求明确禁选）。
  const boundEmptyText = useMemo(() => {
    if (!boundMode) return null;
    if (!machine) return "工作区绑定的机器当前不可用，请到工作区页面重新绑定机器";
    if (machine.status !== "online")
      return `工作区绑定的机器「${machineLabel(machine)}」当前离线，请启动 daemon 后再新建会话`;
    if (supportedRuntimes.length === 0)
      return "该机器暂无可会话智能体（需要 Claude Code、Codex 或 PI 在线）";
    return null;
  }, [boundMode, machine, supportedRuntimes]);

  if (!open) return null;

  // 容器双形态（task-13）：仅定位/外观类差异——center 原类逐字不动（桌面零回归）；
  // bottomSheet 贴底抽屉（items-end + 满宽 + 顶圆角 + 80dvh 滚动 + 安全区留白），
  // 两步状态机/过滤白名单/受控语义零分叉（同一逻辑路径）。
  const isSheet = variant === "bottomSheet";
  const maskCls = isSheet
    ? "fixed inset-0 z-50 flex items-end bg-brand-950/30 backdrop-blur-[2px]"
    : "fixed inset-0 z-50 flex items-center justify-center bg-brand-950/30 p-4 backdrop-blur-[2px]";
  const cardCls = isSheet
    ? "w-full max-h-[80dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-4 pb-[env(safe-area-inset-bottom)] shadow-lg"
    : "w-full max-w-[360px] rounded-2xl border border-border bg-card p-4 shadow-lg";
  // 移动触摸热区（FR-08 ≥44px 抽检锚）：bottomSheet 下两步选项行补 min-h，外观类不改逻辑。
  const touchCls = isSheet ? "min-h-[44px]" : "";
  // 绑定模式无机器步，标题不再提「运行位置」（机器已由工作区绑定钉定）。
  const dialogTitle = boundMode ? "新建会话 · 选择智能体" : "新建会话 · 选择运行位置";

  // 智能体选项列表（绑定模式与非绑定第二步共用，同一渲染路径）。
  const runtimeList = (
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
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-left text-sm transition-all",
              touchCls,
              isDefault
                ? "border-primary bg-brand-50 text-foreground ring-2 ring-brand-100"
                : "border-border bg-card text-foreground hover:border-brand-300",
            )}
          >
            <span aria-hidden>{engineIcon(r.provider)}</span>
            <span>{runtimeLabel(r)}</span>
            {isDefault && (
              <Tag className="mr-0 rounded-full border-brand-300 bg-brand-100 text-brand-700">
                默认
              </Tag>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      data-testid="pre-session-picker-mask"
      aria-label="新建会话选择浮层"
      className={maskCls}
      onClick={(e) => {
        // 遮罩自身点击才取消（浮层内点击不冒泡取消）。
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        className={cardCls}
      >
        <div className="flex items-start justify-between gap-2">
          {/* 原型 .dlg-head：渐变图标头（2026-08-23-sessions-page-style）。 */}
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-info text-white shadow-primary"
            >
              <Plus className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">
              {dialogTitle}
            </h3>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onCancel}
            className="shrink-0 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {boundMode ? (
          <>
            {/* 绑定模式（2026-10-15-workspace-session-agent-only）：无机器步，
                直接智能体步；pill 标注机器来源=工作区绑定。 */}
            <p className="mt-3 flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-600" />
              智能体 · {machine ? machineLabel(machine) : "工作区绑定机器"}
              （工作区绑定机器）
            </p>
            {boundEmptyText ? (
              <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {boundEmptyText}
              </p>
            ) : (
              runtimeList
            )}
          </>
        ) : !machine ? (
          <>
            {/* ① 机器（仅在线）——原型 .picker #pickStep1/#pickMachines。 */}
            <p className="mt-3 flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-600" />
              ① 机器（仅在线）
            </p>
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
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-left transition-all hover:border-brand-300 hover:shadow-sm",
                      touchCls,
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-success ring-2 ring-success/20"
                      />
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
            <p className="mt-3 flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-600" />
              ② 智能体 · {machineLabel(machine)}（默认 Claude Code）
            </p>
            {supportedRuntimes.length === 0 ? (
              <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                该机器暂无可会话智能体（需要 Claude Code、Codex 或 PI 在线）
              </p>
            ) : (
              runtimeList
            )}
          </>
        )}
      </div>
    </div>
  );
}
