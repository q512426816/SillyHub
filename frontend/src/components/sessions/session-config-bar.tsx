"use client";

/**
 * SessionConfigBar — 样式 B 会话配置控件条（2026-08-14-sessions-portal task-14）。
 *
 * 依据：
 *   - tasks/task-14.md（allowed_paths / implementation / acceptance）
 *   - design.md §2 FR-05/FR-07、§5 Wave3 SessionConfigBar 段、D-004@v2 / D-007@v1 /
 *     D-008@v1、§7.4（switch config：inject 带新配置+prompt，session 维持 active）
 *   - prototype-sessions-portal.html renderSessionPanel / openSwitchDD（样式 B 视觉
 *     与交互语义：四控件行 + 上弹下拉 + 🔒 解锁提示）
 *   - FRONTEND_PAGE_STYLE.md（antd Button/Input + tailwind 语义 token，不硬编码 hex）
 *
 * 行为（FR-05 / D-004@v2）：
 *   - 四控件（机器/智能体/供应商/档案）展示会话当前配置（props 传入
 *     agent_profile_id / llm_provider_id / config_snapshot）。
 *   - 可切：档案、供应商——idle 点开下拉点选即切换（ql-20260817-009：去掉确认
 *     行/输入提示消息步骤；prompt 用默认文案或 props switchPrompt 覆盖）→
 *     injectSession(sessionId, prompt, 带新配置)；供应商含「不指定（本机默认）」
 *     选项 → llm_provider_id: "" 切回本机默认（task-16 契约）。
 *   - 纯展示：机器/智能体——下拉仅展示可选项并整体置灰，跨机器标「二期」、跨引擎标
 *     「需开新会话」（每机每引擎唯一 runtime，无同机同引擎切换目标，D-004@v2）。
 *   - running 全置灰 + 「🔒 本轮完成后解锁切换」；ended/failed 同样不可切（无锁提示）。
 *   - 切换 toast：下一轮生效，历史消息保留当时配置（who 行按轮快照渲染，D-008，
 *     渲染归 turn-timeline.tsx whoLine，本组件不管消息流）。
 *
 * 数据源与 task-12 同：useDaemonMachines（机器/智能体展示）/ listProviders /
 * useMineAgentProfiles。页面组装归 task-10，本组件不感知 SSE/路由。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";

import { useMineAgentProfiles } from "@/lib/agent-profiles";
import { listProviders } from "@/lib/api/llm-providers";
import { useNotify } from "@/lib/errors";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { injectSession, PROVIDER_META } from "@/lib/daemon";
import type {
  AgentSessionConfigSnapshot,
  DaemonMachineRead,
  DaemonRuntimeRead,
  SessionInjectResponse,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/** 供应商下拉「不指定（本机默认）」项的值（→ injectSession llm_provider_id: ""）。 */
export const SWITCH_NO_PROVIDER_VALUE = "";

/** 四控件种类（task-14 provides 契约：machineCtrl/agentCtrl/providerCtrl/profileCtrl）。 */
export type SessionConfigCtrlKind =
  | "machine"
  | "agent"
  | "provider"
  | "profile";

/** 可切换字段（inject options 的键）。 */
export type SessionConfigSwitchField =
  | "agent_profile_id"
  | "llm_provider_id";

/** 切换目标（选中下拉项直接执行，ql-20260817-009 去掉确认行）。 */
interface PendingSwitch {
  field: SessionConfigSwitchField;
  /** 目标值（供应商「不指定」为空串 ""）。 */
  value: string;
  /** 目标展示名（toast / 默认提示语用）。 */
  label: string;
}

export interface SessionConfigBarProps {
  /** 目标会话 id（injectSession 用）。 */
  sessionId: string;
  /** 当前轮运行中 → 全部置灰 + 🔒 解锁提示（FR-05）。 */
  running: boolean;
  /** 会话已结束/失败 → 不可切（只读浏览，无锁提示）。 */
  ended: boolean;
  /** 会话当前档案 id（null=未指定）。 */
  agentProfileId: string | null;
  /** 会话当前供应商 id（null=本机默认）。 */
  llmProviderId: string | null;
  /** 会话当前生效配置摘要（agent_sessions.config_snapshot，机器/智能体展示名来源）。 */
  configSnapshot: AgentSessionConfigSnapshot | null;
  /** 会话 runtime id（定位当前机器，机器/智能体展示下拉用）。 */
  runtimeId?: string | null;
  /** 引擎（claude/codex；缺省回退 config_snapshot.engine）。engine≠claude 锁供应商（D-010）。 */
  engine?: string | null;
  /** 切换轮提示消息默认值（不传用组件内置按目标名生成的文案）。 */
  switchPrompt?: string;
  /** 切换成功回调（父层刷新会话配置）。 */
  onSwitched?: (
    resp: SessionInjectResponse,
    field: SessionConfigSwitchField,
    value: string,
  ) => void;
  /**
   * ql-20260823-008：预会话（provisional）模式——供应商/档案点选**暂存**而非
   * injectSession（会话尚未创建），父层经 onProvisionalSwitch 收值并入首句
   * createSession（llm_provider_id/agent_profile_id）；机器/智能体仍只读展示
   * （D-104 锁定语义与真会话一致）。running/ended 传 false 即可。
   */
  provisional?: boolean;
  onProvisionalSwitch?: (
    field: SessionConfigSwitchField,
    value: string,
  ) => void;
}

/* ────────────────────── 纯辅助（组件外便于单测推理） ────────────────────── */

/** 引擎图标（原型语义：claude ⚡ / codex ◎ / 其它 ✦）。 */
function engineIcon(provider: string | null | undefined): string {
  if (provider === "claude") return "⚡";
  if (provider === "codex") return "◎";
  return "✦";
}

/** 机器展示名（别名优先，FRONTEND_PAGE_STYLE 空值统一 —）。 */
function machineLabel(m: DaemonMachineRead): string {
  return m.display_alias?.trim() || m.hostname;
}

/** 智能体展示名——引擎名优先（ql-20260815-011：name 默认=主机名不得作主标签）。 */
function runtimeLabel(r: DaemonRuntimeRead): string {
  const engine = PROVIDER_META[r.provider ?? ""]?.label ?? r.provider ?? r.id;
  const alias = r.display_alias?.trim();
  return alias ? `${alias} · ${engine}` : engine;
}

/** 切换轮提示消息默认文案（按字段与目标名生成）。 */
export function buildDefaultSwitchPrompt(p: PendingSwitch): string {
  const what = p.field === "llm_provider_id" ? "供应商" : "智能体档案";
  const name = p.value === SWITCH_NO_PROVIDER_VALUE ? "本机默认" : p.label;
  return `已切换${what}为「${name}」，请继续。`;
}

/* ────────────────────── 组件 ────────────────────── */

export function SessionConfigBar({
  sessionId,
  running,
  ended,
  agentProfileId,
  llmProviderId,
  configSnapshot,
  runtimeId,
  engine,
  switchPrompt,
  onSwitched,
  provisional,
  onProvisionalSwitch,
}: SessionConfigBarProps) {
  // 数据源与 task-12 同（机器/智能体展示下拉 + 供应商/档案切换选项）。
  const { items: machines } = useDaemonMachines({});
  const { profiles } = useMineAgentProfiles();
  const notify = useNotify();
  // useNotify 无 info 级方法,引擎切换引导提示经 App 上下文取 message.info
  // (对齐 m/ppm/problem-list 先例,非 antd 裸 import,FR-04 不破)。
  const { message } = App.useApp();
  const providersQ = useQuery({
    queryKey: ["llmProviders", "sessions-config-bar"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers = useMemo(() => providersQ.data ?? [], [providersQ.data]);

  const [openKind, setOpenKind] = useState<SessionConfigCtrlKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const barRef = useRef<HTMLDivElement>(null);

  // 点击控件条外 / Esc 关闭下拉（原型 closeDD 的 document click 语义）。
  useEffect(() => {
    if (!openKind) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenKind(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKind(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKind]);

  const effectiveEngine = engine ?? configSnapshot?.engine ?? null;
  const canSwitch = !running && !ended;
  // D-010：Codex 引擎无会话级供应商 → 控件锁定（下拉不可开）。
  const providerLocked = effectiveEngine != null && effectiveEngine !== "claude";

  // 当前值展示（快照直显免二次解析，Grill C-12；id 兜底防列表缺行）。
  // ql-20260823-008：快照缺失（预会话）时从 runtimeId→机器列表解析（currentMachine
  // 在下方 useMemo，先声明机器名函数不依赖它——直接 machines 查找）。
  const machineHit = runtimeId
    ? (machines.find((m) => m.runtimes?.some((r) => r.id === runtimeId)) ?? null)
    : null;
  const machineNameText =
    configSnapshot?.machine_name ?? (machineHit ? machineLabel(machineHit) : "—");
  // ql-20260815-011：智能体=引擎维度（FR-01）——引擎名优先（后端快照
  // agent_name 存的 runtime.name 默认=主机名，仅作引擎缺失时的兜底）。
  const agentName =
    PROVIDER_META[effectiveEngine ?? ""]?.label ??
    configSnapshot?.agent_name ??
    "—";
  const profileLabel = agentProfileId
    ? profiles.find((p) => p.id === agentProfileId)?.name ??
      configSnapshot?.profile_name ??
      agentProfileId
    : "未指定";
  const providerLabel = llmProviderId
    ? providers.find((p) => p.id === llmProviderId)?.name ??
      configSnapshot?.provider_name ??
      llmProviderId
    : "本机默认";

  // 当前会话所属机器（runtime_id 钉定，快照 machine_name 兜底）。
  const currentMachine = useMemo(
    () =>
      machines.find((m) => m.runtimes?.some((r) => r.id === runtimeId)) ??
      machines.find((m) => machineLabel(m) === configSnapshot?.machine_name) ??
      null,
    [machines, runtimeId, configSnapshot?.machine_name],
  );

  /** ql-20260817-010：点选即**静默**切换——prompt 发空串（后端静默切换契约：
   * 有切换字段允许空 prompt；daemon 收到空 prompt 只 reload 配置不喂消息，
   * 切换轮无用户消息/模型回应）。switchPrompt 传入时仍作为切换轮消息发出。 */
  const executeSwitch = async (p: PendingSwitch) => {
    if (submitting) return;
    // ql-20260823-008：预会话暂存——不 inject（无会话），值随首句 createSession 生效。
    if (provisional) {
      setOpenKind(null);
      const what = p.field === "llm_provider_id" ? "供应商" : "档案";
      const name =
        p.field === "llm_provider_id" && p.value === SWITCH_NO_PROVIDER_VALUE
          ? "本机默认"
          : p.label;
      notify.success(`已选择${what} → ${name}（第一句话发送创建会话时生效）`);
      onProvisionalSwitch?.(p.field, p.value);
      return;
    }
    const prompt = (switchPrompt ?? "").trim();
    setSubmitting(true);
    setOpenKind(null);
    try {
      const resp = await injectSession(sessionId, prompt, { [p.field]: p.value });
      const what = p.field === "llm_provider_id" ? "供应商" : "档案";
      const name =
        p.field === "llm_provider_id" && p.value === SWITCH_NO_PROVIDER_VALUE
          ? "本机默认"
          : p.label;
      notify.success(`已切换${what} → ${name}（下一轮生效，历史消息保留当时配置）`);
      onSwitched?.(resp, p.field, p.value);
    } catch (err) {
      notify.error(err, "切换失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const ctrlDisabled: Record<SessionConfigCtrlKind, boolean> = {
    machine: !canSwitch,
    agent: !canSwitch,
    provider: !canSwitch || providerLocked,
    profile: !canSwitch,
  };

  const toggleCtrl = (kind: SessionConfigCtrlKind) => {
    if (ctrlDisabled[kind]) return;
    setOpenKind((prev) => (prev === kind ? null : kind));
  };

  // ql-20260815-010：下拉浮层锚定各自控件——每个控件包一层 relative，
  // ConfigDropdown 的 absolute bottom-full left-0 相对控件（此前锚到整条
  // barRef 导致所有下拉都渲染在最左侧）。
  const ctrlButton = (
    kind: SessionConfigCtrlKind,
    icon: string,
    value: string,
    title: string,
    dropdown?: React.ReactNode,
  ) => (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={ctrlDisabled[kind]}
        title={title}
        aria-label={`配置-${labelOfCtrl(kind)} ${value}`}
        onClick={() => toggleCtrl(kind)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
          ctrlDisabled[kind]
            ? "cursor-not-allowed text-muted-foreground/60"
            : "cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground",
          openKind === kind && "bg-muted text-primary",
        )}
      >
        <span aria-hidden>{icon}</span>
        <span className="max-w-[160px] truncate">{value}</span>
        <span aria-hidden className="text-muted-foreground/60">
          ▾
        </span>
      </button>
      {openKind === kind && dropdown ? dropdown : null}
    </span>
  );

  return (
    <div ref={barRef} className="relative mt-1.5" aria-label="会话配置控件条">
      <div className="flex flex-wrap items-center gap-0.5">
        {ctrlButton(
          "machine",
          "🖥",
          machineNameText,
          "守护进程（换机器需开新会话）",
          <ConfigDropdown
            testId="config-dd-machine"
            title="守护进程 · 换机器需开新会话（跨机器二期）"
          >
            {machines.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                暂无守护进程
              </p>
            ) : (
              machines.map((m) => {
                const isCurrent = m.id === currentMachine?.id;
                const online = m.status === "online";
                return (
                  <DisplayItem
                    key={m.id}
                    icon={<StatusDot online={online} />}
                    label={machineLabel(m)}
                    current={isCurrent}
                    sub={
                      isCurrent
                        ? undefined
                        : online
                          ? "跨机器 · 二期"
                          : "离线"
                    }
                  />
                );
              })
            )}
          </ConfigDropdown>,
        )}
        {ctrlButton(
          "agent",
          engineIcon(effectiveEngine),
          agentName,
          "智能体（换引擎需开新会话）",
          <ConfigDropdown
            testId="config-dd-agent"
            title="智能体 · 当前机器引擎（换引擎需开新会话）"
          >
            {/* ql-20260817-006：只列当前机器的引擎（不列其它机器）——当前=✓；
                其它在线引擎可点（引擎不支持会话内热切 → 点击引导开新会话）；
                离线引擎置灰标注。 */}
            {(currentMachine?.runtimes ?? []).map((r) => {
              const isCurrent = r.id === runtimeId;
              const online = r.status === "online";
              return (
                <DisplayItem
                  key={r.id}
                  icon={<span aria-hidden>{engineIcon(r.provider)}</span>}
                  label={runtimeLabel(r)}
                  current={isCurrent}
                  sub={
                    isCurrent
                      ? undefined
                      : online
                        ? "换引擎需开新会话"
                        : "离线"
                  }
                  disabled={!online}
                  onClick={
                    isCurrent || !online
                      ? undefined
                      : () => {
                          setOpenKind(null);
                          message.info(
                            `当前会话不支持切换引擎，请在「新建会话」中选择 ${runtimeLabel(r)}`,
                          );
                        }
                  }
                />
              );
            })}
            {(currentMachine?.runtimes ?? []).length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                未找到当前智能体所属机器
              </p>
            )}
          </ConfigDropdown>,
        )}
        {ctrlButton(
          "provider",
          "☁",
          providerLabel,
          providerLocked
            ? "Codex 引擎暂不支持会话级供应商"
            : "供应商（不选=本机默认配置）",
          <ConfigDropdown
            testId="config-dd-provider"
            title="切换供应商 · 只影响本会话"
          >
            <SwitchItem
              icon="☁"
              label="不指定（本机默认）"
              current={llmProviderId == null}
              onClick={() =>
                executeSwitch({
                  field: "llm_provider_id",
                  value: SWITCH_NO_PROVIDER_VALUE,
                  label: "不指定（本机默认）",
                })
              }
            />
            {providers.map((p) => (
              <SwitchItem
                key={p.id}
                icon="☁"
                label={p.name}
                sub={p.model ?? undefined}
                current={p.id === llmProviderId}
                onClick={() =>
                  executeSwitch({
                    field: "llm_provider_id",
                    value: p.id,
                    label: p.name,
                  })
                }
              />
            ))}
            {providers.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                暂无自定义供应商
              </p>
            )}
          </ConfigDropdown>,
        )}
        {ctrlButton(
          "profile",
          "📋",
          profileLabel,
          "智能体档案",
          <ConfigDropdown
            testId="config-dd-profile"
            title="切换档案 · 只影响本会话"
          >
            {/* ql-20260818-004：取消档案与供应商「不指定」对称——空串语义回无人格。 */}
            <SwitchItem
              icon="📋"
              label="不指定（无人格）"
              current={agentProfileId == null}
              onClick={() =>
                executeSwitch({
                  field: "agent_profile_id",
                  value: "",
                  label: "不指定",
                })
              }
            />
            {profiles.map((p) => (
              <SwitchItem
                key={p.id}
                icon="📋"
                // D-013：不做引擎过滤；Codex 下仅标注人格不注入（原 D-003）。
                label={
                  effectiveEngine === "codex"
                    ? `${p.name}（人格暂不支持）`
                    : p.name
                }
                current={p.id === agentProfileId}
                onClick={() =>
                  executeSwitch({
                    field: "agent_profile_id",
                    value: p.id,
                    label: p.name,
                  })
                }
              />
            ))}
            {profiles.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                暂无可选档案
              </p>
            )}
          </ConfigDropdown>,
        )}
        <span className="flex-1" />
        {running && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-warning">
            🔒 本轮完成后解锁切换
          </span>
        )}
      </div>
    </div>
  );
}

/* ────────────────────── 下拉浮层与选项（原型 .dd / .dd-item） ────────────────────── */

function labelOfCtrl(kind: SessionConfigCtrlKind): string {
  return kind === "machine"
    ? "机器"
    : kind === "agent"
      ? "智能体"
      : kind === "provider"
        ? "供应商"
        : "档案";
}

function ConfigDropdown({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="absolute bottom-full left-0 z-30 mb-1.5 w-max min-w-[280px] whitespace-nowrap rounded-md border border-border bg-card p-1.5 shadow-lg"
    >
      <div className="border-b border-border px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** 纯展示项（机器/智能体下拉，D-004@v2：无可选目标，整体置灰仅展示）。 */
function DisplayItem({
  icon,
  label,
  current,
  sub,
  disabled = true,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  current?: boolean;
  sub?: string;
  /** ql-20260817-006：默认展示态置灰；传 false + onClick 变可点（在线引擎引导开新会话）。 */
  disabled?: boolean;
  onClick?: () => void;
}) {
  const clickable = !disabled && onClick != null && !current;
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-disabled={clickable ? undefined : "true"}
      onClick={clickable ? onClick : undefined}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 text-xs",
        clickable && "cursor-pointer hover:bg-muted",
        !clickable && "cursor-not-allowed",
        current
          ? "bg-primary/10 font-medium text-primary"
          : "text-foreground/80",
        disabled && !current && "opacity-60",
      )}
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0 break-words">{label}</span>
      {current ? (
        <span className="ml-auto shrink-0 text-primary">✓ 当前</span>
      ) : (
        sub && (
          <span className="ml-auto shrink-0 text-muted-foreground">{sub}</span>
        )
      )}
    </div>
  );
}

/** 可切换选项（供应商/档案下拉）。 */
function SwitchItem({
  icon,
  label,
  sub,
  current,
  onClick,
}: {
  icon: string;
  label: string;
  sub?: string;
  current?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`选择 ${label}`}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
        current ? "bg-primary/10 font-medium text-primary" : "text-foreground",
      )}
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0 break-words">{label}</span>
      {current && <span className="ml-auto shrink-0 text-primary">✓</span>}
      {!current && sub && (
        <span className="ml-auto shrink-0 text-muted-foreground">{sub}</span>
      )}
    </button>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        online ? "bg-success" : "bg-muted-foreground/50",
      )}
    />
  );
}
