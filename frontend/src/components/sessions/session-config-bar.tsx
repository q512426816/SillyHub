"use client";

/**
 * SessionConfigBar — 样式 B 会话配置控件条（2026-08-14-sessions-portal task-14）。
 *
 * 依据：
 *   - tasks/task-14.md（allowed_paths / implementation / acceptance）
 *   - design.md §2 FR-05/FR-07、§5 Wave3 SessionConfigBar 段、D-004@v2 / D-007@v1 /
 *     D-008@v1、§7.4（switch config：inject 带新配置+prompt，session 维持 active）
 *   - prototype-sessions-portal.html renderSessionPanel / openSwitchDD（样式 B 视觉
 *     与交互语义：配置控件行 + 上弹下拉 + 🔒 解锁提示）
 *   - FRONTEND_PAGE_STYLE.md（antd Button/Input + tailwind 语义 token，不硬编码 hex）
 *
 * 行为（FR-05 / D-004@v2）：
 *   - 两控件（供应商/档案）展示会话当前配置（props 传入
 *     agent_profile_id / llm_provider_id / config_snapshot）。
 *   - 可切：档案、供应商——idle 点开下拉点选即切换（ql-20260817-009：去掉确认
 *     行/输入提示消息步骤；prompt 用默认文案或 props switchPrompt 覆盖）→
 *     injectSession(sessionId, prompt, 带新配置)；供应商含「不指定（本机默认）」
 *     选项 → llm_provider_id: "" 切回本机默认（task-16 契约）。
 *   - running 全置灰 + 「🔒 本轮完成后解锁切换」；ended/failed 同样不可切（无锁提示）。
 *   - 切换 toast：下一轮生效，历史消息保留当时配置（who 行按轮快照渲染，D-008，
 *     渲染归 turn-timeline.tsx whoLine，本组件不管消息流）。
 *
 * 数据源：listProviders / useMineAgentProfiles。页面组装归 task-10，本组件不感知
 * SSE/路由。
 *
 * task-10（2026-08-28-daemon-agent-share / FR-05 / D-004@v2）：档案下拉共享智能体
 * 带「共享」标识（对照 useActiveSharedAgents 生效列表）。
 * task-13（契约修复）：useActiveSharedAgents 取数收敛到 lib/daemon.ts 的
 * fetchSharedAgentsActive（废 apiFetch 直调，行为等价）。
 * task-09（2026-08-29-usage-by-provider-model / FR-03-1 / D-004@v1）：配置条
 * 四块→两块——移除机器/智能体纯展示块（换机器/换引擎本就需开新会话，块内无任何
 * 可执行目标，信息量低），useDaemonMachines 依赖随之移除；供应商/档案切换、
 * provisional 暂存、Codex 锁定（D-010）逻辑不变。
 * task-10（同变更 / FR-03-2/3/5 / D-002@v1）：供应商 Ctrl 内嵌模型子下拉
 * （级联，原型 .cascade 两 select 并排紧凑小号）——候选 = provider.model /
 * default_fallback_model / model_role_mappings 各角色 model 去重保序 + 首项
 * 「默认（跟随供应商配置）」；切换 injectSession 同请求带 llm_provider_id +
 * model（切供应商级联重置模型）；provisional 模型暂存走专用回调
 * onProvisionalModelSwitch（session-panel 已接 preModelId 暂存随首句携带）；Codex 锁定/「不指定」
 * 两态隐藏子下拉。候选不做上游 /v1/models 实时拉取（D-002）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "antd";
import { ChevronDown, Cloud, Lock, User } from "lucide-react";

import { ApiError } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { useMineAgentProfiles } from "@/lib/agent-profiles";
import { listProviders } from "@/lib/api/llm-providers";
import { useNotify } from "@/lib/errors";
import { fetchSharedAgentsActive, injectSession } from "@/lib/daemon";
import type {
  AgentSessionConfigSnapshot,
  SessionInjectOptions,
  SessionInjectResponse,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/** 供应商下拉「不指定（本机默认）」项的值（→ injectSession llm_provider_id: ""）。 */
export const SWITCH_NO_PROVIDER_VALUE = "";

/**
 * 模型子下拉「默认（跟随供应商配置）」项的值（task-10 / FR-03-2，→
 * injectSession model: ""——与 llm_provider_id 空串语义同构：空串=切回默认，
 * undefined=不切换）。
 */
export const SWITCH_MODEL_DEFAULT_VALUE = "";

/* ────────────────────── task-10：平台共享智能体 active 数据 ────────────────────── */

/** 平台共享智能体 active 生效摘要 DTO（task-08 生成 api-types 单一来源）。 */
export type SharedAgentActiveView = components["schemas"]["SharedAgentActiveView"];

/**
 * 平台共享智能体生效列表（task-10 / FR-05）：取
 * GET /api/daemon/shared-agents/active（task-13 起经 lib/daemon.ts 的
 * fetchSharedAgentsActive 封装收敛取数——task-09 封装落地前的 apiFetch 直调
 * 已废，端点与响应结构同一，行为等价）。
 *
 * 失败降级 []（徽标数据缺失不阻塞会话面板）；30s staleTime（低频管理数据，
 * 对齐 listProviders 节奏）。消费端：本组件档案下拉共享标识 + session-panel
 * 会话头「平台共享」徽标。
 */
export function useActiveSharedAgents() {
  const q = useQuery<SharedAgentActiveView[], ApiError>({
    queryKey: ["daemonSharedAgents", "active"],
    queryFn: () =>
      fetchSharedAgentsActive().catch(() => [] as SharedAgentActiveView[]),
    staleTime: 30_000,
  });
  return {
    activeSharedAgents: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
  };
}

/** 配置控件种类（task-09 起两控件：providerCtrl/profileCtrl）。 */
export type SessionConfigCtrlKind = "provider" | "profile";

/** 可切换字段（inject options 的键；task-10 增 model——会话级模型覆盖）。 */
export type SessionConfigSwitchField =
  | "agent_profile_id"
  | "llm_provider_id"
  | "model";

/** 切换目标（选中下拉项直接执行，ql-20260817-009 去掉确认行）。 */
interface PendingSwitch {
  field: SessionConfigSwitchField;
  /** 目标值（供应商/模型「默认」为空串 ""）。 */
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
  /** 会话当前生效配置摘要（agent_sessions.config_snapshot，engine 与档案/供应商名兜底来源）。 */
  configSnapshot: AgentSessionConfigSnapshot | null;
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
   * createSession（llm_provider_id/agent_profile_id）。running/ended 传 false 即可。
   */
  provisional?: boolean;
  onProvisionalSwitch?: (
    field: Exclude<SessionConfigSwitchField, "model">,
    value: string,
  ) => void;
  /**
   * task-10（FR-03-2）：provisional 模式模型暂存专用回调——模型值不经
   * onProvisionalSwitch 发（其消费端 session-panel 按 llm_provider_id/else
   * 二分收值，混发 "model" 会误写档案暂存）；切供应商级联重置时同样发空串。
   * 父层接线（并入首句 createSession）归后续任务，未传时组件内仍暂存显示。
   */
  onProvisionalModelSwitch?: (model: string) => void;
}

/* ────────────────────── 纯辅助（组件外便于单测推理） ────────────────────── */

/** 切换目标中文名（toast / 默认提示语用；task-10 增「模型」）。 */
function switchFieldWhat(field: SessionConfigSwitchField): string {
  return field === "llm_provider_id"
    ? "供应商"
    : field === "model"
      ? "模型"
      : "档案";
}

/** 切换轮提示消息默认文案（按字段与目标名生成）。 */
export function buildDefaultSwitchPrompt(p: PendingSwitch): string {
  const what = p.field === "llm_provider_id" ? "供应商" : switchFieldWhat(p.field);
  const name =
    p.field === "llm_provider_id" && p.value === SWITCH_NO_PROVIDER_VALUE
      ? "本机默认"
      : p.field === "model" && p.value === SWITCH_MODEL_DEFAULT_VALUE
        ? "默认"
        : p.label;
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
  engine,
  switchPrompt,
  onSwitched,
  provisional,
  onProvisionalSwitch,
  onProvisionalModelSwitch,
}: SessionConfigBarProps) {
  // task-10：档案下拉共享智能体标识（对照 active 生效列表）。
  const { activeSharedAgents } = useActiveSharedAgents();
  const sharedProfileIds = useMemo(
    () => new Set(activeSharedAgents.map((a) => a.agent_profile_id)),
    [activeSharedAgents],
  );
  const { profiles } = useMineAgentProfiles();
  const notify = useNotify();
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
  // D-010：Codex 引擎无会话级供应商 → 控件锁定（下拉不可开；task-10 起模型
  // 子下拉同锁——直接不渲染）。
  const providerLocked = effectiveEngine != null && effectiveEngine !== "claude";

  // ── task-10（FR-03-2/5 / D-002@v1）：供应商+模型级联 ──────────────────────

  /** 当前选中供应商行（「不指定」/列表未含该 id → null，模型子下拉随之隐藏）。 */
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === llmProviderId) ?? null,
    [providers, llmProviderId],
  );

  /**
   * 模型候选 = provider.model → default_fallback_model → model_role_mappings
   * 各角色 model **去重保序**（空串/缺键过滤；不做上游 /v1/models 实时拉取，
   * D-002）。首项「默认（跟随供应商配置）」在渲染处固定，不进候选集。
   */
  const modelCandidates = useMemo(() => {
    if (!selectedProvider) return [] as string[];
    const raw: (string | null | undefined)[] = [
      selectedProvider.model,
      selectedProvider.default_fallback_model,
      ...Object.values(selectedProvider.model_role_mappings ?? {}).map(
        (m) => m?.model,
      ),
    ];
    const seen = new Set<string>();
    const models: string[] = [];
    for (const m of raw) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      models.push(m);
    }
    return models;
  }, [selectedProvider]);

  /**
   * provisional 模式模型暂存（组件内显示用；父层经 onProvisionalModelSwitch
   * 收值，session-panel 已接 preModelId）。非 provisional 当前值 = 会话快照 config_snapshot.model
   * （快照直显免二次解析，Grill C-12；空=「默认」）。
   */
  const [provisionalModel, setProvisionalModel] = useState("");
  const currentModel = provisional
    ? provisionalModel
    : (configSnapshot?.model ?? "");

  /**
   * 快照模型可能已不在候选集（供应商高级设置后续改过）→ 追加到尾部兜底，
   * 保证 select 有对应 option 可显示、不丢当前值。
   */
  const modelOptions = useMemo(
    () =>
      currentModel && !modelCandidates.includes(currentModel)
        ? [...modelCandidates, currentModel]
        : modelCandidates,
    [modelCandidates, currentModel],
  );

  // 当前值展示（快照直显免二次解析，Grill C-12；id 兜底防列表缺行）。
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

  /** ql-20260817-010：点选即**静默**切换——prompt 发空串（后端静默切换契约：
   * 有切换字段允许空 prompt；daemon 收到空 prompt 只 reload 配置不喂消息，
   * 切换轮无用户消息/模型回应）。switchPrompt 传入时仍作为切换轮消息发出。 */
  const executeSwitch = async (p: PendingSwitch) => {
    if (submitting) return;
    const what = switchFieldWhat(p.field);
    const name =
      p.field === "llm_provider_id" && p.value === SWITCH_NO_PROVIDER_VALUE
        ? "本机默认"
        : p.label;
    // ql-20260823-008：预会话暂存——不 inject（无会话），值随首句 createSession 生效。
    if (provisional) {
      setOpenKind(null);
      notify.success(`已选择${what} → ${name}（第一句话发送创建会话时生效）`);
      // task-10：模型暂存走专用回调（onProvisionalSwitch 消费端按
      // llm_provider_id/else 二分收值，混发 "model" 会误写档案暂存）。
      if (p.field === "model") {
        setProvisionalModel(p.value);
        onProvisionalModelSwitch?.(p.value);
        return;
      }
      // task-10：切供应商级联重置模型暂存（候选随供应商变，旧模型对新供应商
      // 无意义；「不指定」下 model 非空更会被后端 422——task-11 守卫）。
      if (p.field === "llm_provider_id") {
        setProvisionalModel(SWITCH_MODEL_DEFAULT_VALUE);
        onProvisionalModelSwitch?.(SWITCH_MODEL_DEFAULT_VALUE);
      }
      onProvisionalSwitch?.(p.field, p.value);
      return;
    }
    const prompt = (switchPrompt ?? "").trim();
    setSubmitting(true);
    setOpenKind(null);
    try {
      // task-10（FR-03-3）：供应商与模型同请求——切供应商级联重置 model=""
      // （语义见上）；切模型补带当前 llm_provider_id（model 非空必须挂供应商，
      // 后端 422 守卫）。档案切换不带伴生键，payload 零变化。
      const companion: Partial<SessionInjectOptions> =
        p.field === "llm_provider_id"
          ? { model: SWITCH_MODEL_DEFAULT_VALUE }
          : p.field === "model"
            ? { llm_provider_id: llmProviderId ?? SWITCH_NO_PROVIDER_VALUE }
            : {};
      const resp = await injectSession(sessionId, prompt, {
        ...companion,
        [p.field]: p.value,
      });
      notify.success(`已切换${what} → ${name}（下一轮生效，历史消息保留当时配置）`);
      onSwitched?.(resp, p.field, p.value);
    } catch (err) {
      notify.error(err, "切换失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const ctrlDisabled: Record<SessionConfigCtrlKind, boolean> = {
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
    icon: React.ReactNode,
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
        <span aria-hidden className="shrink-0 text-brand-600">
          {icon}
        </span>
        <span className="max-w-[160px] truncate">{value}</span>
        <ChevronDown
          aria-hidden
          className="h-3 w-3 shrink-0 text-muted-foreground/60"
        />
      </button>
      {openKind === kind && dropdown ? dropdown : null}
    </span>
  );

  return (
      <div ref={barRef} className="relative mt-1.5" aria-label="会话配置控件条">
      <div className="flex flex-wrap items-center gap-0.5">
        {/* task-10（FR-03-2 / 原型 .cascade）：供应商+模型级联——两「select」并排
            在供应商 Ctrl 内（供应商=既有按钮+上弹下拉，模型=紧凑原生 select）。
            模型子下拉仅选中具体供应商且非 Codex 锁定时渲染：「不指定（本机默认）」
            / providerLocked 两态隐藏；running/ended 同供应商控件置灰。 */}
        <span className="inline-flex items-center gap-0.5">
          {ctrlButton(
            "provider",
            <Cloud aria-hidden className="h-3.5 w-3.5" />,
            providerLabel,
            providerLocked
              ? "Codex 引擎暂不支持会话级供应商"
              : "供应商（不选=本机默认配置）",
            <ConfigDropdown
              testId="config-dd-provider"
              title="切换供应商 · 只影响本会话"
            >
              <SwitchItem
                icon={<Cloud aria-hidden className="h-3 w-3" />}
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
                  icon={<Cloud aria-hidden className="h-3 w-3" />}
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
          {selectedProvider && !providerLocked && (
            <select
              aria-label="配置-模型"
              data-testid="config-model-select"
              value={currentModel}
              disabled={!canSwitch}
              title="模型（默认=跟随供应商配置）"
              onChange={(e) => {
                const v = e.target.value;
                executeSwitch({ field: "model", value: v, label: v || "默认" });
              }}
              className={cn(
                "h-6 max-w-[150px] cursor-pointer truncate rounded-md border border-border bg-card px-1 text-xs transition-colors hover:bg-muted",
                !canSwitch &&
                  "cursor-not-allowed text-muted-foreground/60 hover:bg-card",
              )}
            >
              <option value={SWITCH_MODEL_DEFAULT_VALUE}>
                默认（跟随供应商配置）
              </option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </span>
        {ctrlButton(
          "profile",
          <User aria-hidden className="h-3.5 w-3.5" />,
          profileLabel,
          "智能体档案",
          <ConfigDropdown
            testId="config-dd-profile"
            title="切换档案 · 只影响本会话"
          >
            {/* ql-20260818-004：取消档案与供应商「不指定」对称——空串语义回无人格。 */}
            <SwitchItem
              icon={<User aria-hidden className="h-3 w-3" />}
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
                icon={<User aria-hidden className="h-3 w-3" />}
                // D-013：不做引擎过滤；Codex 下仅标注人格不注入（原 D-003）。
                label={
                  effectiveEngine === "codex"
                    ? `${p.name}（人格暂不支持）`
                    : p.name
                }
                // task-10：共享智能体档案带「共享」标识（对照 active 生效列表）。
                tag={
                  sharedProfileIds.has(p.id) ? (
                    <SharedTag title="平台共享智能体——读平台源码不受限，写操作限制在共享输出目录" />
                  ) : undefined
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
            <Lock aria-hidden className="h-3 w-3" />
            本轮完成后解锁切换
          </span>
        )}
      </div>
    </div>
  );
}

/* ────────────────────── 下拉浮层与选项（原型 .dd / .dd-item） ────────────────────── */

function labelOfCtrl(kind: SessionConfigCtrlKind): string {
  return kind === "provider" ? "供应商" : "档案";
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

/**
 * 共享徽标（task-10 / FR-05 / D-004@v2）：档案候选中平台共享智能体条目的
 * 「共享」Tag。品牌色阶（FRONTEND_PAGE_STYLE §0.5），样式对齐
 * pre-session-picker「默认」Tag 先例（机器共享场景 lender 形态随机器块移除）。
 */
function SharedTag({ title }: { title?: string }) {
  return (
    <Tag
      className="mr-0 shrink-0 rounded-full border-brand-300 bg-brand-100 text-brand-700"
      title={title ?? "共享给我的"}
    >
      共享
    </Tag>
  );
}

/** 可切换选项（供应商/档案下拉）。 */
function SwitchItem({
  icon,
  label,
  tag,
  sub,
  current,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** task-10：共享智能体档案徽标（紧跟 label 渲染）。 */
  tag?: React.ReactNode;
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
      {tag}
      {current && <span className="ml-auto shrink-0 text-primary">✓</span>}
      {!current && sub && (
        <span className="ml-auto shrink-0 text-muted-foreground">{sub}</span>
      )}
    </button>
  );
}
