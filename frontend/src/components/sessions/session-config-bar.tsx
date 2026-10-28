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
 *   - ql-20260917-008：running 不再置灰——四控件（供应商/模型/思考级别/档案）
 *     运行中可点，请求即受理：切换维度经忙轮排队/覆盖合并，**本轮结束后生效**
 *     （提示行「运行中切换将于本轮结束后生效」替代原 🔒 锁提示）；连续切换
 *     覆盖式（最后一次为准，后端纯切换条目逐字段合并）。ended/failed 仍不可切。
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
 * 2026-09-14-session-thinking-level task-06（FR-06 / Grill P0-2 / P2-11）：模型
 * 下拉邻位加思考档位下拉——预会话态静态七档镜像（onProvisionalThinkingLevelSwitch
 * 暂存，模型变级联重置清空）；会话态经 thinkingLevel 可选 prop 挂动态档位切换控件
 * （GET 动态列表+current 现值+切换 POST+成功 invalidate 刷新，R-04）。两态均
 * caps.thinking_level 门控（cursor/未知引擎不渲染）。
 * ql-20260922-001：思考档位控件 antd Dropdown 化——原生 select 换胶囊按钮触发
 * （类名同 ctrlButton，与供应商/档案按钮风格统一）+ antd 菜单上弹（theme-toggle
 * 先例 selectable 高亮当前档），行为契约（七档镜像/动态档/禁用态 title）不变。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dropdown, Tag, Tooltip, type MenuProps } from "antd";
import { Brain, ChevronDown, Cloud, GitBranch, Settings2, User } from "lucide-react";

import { ApiError } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { useMineAgentProfiles } from "@/lib/agent-profiles";
import { listProviders, noProviderLabel } from "@/lib/api/llm-providers";
import { useNotify } from "@/lib/errors";
import {
  fetchSessionGitStatus,
  fetchSharedAgentsActive,
  getSessionThinkingLevels,
  injectSession,
  setSessionThinkingLevel,
} from "@/lib/daemon";
import type {
  AgentSessionConfigSnapshot,
  SessionGitStatus,
  SessionInjectOptions,
  SessionInjectResponse,
} from "@/lib/daemon";
import { getProviderCaps, PROVIDER_SWITCH_ENGINES } from "@/lib/provider-caps";
import { cn } from "@/lib/utils";

/** 供应商下拉「不指定（本机默认）」项的值（→ injectSession llm_provider_id: ""）。 */
export const SWITCH_NO_PROVIDER_VALUE = "";

/**
 * 模型子下拉「默认（跟随供应商配置）」项的值（task-10 / FR-03-2，→
 * injectSession model: ""——与 llm_provider_id 空串语义同构：空串=切回默认，
 * undefined=不切换）。
 */
export const SWITCH_MODEL_DEFAULT_VALUE = "";

/* ────────── 2026-09-14-session-thinking-level task-06：思考档位（FR-06 / Grill P0-2 / P2-11）────────── */

/**
 * 预会话静态七档镜像（THINKING_LEVELS 前端 mirror，Grill P0-2 定案：无会话 id
 * 可查动态档，非 per-model；引擎不支持的档由 daemon mapPlatformLevelToEngine
 * 降级规则兜底）。
 *
 * ⚠️ 单源互指：唯一维护源 = ``sillyhub-daemon/src/interactive/thinking-levels.ts``
 * 的 ``THINKING_LEVELS``（backend 校验词表 VALID_THINKING_LEVELS 为同源镜像）；
 * 本常量为手工镜像——三端档位集合与顺序（off→max）必须逐项一致，改档位两侧
 * 同步（daemon 单源改后此处与 backend 镜像一并刷新）。
 */
export const THINKING_LEVEL_OPTIONS: readonly { value: string; label: string }[] =
  [
    { value: "off", label: "默认" },
    { value: "minimal", label: "极低" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
    { value: "xhigh", label: "超高" },
    { value: "max", label: "最高" },
  ];

/** 平台默认档（off）——预会话级联重置/未选择态的归位值。 */
export const THINKING_LEVEL_OFF_VALUE = "off";

/**
 * off 档（显示「默认」）跨引擎语义差异 tooltip（P2-11，口径同 daemon
 * thinking-levels.ts 文件头「off 语义差异」注释，改文案两侧同步）：claude/codex
 * 的 off=不设档位=引擎默认（思考通常开，**并非关闭**）；pi 的 off=真关思考。
 */
export const THINKING_LEVEL_OFF_TOOLTIP =
  "默认档跨引擎语义不同：claude/codex=不设置档位，使用引擎默认（思考通常开启）；pi=真正关闭思考";

/** 档位值 → 中文名（七档镜像内查表；动态档/未知值兜底显原值，不编造）。 */
export function thinkingLevelLabel(level: string): string {
  return (
    THINKING_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level
  );
}

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

/**
 * 暂存可暂存字段（2026-10-25-session-config-deferred-switch）：四控件统一
 * 「点选暂存、随下一条消息生效」——inject options 三键 + 思考级别（发送时经
 * thinking-level 端点生效）。
 */
export type SessionConfigStagedField =
  | SessionConfigSwitchField
  | "thinking_level";

/**
 * 受控暂存值（面板持有；键存在 = 该字段有暂存）。值语义同 inject options：
 * llm_provider_id ""=本机默认、model ""=跟随供应商配置、agent_profile_id
 * ""=无人格；thinking_level 为七档词表值。
 */
export interface SessionConfigStaged {
  agent_profile_id?: string;
  llm_provider_id?: string;
  model?: string;
  thinking_level?: string;
}

/** 暂存上抛 patch（组件点选 → 面板合并；cancel=true 表示取消该字段暂存）。 */
export interface SessionConfigStagedPatch {
  field: SessionConfigStagedField;
  /** 目标值（语义同 SessionConfigStaged 各键）。 */
  value: string;
  /** 目标展示名（toast 用）。 */
  label: string;
  /** 选回当前生效值 → 取消该字段暂存（组件持当前值判定，面板纯执行）。 */
  cancel?: boolean;
}

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
  /**
   * 引擎（claude/codex/pi/cursor；缺省回退 config_snapshot.engine）。引擎不在
   * PROVIDER_SWITCH_ENGINES 白名单（cursor/未知）时锁供应商（原 D-010
   * claude-only 口径，2026-09-11-session-provider-switch-codex-pi task-05
   * 白名单化）。
   */
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
  // 2026-10-22-session-composer-slim FR-02：原 autoResume 开关从配置条移除，
  // 入口迁至输入区 + 菜单（SessionInputBar.autoResume）。
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
  /**
   * 2026-09-14-session-thinking-level task-06（FR-06）：provisional 模式思考档位
   * 暂存专用回调（照 onProvisionalModelSwitch 形态——值不经 onProvisionalSwitch
   * 发）。上抛值语义：七档词表值=已选档（含显式选「默认」=off，随首句上送）；
   * 空串 ""=级联重置清空选择（首句 create 不带 thinking_level，跟随引擎默认）。
   * 父层接线（preThinkingLevel 暂存并入首句 createSession）归 session-panel。
   */
  onProvisionalThinkingLevelSwitch?: (level: string) => void;
  /**
   * 2026-09-14-session-thinking-level task-06（FR-06 / R-04）：会话态档位切换
   * 控件（不传不渲染，预会话渲染点零回归）。传入后本组件渲染档位下拉：GET
   * 动态档位列表 + current 现值直显，点选即 POST setSessionThinkingLevel——
   * 成功通知 + invalidate 档位查询刷新现值（pi thinking_level_change 事件不
   * 透传不消费，现值靠查询刷新，design 生命周期契约）；失败 notify error 带
   * 响应 error 原文（如「daemon 未支持思考级别，请升级 daemon」）。引擎门控
   * caps.thinking_level（cursor/未知引擎不渲染）。
   */
  thinkingLevel?: {
    /** turn running → 禁用（档位切换仅空闲，D-002；父层 running 派生）。 */
    disabled?: boolean;
  };
  /**
   * ql-20260904-010：外部请求打开供应商下拉的信号（每次递增触发一次）。运行失败
   * 卡「切换供应商」定位到会话底部配置条时由父级递增；锁定/不可切
   * （running/ended/引擎在白名单外）时不响应。0/不传 = 无动作（零回归）。
   */
  providerOpenSignal?: number;
  /**
   * ql-20260909-006：行最右侧插槽（缺省 null 零占位）——会话面板挂
   * CtxUsageBar（上下文用量圆环 + 额度胶囊，自输入框上方独占行收进本行；
   * 与 running 解锁提示同行，running 提示优先占位时插槽仍在其右）。
   */
  trailing?: React.ReactNode;
  /**
   * ql-20260915-009 手机端降噪：mobile 默认只显示 供应商+模型+额度——思考档位
   * 下拉、档案控件、「中断自动续跑」开关默认收起，经行尾「设置」钮展开可达
   * （ql-20260915-011 用户约束：收入口不砍功能）；控件值截断宽度同步收窄，
   * 防 flex-wrap 在窄视口挤成三行；desktop 默认不传零变化。
   */
  variant?: "desktop" | "mobile";
  /**
   * 2026-10-25-session-config-deferred-switch：受控暂存值（面板持有，键存在 =
   * 该字段有暂存）。传入后控件显示优先暂存值并带「待生效」标识；与
   * onStagedSwitch 成对使用（仅 staged 不上抛 = 只读展示暂存）。
   */
  staged?: SessionConfigStaged;
  /**
   * 2026-10-25-session-config-deferred-switch：空闲暂存模式上抛回调（与面板
   * 暂存 state 成对传入）。挂载后**空闲态**点选四控件不再立即请求后端（不再
   * 产生空切换轮），改为上抛 patch 由面板暂存、随用户下一条消息一并生效；
   * 选回当前生效值 → patch.cancel=true（取消该字段暂存）。**运行中点选不受
   * 影响**（仍走 injectSession 忙轮排队——本轮结束后生效，后端不建切换轮）；
   * provisional 暂存模式不受影响（自有 onProvisional* 通道）。未传保持旧行为
   * （点选即切换），存量调用面零回归。
   */
  onStagedSwitch?: (_patch: SessionConfigStagedPatch) => void;
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
      ? (p.label || "本机默认") // 不指定项 label 已动态化（provider-default-ui-hint）
      : p.field === "model" && p.value === SWITCH_MODEL_DEFAULT_VALUE
        ? "默认"
        : p.label;
  return `已切换${what}为「${name}」，请继续。`;
}

/* ────────────────────── 组件 ────────────────────── */

/**
 * 会话当前 git 分支指示项（2026-10-21-session-git-branch / FR-01..03）。
 *
 * 「智能体档案」控件后的只读展示：会话工作目录（cwd，缺省回退工作区绑定根）
 * 的**当前**分支——GET /api/daemon/sessions/{id}/git-status 每请求经 daemon
 * RPC 现场采集（FR-02 非快照），60s 前台轮询动态刷新（refetchIntervalInBackground
 * 默认 false，后台标签页暂停）。detached HEAD 显示 head 短 sha；no_git /
 * no_root 空态静默隐藏（FR-03，不报错不 toast）；查询失败渲染「⎇ —」占位不阻塞其余
 * 控件（retry=false——失败由下一轮轮询自然重取，不与轮询叠加堆积）。
 * 2026-10-25-session-git-worktree-root / FR-03：root_source="worktree"（会话
 * 当前变更命中 sillyspec 工作树标准布局）时 badge 加「工作树」标识、Tooltip
 * 首行标注 sillyspec 工作树——会话在隔离工作树里干活时与主仓形态可区分。
 */
function SessionGitBranchBadge({
  sessionId,
  mobile,
}: {
  sessionId: string;
  mobile: boolean;
}) {
  const gitQuery = useQuery<SessionGitStatus, ApiError>({
    queryKey: ["sessionGitStatus", sessionId],
    queryFn: () => fetchSessionGitStatus(sessionId),
    refetchInterval: 60_000,
    retry: false,
  });
  const data = gitQuery.data;

  // FR-03 空态：no_git（目录非 git 仓库）/ no_root（无 cwd 且无绑定）不渲染。
  if (data && data.git_mode !== "git") return null;
  const label =
    data == null
      ? null
      : (data.branch ?? (data.detached ? (data.head_short ?? "HEAD") : null));
  // 首帧 loading 与 git 模式无可显值（空仓库 branch null 且非 detached）都不渲染
  //（不闪骨架，数据到了再出现）；仅失败态走占位。
  if (!gitQuery.isError && label == null) return null;

  const inWorktree = data?.root_source === "worktree";

  const tooltip = (
    <div className="max-w-[280px] space-y-0.5 text-xs">
      <p>
        {inWorktree
          ? "sillyspec 工作树当前分支（60s 自动刷新）"
          : "会话工作目录当前分支（60s 自动刷新）"}
      </p>
      {data?.root ? <p className="break-all">目录：{data.root}</p> : null}
      {data && (data.files_changed != null || data.untracked_count != null) ? (
        <p>
          改动 {data.files_changed ?? 0} 个文件 · 未跟踪 {data.untracked_count ?? 0} 个
        </p>
      ) : null}
      {gitQuery.isError ? (
        <p>查询失败（守护进程离线或目录不在允许范围），稍后自动重试</p>
      ) : null}
    </div>
  );

  return (
    <Tooltip title={tooltip}>
      <span
        data-testid="session-git-branch"
        data-root-source={data?.root_source ?? "unknown"}
        title={
          gitQuery.isError
            ? "会话 Git 状态查询失败"
            : inWorktree
              ? "会话所在 sillyspec 工作树当前分支"
              : "会话当前 Git 分支"
        }
        className="inline-flex cursor-default items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/80"
      >
        <GitBranch aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-600" />
        <span className={cn("max-w-[140px] truncate", mobile && "max-w-[100px]")}>
          {gitQuery.isError ? "—" : label}
        </span>
        {inWorktree && (
          <span
            data-testid="session-git-worktree-tag"
            className="shrink-0 rounded bg-muted px-1 py-px text-[10px] leading-tight text-muted-foreground"
          >
            工作树
          </span>
        )}
      </span>
    </Tooltip>
  );
}

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
  onProvisionalThinkingLevelSwitch,
  thinkingLevel,
  trailing,
  providerOpenSignal = 0,
  variant = "desktop",
  staged,
  onStagedSwitch,
}: SessionConfigBarProps) {
  const mobile = variant === "mobile";
  // task-10：档案下拉共享智能体标识（对照 active 生效列表）。
  const { activeSharedAgents } = useActiveSharedAgents();
  const sharedProfileIds = useMemo(
    () => new Set(activeSharedAgents.map((a) => a.agent_profile_id)),
    [activeSharedAgents],
  );
  const { profiles } = useMineAgentProfiles();
  // 2026-10-19-hide-shared-profile-in-session：档案下拉可见集派生。判定按
  // shared-agents/active 的 agent_profile_id 集合（真实库数据，非名称匹配）：
  //   - 真会话：隐藏共享智能体条目——会话内切档案只换人格提示词（后端
  //     D-013），与用户对「共享智能体=整套环境」的预期不符，防中途误选；
  //     当前会话档案恰为共享智能体时豁免保留（共享会话仍可见可保持，
  //     不提供共享档案互切）。active 失败降级 []（空集）→ 不过滤零回归。
  //   - 预会话：共享条目置顶（无机器用户靠它建会话，2026-10-19-shared-
  //     agent-onboarding-hint 默认选中引导同源），普通档案保持原序。
  const visibleProfiles = useMemo(() => {
    if (provisional) {
      return [
        ...profiles.filter((p) => sharedProfileIds.has(p.id)),
        ...profiles.filter((p) => !sharedProfileIds.has(p.id)),
      ];
    }
    return profiles.filter(
      (p) => !sharedProfileIds.has(p.id) || p.id === agentProfileId,
    );
  }, [profiles, sharedProfileIds, provisional, agentProfileId]);
  const notify = useNotify();
  const qc = useQueryClient();
  // quick（ql-20260916-006）：裸 listProviders() 统一 basic 键（与 sessions-portal
  // 共享缓存，见该处注释——原场景名分键致会话页进入各发一次）。
  const providersQ = useQuery({
    queryKey: ["llmProviders", "basic"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers = useMemo(() => providersQ.data ?? [], [providersQ.data]);
  // 引擎解析上移（2026-10-28-session-config-default-provider-fix）：默认供应商的
  // 引擎匹配派生（engineDefaultProvider / 兜底文案）需要先于原声明点（原在
  // providerLocked 前定义）拿到 effectiveEngine——纯派生表达式，上移零行为漂移。
  const effectiveEngine = engine ?? configSnapshot?.engine ?? null;
  // 2026-10-21-provider-default-ui-hint：兜底项文案按用户默认供应商动态化。
  // 2026-10-28-session-config-default-provider-fix：默认供应商按引擎（agent_kinds）
  // 匹配——不覆盖当前引擎的默认行不再进兜底文案（pi 会话显示 claude-only 默认名
  // 误导），无引擎匹配默认退「不指定（本机默认）」（与 claim 默认链过滤同口径）。
  const noProviderFallbackLabel = useMemo(
    () => noProviderLabel(providers, effectiveEngine),
    [providers, effectiveEngine],
  );
  // 2026-10-21-profile-default-prehint：档案兜底项——provisional 且有默认时
  // 实际效果是「创建时用默认档案」；运行中切不指定=本会话无人格（保持原文案）。
  const noProfileFallbackLabel = useMemo(() => {
    if (provisional) {
      const def = profiles.find((p) => p.is_user_default);
      if (def) return `不指定（默认：${def.name}）`;
    }
    return "不指定（无人格）";
  }, [provisional, profiles]);

  const [openKind, setOpenKind] = useState<SessionConfigCtrlKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const barRef = useRef<HTMLDivElement>(null);

  // ql-20260915-011：mobile 展开态——收走的思考档位/档案/自动续跑经「设置」钮
  // 二次展开可达（用户约束：收入口不砍功能）；desktop 恒展开（mobileReveal=true）。
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileReveal = !mobile || mobileMoreOpen;

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

  // ql-20260917-008：running 不再锁切换——canSwitch 仅排除 ended/failed；
  // 运行中点选即受理（后端忙轮排队/覆盖合并，本轮结束后生效），提示行见底部。
  const canSwitch = !ended;
  // 2026-09-11-session-provider-switch-codex-pi task-05（FR-03 / D-002@v1）：
  // PROVIDER_SWITCH_ENGINES 白名单外引擎（cursor/未知）无会话级供应商 →
  // 控件锁定（下拉不可开；task-10 起模型子下拉同锁——直接不渲染）；原 D-010
  // claude-only 口径已废，claude/codex/pi 解锁。
  const providerLocked =
    effectiveEngine != null && !PROVIDER_SWITCH_ENGINES.has(effectiveEngine);

  // ql-20260904-010：外部信号打开供应商下拉（运行失败卡「切换供应商」定位本条）。
  // ref 记已消费的信号值——canSwitch/providerLocked 后续翻转不重放旧信号（避免
  // running→false 时凭旧信号突开下拉）；锁定/不可切时信号直接吞掉（不排队等解锁）。
  const lastProviderSignalRef = useRef(0);
  useEffect(() => {
    if (providerOpenSignal === lastProviderSignalRef.current) return;
    lastProviderSignalRef.current = providerOpenSignal;
    if (providerOpenSignal <= 0) return;
    if (providerLocked || !canSwitch) return;
    setOpenKind("provider");
  }, [providerOpenSignal, providerLocked, canSwitch]);

  // ── task-10（FR-03-2/5 / D-002@v1）：供应商+模型级联 ──────────────────────

  /**
   * 引擎匹配的用户默认供应商行（2026-10-28-session-config-default-provider-fix）：
   * is_default 且 agent_kinds 含当前引擎；引擎未定（null，悬浮助手形态创建时才
   * 定）不过滤（与 providerCandidates 过滤口径互补）。无命中 null。后端 claim
   * 默认注入同口径（lease/context.py：agent_kind ∈ agent_kinds 命中才构造
   * config），此派生保证界面展示的「默认」与后端实际注入是同一家。
   */
  const engineDefaultProvider = useMemo(
    () =>
      providers.find(
        (p) =>
          p.is_default &&
          (effectiveEngine == null || p.agent_kinds.includes(effectiveEngine)),
      ) ?? null,
    [providers, effectiveEngine],
  );

  /**
   * 显示层供应商 id（2026-10-26-config-staged-all-states FR-02）：暂存供应商
   * 优先——模型子下拉的显示条件与候选列表必须跟随暂存值（会话真值在发送前
   * 不变，直接用真值会让「暂存供应商后模型框不出现/候选不跟随」）；取消暂存
   * （staged 键删除）自然回退真值。provisional 不受影响（无 staged）。
   * 2026-10-28-session-config-default-provider-fix：真值未显式选择（null）时回退
   * 「引擎匹配的默认供应商」——控件显示即将实际注入的默认供应商、模型子下拉
   * 随之渲染且候选跟随；仅显示层回退，显式选择/暂存与请求载荷不变（创建/发送
   * 仍不带 llm_provider_id，后端默认链注入同一家）。
   */
  const displayProviderId =
    staged?.llm_provider_id !== undefined
      ? staged.llm_provider_id
      : (llmProviderId ?? engineDefaultProvider?.id ?? null);

  /** 当前选中供应商行（「不指定」/列表未含该 id → null，模型子下拉随之隐藏）。 */
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === displayProviderId) ?? null,
    [providers, displayProviderId],
  );

  /**
   * 2026-09-11-session-provider-switch-codex-pi task-05（FR-03 / D-002@v1）：
   * 供应商下拉候选按会话引擎过滤 agent_kind（agent_kind 词表
   * "claude"|"pi"|"codex" 与引擎字符串同源，llm-providers.ts 的
   * LlmProviderAgentKind）——防选错 kind 的供应商被 backend inject 422 拒绝。
   * effectiveEngine 为 null（provisional 悬浮助手形态，创建时才定引擎）维持
   * 全量；「不指定（本机默认）」项在渲染处固定，不受此过滤影响。
   */
  const providerCandidates = useMemo(
    () =>
      effectiveEngine == null
        ? providers
        : providers.filter((p) => p.agent_kinds.includes(effectiveEngine)),
    [providers, effectiveEngine],
  );

  /**
   * 模型候选 = provider.model → default_fallback_model → model_role_mappings
   * 各角色 model **去重保序**（空串/缺键过滤；不做上游 /v1/models 实时拉取，
   * D-002）。首项「默认（跟随供应商配置）」在渲染处固定，不进候选集。
   */
  const modelCandidates = useMemo(() => {
    if (!selectedProvider) return [] as string[];
    // D-001：下拉源 = 供应商模型列表条目名（主模型置顶）。
    const entries = selectedProvider.models ?? [];
    const primaryIdx = entries.findIndex((m) => m.roles?.includes("sonnet"));
    const ordered =
      primaryIdx > 0
        ? [entries[primaryIdx], ...entries.filter((_, i) => i !== primaryIdx)]
        : entries;
    const raw: (string | null | undefined)[] = ordered.map((m) => m?.name);
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
  // 2026-10-25-session-config-deferred-switch：会话态模型显示优先受控暂存值
  // （键存在 = 面板侧已归一为真暂存，值 ≠ 当前生效值）。
  const stagedModel = staged?.model;
  const currentModel = provisional
    ? provisionalModel
    : stagedModel !== undefined
      ? stagedModel
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

  // ── 2026-09-14-session-thinking-level task-06（FR-06）：思考档位下拉（两态）──────

  /** caps 门控（thinking_level 键）：cursor/未知引擎 false → 两态档位下拉均不渲染。 */
  const thinkingLevelEnabled = getProviderCaps(
    effectiveEngine ?? "",
  ).thinking_level;

  /**
   * provisional 档位暂存（组件内显示用）。值语义照 preModelId：""=未选择/级联
   * 重置清空 → 首句 create 不带 thinking_level（零回归）；七档词表值=已选档
   * （含显式选「默认」off——随首句上送，pi 侧=真关思考，P2-11 tooltip 已示）。
   * 显示层 "" 归位 off（默认档）——选项集合恒七项不另设空串项，「未选择」与
   * 「显式选默认」显示同形，差别只在是否随首句上送。
   */
  const [provisionalThinkingLevel, setProvisionalThinkingLevel] = useState("");
  const provisionalThinkingDisplay =
    provisionalThinkingLevel === ""
      ? THINKING_LEVEL_OFF_VALUE
      : provisionalThinkingLevel;

  /** 会话态动态档位（GET thinking-levels；仅 thinkingLevel prop 挂载的会话态拉取）。 */
  const thinkingLevelsQ = useQuery({
    queryKey: ["sessionThinkingLevels", sessionId],
    queryFn: () => getSessionThinkingLevels(sessionId),
    enabled:
      !provisional &&
      thinkingLevel != null &&
      thinkingLevelEnabled &&
      sessionId !== "",
    staleTime: 30_000,
  });
  // 现值回退链：引擎上报 current → null 时选「默认」（off）——引擎默认档
  // 就是事实上的当前档，不再显示「现值未知」占位（UX 反馈：占位项长且灰
  // 显得像 bug；claude/codex SDK 不暴露现值恒 null 属常态非异常）。
  const currentThinkingLevel = thinkingLevelsQ.data?.current ?? "off";

  // ── 2026-10-25-session-config-deferred-switch：空闲暂存模式 ────────────────
  // onStagedSwitch 挂载且非 provisional 时启用：空闲点选四控件仅上抛暂存
  // （不 inject/不 POST，不产生切换轮），随面板下一条消息一并生效；运行中
  // 点选仍走原 injectSession 忙轮排队（后端不建切换轮，行为不变）。
  const stagedMode = !provisional && onStagedSwitch != null;
  const stagedThinkingLevel = staged?.thinking_level;
  /**
   * 各字段当前生效值口径（选回即取消暂存的判定基准；空串 = 该字段「默认」态）：
   * provider null=本机默认、profile null=未指定、model 快照空=跟随配置、
   * thinking 现值回退 off（与控件显示回退链同源）。
   */
  const effectiveValues: Record<SessionConfigStagedField, string> = {
    llm_provider_id: llmProviderId ?? "",
    agent_profile_id: agentProfileId ?? "",
    model: configSnapshot?.model ?? "",
    thinking_level: currentThinkingLevel || THINKING_LEVEL_OFF_VALUE,
  };
  const sessionLevelOptions = useMemo(() => {
    const levels = thinkingLevelsQ.data?.levels ?? [];
    // 现值不在动态列表（引擎返回了列表外的现值）→ 追加兜底（照 modelOptions
    // 先例），保证 select 有对应 option 可显示、不丢现值。
    return currentThinkingLevel && !levels.includes(currentThinkingLevel)
      ? [...levels, currentThinkingLevel]
      : levels;
  }, [thinkingLevelsQ.data, currentThinkingLevel]);
  const [thinkingSwitching, setThinkingSwitching] = useState(false);
  /**
   * 会话态点选即切换（照模型子下拉点选形态）：POST setThinkingLevel → 成功
   * 通知 + invalidate 档位查询（R-04：pi thinking_level_change 事件不透传，
   * 现值靠查询刷新）；失败两路（200 结构化 ok=false/error 与 ApiError）均
   * notify error 带 error 原文（照 compact 先例）。
   */
  const handleThinkingLevelSwitch = async (level: string) => {
    if (!sessionId || thinkingSwitching) return;
    setThinkingSwitching(true);
    try {
      const resp = await setSessionThinkingLevel(sessionId, level);
      if (resp.ok === false || resp.error) {
        // error 原文已是中文（如「daemon 未支持思考级别，请升级 daemon」），直接透出。
        notify.error(
          new Error(resp.error ?? "思考级别切换未被受理"),
          "思考级别切换失败",
        );
        return;
      }
      // 乐观缓存：成功即写入 current（claude/codex 引擎不回读现值，不写会
      // 回到默认档显示——用户以为设置丢了；pi 引擎下次查询上报真值自然覆盖）。
      // 注意：此处**不 invalidate**——invalidate 立即触发重拉，claude/codex 回
      // current=null 覆盖乐观值（用户反馈：切档后闪回默认）。乐观值保持到组件
      // 生命周期结束或下次自然过期（staleTime 30s 后窗口聚焦才重拉）。
      qc.setQueryData(["sessionThinkingLevels", sessionId], (old: { levels: string[]; current: string | null } | undefined) =>
        old ? { ...old, current: level } : { levels: [level], current: level },
      );
      // ql-20260917-008：resp.queued=True = 忙轮覆盖式暂存（后端 pending_thinking_
      // level，run 终态钩子应用）——提示「本轮结束后生效」而非「已切换」。
      notify.success(
        resp.queued
          ? `已排队切换思考级别：${thinkingLevelLabel(level)}（本轮结束后生效）`
          : `已切换思考级别：${thinkingLevelLabel(level)}`,
      );
    } catch (err) {
      notify.error(err, "思考级别切换失败");
    } finally {
      setThinkingSwitching(false);
    }
  };

  // ql-20260922-001：思考档位控件 antd Dropdown 化（原生 select → 胶囊按钮 +
  // 上弹菜单）。open 受控是为触发器置开态高亮（bg-muted text-primary，同供应商
  // 按钮 openKind 语义）；菜单照 theme-toggle 先例 selectable + selectedKeys
  // 高亮当前档，placement=topLeft 对齐 ConfigDropdown bottom-full 上弹方向。
  const [thinkingOpen, setThinkingOpen] = useState(false);
  // 2026-10-26-config-staged-all-states FR-01：stagedMode 下不再叠
  // thinkingLevel.disabled（=running）——暂存点选不发请求，运行中禁用的理由
  // 消失（D-002「档位切换仅空闲」约束的是端点 RPC，发送时先调已满足）；
  // 仅 ended/离线（!canSwitch）与旧调用面（非 stagedMode）保持原禁用。
  const thinkingCtrlDisabled =
    !canSwitch ||
    (!provisional && !stagedMode && (thinkingLevel?.disabled ?? false));
  const thinkingCtrlValue = provisional
    ? provisionalThinkingDisplay
    : (stagedThinkingLevel ?? (currentThinkingLevel || ""));
  const thinkingMenuItems: MenuProps["items"] = (
    provisional
      ? THINKING_LEVEL_OPTIONS.map((o) => o.value)
      : sessionLevelOptions
  ).map((v) => ({
    key: v,
    label: (
      <span
        // P2-11：off（显示「默认」）跨引擎语义差异 tooltip（口径同 daemon
        // thinking-levels.ts 文件头注释，改文案两侧同步）。
        title={
          v === THINKING_LEVEL_OFF_VALUE ? THINKING_LEVEL_OFF_TOOLTIP : undefined
        }
      >
        {thinkingLevelLabel(v)}
      </span>
    ),
  }));
  const onThinkingMenuClick: MenuProps["onClick"] = ({ key }) => {
    const v = key as string;
    if (provisional) {
      setProvisionalThinkingLevel(v);
      onProvisionalThinkingLevelSwitch?.(v);
    } else if (stagedMode) {
      // 2026-10-25-session-config-deferred-switch：会话态暂存模式——点选仅上抛
      // 暂存（不 POST setSessionThinkingLevel，不即时改引擎档位），随面板下一条
      // 消息发送时先调端点生效；选回当前档 = 取消暂存。D-001：静默（控件值
      // 变化即反馈，不弹 toast），切换结果由发送后的时间线切换信息行呈现。
      // 2026-10-26-config-staged-all-states FR-01：去掉 !running 条件——运行中
      // 点选同样仅暂存（四控件全状态统一，端点调用收敛到发送时）。
      const cancel = effectiveValues.thinking_level === v;
      onStagedSwitch({
        field: "thinking_level",
        value: v,
        label: thinkingLevelLabel(v),
        cancel: cancel || undefined,
      });
    } else {
      void handleThinkingLevelSwitch(v);
    }
  };

  // 当前值展示（快照直显免二次解析，Grill C-12；id 兜底防列表缺行）。
  // 2026-10-25：受控暂存存在时控件显示暂存值（待生效）优先于会话真值。
  const stagedProfileId = staged?.agent_profile_id;
  const stagedProviderId = staged?.llm_provider_id;
  const profileLabel =
    stagedProfileId !== undefined
      ? stagedProfileId === ""
        ? "未指定"
        : (profiles.find((p) => p.id === stagedProfileId)?.name ?? stagedProfileId)
      : agentProfileId
        ? profiles.find((p) => p.id === agentProfileId)?.name ??
          configSnapshot?.profile_name ??
          agentProfileId
        : // provisional（将创建）未选 → 预示用户默认档案（创建时注入）；非
          // provisional 保持「未指定」真值——默认只在创建时注入，存量会话不追溯
          //（2026-10-21-profile-default-prehint）。
          provisional
          ? (profiles.find((p) => p.is_user_default)?.name ?? "未指定")
          : "未指定";
  const providerLabel =
    stagedProviderId !== undefined
      ? stagedProviderId === ""
        ? noProviderFallbackLabel
        : (providers.find((p) => p.id === stagedProviderId)?.name ?? stagedProviderId)
      : llmProviderId
        ? providers.find((p) => p.id === llmProviderId)?.name ??
          configSnapshot?.provider_name ??
          llmProviderId
        : // 未显式选 → 引擎匹配的用户默认供应商名（claim 链实际注入它）；无引擎
          // 匹配默认回落本机默认（2026-10-21-provider-default-ui-hint 起显示默认
          // 供应商名，2026-10-28-session-config-default-provider-fix 补引擎过滤——
          // 跨引擎默认行不显示，防 pi 会话误示 claude/codex 默认供应商）。
          engineDefaultProvider?.name ?? "本机默认";

  /** ql-20260817-010：点选即**静默**切换——prompt 发空串（后端静默切换契约：
   * 有切换字段允许空 prompt；daemon 收到空 prompt 只 reload 配置不喂消息，
   * 切换轮无用户消息/模型回应）。switchPrompt 传入时仍作为切换轮消息发出。
   * 2026-10-25-session-config-deferred-switch：暂存模式（stagedMode）点选改为
   * 仅上抛暂存——不发请求建空切换轮，随面板下一条消息一并生效。
   * 2026-10-26-config-staged-all-states FR-01：去掉 !running 条件——运行中
   * 点选同样仅暂存（旧行为「运行中即时 inject 忙轮排队」撤销：排队条目派发
   * 会建静默切换轮，用户实测看到新轮次；现统一四控件全状态点选=暂存，
   * 配置随下一条消息（含排队路径）生效，后端建带消息的正常轮）。 */
  const executeSwitch = async (p: PendingSwitch) => {
    if (submitting) return;
    const what = switchFieldWhat(p.field);
    const name =
      p.field === "llm_provider_id" && p.value === SWITCH_NO_PROVIDER_VALUE
        ? "本机默认"
        : p.label;
    if (stagedMode) {
      setOpenKind(null);
      const cancel = effectiveValues[p.field] === p.value;
      // 暂存供应商（非取消）级联重置模型暂存——候选随供应商变，旧模型对新供应
      // 商无意义；值 "" 经面板归一（与生效模型一致即清字段），生效模型非空时
      // 「模型 → 默认」是真实生效变化（对齐旧「切供应商 inject 带 model:""」语义）。
      if (p.field === "llm_provider_id" && !cancel) {
        onStagedSwitch({ field: "model", value: SWITCH_MODEL_DEFAULT_VALUE, label: "默认" });
      }
      onStagedSwitch({
        field: p.field,
        value: p.value,
        label: p.label,
        cancel: cancel || undefined,
      });
      // D-001（用户定调）：暂存静默——控件值变化即反馈，不弹 toast、不渲染
      // 「待生效」标记；切换结果由发送成功后的时间线切换信息行呈现。
      return;
    }
    // ql-20260823-008：预会话暂存——不 inject（无会话），值随首句 createSession 生效。
    if (provisional) {
      setOpenKind(null);
      notify.success(`已选择${what} → ${name}（第一句话发送创建会话时生效）`);
      // task-10：模型暂存走专用回调（onProvisionalSwitch 消费端按
      // llm_provider_id/else 二分收值，混发 "model" 会误写档案暂存）。
      if (p.field === "model") {
        setProvisionalModel(p.value);
        onProvisionalModelSwitch?.(p.value);
        // 2026-09-14-session-thinking-level task-06（FR-06）：模型变档位重置
        // （照「切供应商重置模型」模式——动态档位按当前模型（claude
        // supportedEffortLevels per-model），模型既变旧档对新模型无意义；仅清
        // 自身选择发 ""（首句不带 thinking_level），不动模型/provider 既有级联链）。
        setProvisionalThinkingLevel("");
        onProvisionalThinkingLevelSwitch?.("");
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
      // ql-20260917-008：运行中受理为忙轮排队（本轮结束后派发生效）；空闲照旧
      // 下一轮生效。提示区分两态，避免用户误以为运行中点了没反应。
      notify.success(
        running
          ? `已排队切换${what} → ${name}（本轮结束后生效，历史消息保留当时配置）`
          : `已切换${what} → ${name}（下一轮生效，历史消息保留当时配置）`,
      );
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
        <span
          className={cn(
            "max-w-[160px] truncate",
            mobile && "max-w-[110px]",
          )}
        >
          {value}
        </span>
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
            模型子下拉仅选中具体供应商且引擎未锁供应商时渲染——「不指定（本机
            默认）」与 providerLocked 两态隐藏；ql-20260917-008 起 running 不再
            置灰（受理即排队，本轮结束后生效），仅 ended 禁用。 */}
        <span className="inline-flex items-center gap-0.5">
            {ctrlButton(
              "provider",
              <Cloud aria-hidden className="h-3.5 w-3.5" />,
              providerLabel,
              // ql-20260909-005：禁用态 title 按原因说明（原恒「供应商（不选=…）」，
              // 结束/离线时点了没反应且提示误导）。priority：锁定 > 已结束/离线 > 运行中。
              // 2026-09-11-session-provider-switch-codex-pi task-05：锁定文案引擎
              // 中性化——剩余锁定对象是 cursor/未知引擎，不再点名 Codex。
              providerLocked
                ? "当前引擎不支持会话级供应商切换"
                : ended
                  ? "会话已结束或机器离线，不可切换供应商"
                  : running && !stagedMode
                    ? "运行中可切换，将于本轮结束后生效"
                    : "供应商（不选=本机默认配置）",
            <ConfigDropdown
              testId="config-dd-provider"
              title="切换供应商 · 只影响本会话"
            >
              <SwitchItem
                icon={<Cloud aria-hidden className="h-3 w-3" />}
                label={noProviderFallbackLabel}
                current={llmProviderId == null}
                onClick={() =>
                  executeSwitch({
                    field: "llm_provider_id",
                    value: SWITCH_NO_PROVIDER_VALUE,
                    label: noProviderFallbackLabel,
                  })
                }
              />
              {providerCandidates.map((p) => (
                <SwitchItem
                  key={p.id}
                  icon={<Cloud aria-hidden className="h-3 w-3" />}
                  label={p.name}
                  sub={
                    p.models?.find((m) => m.roles?.includes("sonnet"))?.name ??
                    p.models?.[0]?.name ?? undefined
                  }
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
              {providerCandidates.length === 0 && (
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
              // ql-20260909-005：禁用态 title 说明原因（原恒默认说明，离线/结束
              // 时点了没反应零解释）。
              title={
                !canSwitch
                  ? "会话已结束或机器离线，不可切换模型"
                  : running && !stagedMode
                    ? "运行中可切换，将于本轮结束后生效"
                    : "模型（默认=跟随供应商配置）"
              }
              onChange={(e) => {
                const v = e.target.value;
                executeSwitch({ field: "model", value: v, label: v || "默认" });
              }}
              className={cn(
                "h-6 cursor-pointer truncate rounded-md border border-border bg-card px-1 text-xs transition-colors hover:bg-muted",
                // mobile 原 max-w-[110px] 放宽到与 desktop 同为 150px
                // （2026-10-26-mobile-four-page-layout-fix task-06 / FR-04）：110px 下
                // 「glm-5.3-fla…」截断观感差；放不下时由外层 flex-wrap 自然折行，
                // 信息完整优先于单行。
                "max-w-[150px]",
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
        {/* 2026-09-14-session-thinking-level task-06（FR-06）：思考档位下拉（模型
            下拉邻位）。预会话态=静态七档镜像（provisional 暂存）；会话态=thinkingLevel
            prop 挂载的动态档位（GET 列表+current 现值，点选即 POST 切换）。两态均
            caps.thinking_level 门控（cursor/未知引擎不渲染）；running/ended 照模型
            下拉同禁（会话态另叠 thinkingLevel.disabled）；ql-20260915-009 mobile
            默认收进「设置」展开态（ql-20260915-011：收入口不砍功能）。
            ql-20260922-001：原生 select 改 antd Dropdown——触发器胶囊按钮与
            ctrlButton 同款类名（与供应商/档案按钮风格统一），菜单向上弹
            （placement=topLeft）selectable 高亮当前档，行为/禁用态契约不变。 */}
        {thinkingLevelEnabled &&
          mobileReveal &&
          (provisional || thinkingLevel != null) && (
          <Dropdown
            menu={{
              items: thinkingMenuItems,
              selectable: true,
              selectedKeys: [thinkingCtrlValue],
              onClick: onThinkingMenuClick,
            }}
            trigger={["click"]}
            placement="topLeft"
            disabled={thinkingCtrlDisabled}
            open={thinkingCtrlDisabled ? false : thinkingOpen}
            onOpenChange={(next) => setThinkingOpen(next)}
            destroyOnHidden
          >
            <button
              type="button"
              aria-label="配置-思考级别"
              aria-haspopup="menu"
              data-testid="config-thinking-select"
              disabled={thinkingCtrlDisabled}
              // ql-20260909-005 同款：禁用态 title 说明原因（ql-20260917-008：
              // 运行中不再禁用——仅 ended/providerLocked 禁）。
              title={
                thinkingCtrlDisabled
                  ? ended
                    ? "会话已结束或机器离线，不可切换思考级别"
                    : "思考级别切换不可用"
                  : running && !provisional && !stagedMode
                    ? "运行中可切换，将于本轮结束后生效"
                    : "思考级别（默认=引擎默认档位，语义随引擎不同见「默认」项说明）"
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                thinkingCtrlDisabled
                  ? "cursor-not-allowed text-muted-foreground/60"
                  : "cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground",
                thinkingOpen && "bg-muted text-primary",
              )}
            >
              <span aria-hidden className="shrink-0 text-brand-600">
                <Brain aria-hidden className="h-3.5 w-3.5" />
              </span>
              <span
                className={cn(
                  "max-w-[160px] truncate",
                  mobile && "max-w-[110px]",
                )}
              >
                {thinkingLevelLabel(thinkingCtrlValue)}
              </span>
              <ChevronDown
                aria-hidden
                className="h-3 w-3 shrink-0 text-muted-foreground/60"
              />
            </button>
          </Dropdown>
        )}
        {/* ql-20260915-009：mobile 默认不渲染档案控件，收进「设置」展开态
            （ql-20260915-011：收入口不砍功能）；桌面端照旧。 */}
        {mobileReveal &&
          ctrlButton(
            "profile",
            <User aria-hidden className="h-3.5 w-3.5" />,
            profileLabel,
            // ql-20260909-005：同供应商按钮——禁用态 title 说明原因。
            ended
              ? "会话已结束或机器离线，不可切换档案"
              : running && !stagedMode
                ? "运行中可切换，将于本轮结束后生效"
                : "智能体档案",
          <ConfigDropdown
            testId="config-dd-profile"
            title="切换档案 · 只影响本会话"
          >
            {/* ql-20260818-004：取消档案与供应商「不指定」对称——空串语义回无人格。 */}
            <SwitchItem
              icon={<User aria-hidden className="h-3 w-3" />}
              label={noProfileFallbackLabel}
              current={agentProfileId == null}
              onClick={() =>
                executeSwitch({
                  field: "agent_profile_id",
                  value: "",
                  label: "不指定",
                })
              }
            />
            {visibleProfiles.map((p) => (
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
        {/* 2026-10-21-session-git-branch / FR-01..03：会话当前 git 分支指示项
            （档案控件后）——组件内自取数（思考级别控件先例），mobile 与档案
            同收纳（mobileReveal 门控）；预会话（sessionId 空串）不渲染。 */}
        {mobileReveal && sessionId !== "" && (
          <SessionGitBranchBadge sessionId={sessionId} mobile={mobile} />
        )}
        {/* ql-20260915-009：mobile 不渲染弹性占位（次要开关同收，flex-wrap 行内
            留它只会把行尾插槽顶到下一行）。 */}
        {!mobile && <span className="flex-1" />}
        {/* 2026-10-22-session-composer-slim FR-02：中断自动续跑开关与「运行中
            切换将于本轮结束后生效」提示行移出配置条——续跑入口统一收进输入区
            + 菜单（SessionInputBar），运行中生效说明保留在各控件 title 中，
            释放行宽降低视觉噪音。 */}
        {/* ql-20260915-011：mobile「设置」展开钮——默认收起的思考档位/档案
            经此可达（收入口不砍功能）；仅 mobile 渲染，desktop 零变化。 */}
        {mobile && (
          <button
            type="button"
            aria-expanded={mobileMoreOpen}
            aria-label={mobileMoreOpen ? "收起会话设置" : "更多会话设置"}
            title={mobileMoreOpen ? "收起会话设置" : "思考档位 / 智能体档案"}
            data-testid="config-mobile-more"
            onClick={() => setMobileMoreOpen((v) => !v)}
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-muted",
              mobileMoreOpen
                ? "bg-muted text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Settings2 aria-hidden className="h-3.5 w-3.5" />
            设置
          </button>
        )}
        {/* ql-20260909-006：行尾插槽（CtxUsageBar 圆环+额度胶囊挪此处；不传零占位）。
            mobile 不渲染（2026-10-27-mobile-chat-visual-round2 / 用户反馈输入区按钮
            拥挤）——用量功能仍在头部 ⋯ 菜单「会话用量」区（ql-20260915-011 先例），
            行尾徽章在手机上与供应商/模型/设置挤一行是主要拥挤源。desktop 照旧。 */}
        {trailing != null && !mobile ? (
          <span className="inline-flex shrink-0 items-center">{trailing}</span>
        ) : null}
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
