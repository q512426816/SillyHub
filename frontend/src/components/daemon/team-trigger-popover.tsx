"use client";

/**
 * task-11（2026-08-22-team-session-unify / FR-03 / D-003 / D-004）：
 * 派团队触发配置弹层 TeamTriggerPopover —— 输入框上方弹出（同 SessionConfigBar
 * 浮层风格：relative 锚点 + absolute bottom-full，原型
 * prototype-team-session-unify.html §02 .team-pop）。
 *
 * 依据：
 *   - changes/2026-08-22-team-session-unify/design.md §5 Phase 3（触发配置弹层：
 *     范围：当前工作区/项目+scope 多选+anchor；预算；分身预设折叠）、§7
 *     TeamMissionTriggerRequest（触发 payload 契约）；
 *   - D-003 一期 Claude 专属（按钮置灰归 session-panel，弹层本身不判引擎）；
 *   - D-004 触发四路等价（按钮 / /team 指令 / 自然语言 / AskUser）——弹层是
 *     前两路的共用确认 UI；
 *   - task-12 提供的 lib/daemon.ts triggerSessionTeamMission 契约（本组件纯
 *     受控：onTrigger(payload) 回调，API 调用与 409 提示归 session-panel 父层）。
 *
 * 范围数据源（lib 现有 projects client，无则仅当前工作区）：
 *   - 项目下拉 = lib/ppm/project.ts listProjects——后端 /api/ppm/
 *     project-maintenance 列表按 PPM 数据范围过滤（超管=全部；非超管=我当
 *     经理的项目 + 我创建的项目，build_project_scope_clause），天然满足
 *     「仅项目经理（超管/经理）可见项目选项」；「仅创建人非经理」会看到选项但
 *     触发时被后端 403（仅项目经理可建项目维度），错误信息回显，可接受。
 *   - 项目关联工作区 = lib/workspace.ts listProjectWorkspaces（scope 候选 +
 *     类型徽标）；加载失败/无权限 → 项目维度置灰，仅当前工作区可选。
 *   - anchor 不进 payload：TeamMissionTriggerRequest 无 anchor 字段，服务端按
 *     「scope 内 backend-code 优先否则第一个」派生（daemon/router.py 触发端点
 *     同规则）——弹层按同一规则展示「主控将运行在」胶囊（信息展示非交互，
 *     避免用户选了 A 服务端落 B 的误导）。
 *
 * 约束（task-11 constraints）：不依赖 react-query（dialog 渲染路径零 react-query
 * 铁律 R4——弹层在 page/dialog 两模式都挂载）；不用 antd（对齐段族惯例，规避
 * 中文按钮 autoLetterSpacing 拆分坑）；团队视觉 violet 固定阶 + brand-* 语义阶
 *（双主题铁律）；纯 props 受控，API 调用归父层。
 *
 * task-12（2026-08-24-session-team-mission-context / FR-03 / FR-06 / D-008@v2 /
 * D-010@v1）追加：
 *   - 弹层机器状态/git 模式统一走 POST /api/workspaces/probe（后端任一成员
 *     binding 口径，与简报/mission_status 同源；不再用 useDaemonStatusMap——
 *     其无机器名字段且仅覆盖本人 bindings）。mount 对候选集（workspaceId+
 *     已加载项目工作区）拉一次存 state 静态快照，候选集变化（项目切换）事件
 *     驱动补拉一次，无轮询（design §5.C）。probe 为只读展示数据源，组件内
 *     module-level 函数直调允许（同 listProjects 先例）；task-13 迁
 *     lib/daemon.ts probeWorkspaces client 后行为不变。
 *   - 工作区行（scope 多选列表 + 当前工作区单选卡）meta：机器名
 *     （daemon_name=display_alias||hostname 后端口径）+ 在线 dot（绿/灰，未绑
 *     虚线，原型 .dot.on/.off/.none）+ git 模式标签（git 隔离/非 git · 直通/
 *     弱化模式未知）；probe 失败 fail-safe：meta 缺失不阻断弹层可用。
 *   - preSession?: boolean（缺省 false）——仅预会话实例渲染「主 agent（项目
 *     经理）」选择器（原型场景③）：默认「当前会话」+ scope 已选工作区各行；
 *     daemon_online=false/未绑 → option disabled；确认 payload 追加
 *     orchestrator_workspace_id（选工作区=其 id、默认=null；组件内类型交集，
 *     lib/daemon.ts 类型扩展归 task-13）。非 preSession 实例渲染与 payload
 *     零变化（既有会话主 agent 恒=当前会话，跨机器迁移属 C 层非目标）。
 *
 * task-07（2026-08-28-session-ppm-task-binding Phase 5 / FR-06 / D-004@v2）追加：
 *   - `defaultProjectId` 可选 prop（ppm_project 页面上下文派生，悬浮预会话
 *     「发起团队」入口传入）：projectId 初值预选 + scopeMode 初值 "project" +
 *     关联工作区加载后按 workspace_id 升序自动预选第一个作 scope（与后端
 *     Phase 1 工作区解析同排序键）；缺省行为零变化。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Settings, Users } from "lucide-react";

import { apiFetch } from "@/lib/api";
import type { TeamMissionTriggerRequest } from "@/lib/daemon";
import type { MainAgentConfig, WorkerPresetItem } from "@/lib/agent";
import { listProjects } from "@/lib/ppm/project";
import { listProjectWorkspaces, type WorkspaceBrief } from "@/lib/workspace";
import { workspaceTypeBadge } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

/* ───────────────── 选项常量（形态对齐 mission-console，task-13 将删旧文件） ───────────────── */

const AGENT_TYPE_OPTIONS = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
] as const;

const PROVIDER_OPTIONS = [
  { value: "claude", label: "Claude（Anthropic）" },
  { value: "glm", label: "GLM（智谱）" },
  { value: "gpt", label: "GPT（OpenAI）" },
  { value: "deepseek", label: "DeepSeek" },
] as const;

const WORKER_ROLE_OPTIONS = [
  { value: "arch", label: "架构分析" },
  { value: "code_style", label: "代码规范" },
  { value: "test", label: "测试" },
  { value: "integration", label: "集成" },
  { value: "risk", label: "风险" },
  { value: "impl", label: "实现" },
  { value: "verify", label: "验证" },
] as const;

/** 默认主控配置（claude_code + claude 强模型推荐，同 mission-console 默认）。 */
const DEFAULT_MAIN_AGENT_CONFIG: MainAgentConfig = {
  agent_type: "claude_code",
  provider: "claude",
  model: "claude-sonnet-4-6",
};

/** 默认新增分身模板（高级手动预设用，同 mission-console makeEmptyWorker）。 */
function makeEmptyWorker(): WorkerPresetItem {
  return { agent_type: "claude_code", model: "", objective: "", role: "impl" };
}

/* ───────────────── task-12：工作区探测（POST /api/workspaces/probe，D-008@v2） ───────────────── */

/** task-10 probe 契约响应项（本地类型；task-13 迁 lib/daemon.ts 时与 gen:types 对齐）。 */
interface WorkspaceProbeItem {
  workspace_id: string;
  /** "git" | "direct" | "unknown"（后端三态探测，D-006@v2）。 */
  git_mode: "git" | "direct" | "unknown";
  /** display_alias||hostname（后端口径）；null = 未绑机器。 */
  daemon_name: string | null;
  daemon_online: boolean;
}

/**
 * POST /api/workspaces/probe —— 弹层机器状态/git 模式唯一数据源（任一成员
 * binding 口径，与简报/mission_status 同源）。只读展示数据源，组件内直调允许
 *（同 listProjects 先例，trigger 类调用归父层的纪律不受影响）；task-13 迁
 * lib/daemon.ts probeWorkspaces client，行为不变。
 */
async function probeWorkspaces(
  workspaceIds: string[],
): Promise<WorkspaceProbeItem[]> {
  return apiFetch<WorkspaceProbeItem[]>("/api/workspaces/probe", {
    method: "POST",
    json: { workspace_ids: workspaceIds },
  });
}

/**
 * 工作区行 meta：机器名 + 在线 dot（原型 .dot.on 绿带光晕/.off 灰/.none 虚线）
 * + git 模式标签（.tag.git 绿/.tag.direct 琥珀/unknown 弱化）。probe 无数据
 *（未覆盖/失败 fail-safe）→ 不渲染，弹层照常可用。
 */
function WorkspaceProbeMeta({ probe }: { probe?: WorkspaceProbeItem }) {
  if (!probe) return null;
  const unbound = probe.daemon_name === null;
  const dotState = unbound ? "none" : probe.daemon_online ? "on" : "off";
  const tag =
    probe.git_mode === "git"
      ? { text: "git 隔离", cls: "border-emerald-300/60 bg-emerald-50 text-emerald-700" }
      : probe.git_mode === "direct"
        ? { text: "非 git · 直通", cls: "border-amber-300/60 bg-amber-50 text-amber-700" }
        : { text: "模式未知", cls: "border-border bg-muted text-muted-foreground" };
  return (
    <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
      <span
        aria-hidden
        data-testid={`probe-dot-${probe.workspace_id}`}
        data-state={dotState}
        className={cn(
          "h-[7px] w-[7px] shrink-0 rounded-full",
          dotState === "on" && "bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/60",
          dotState === "off" && "bg-muted-foreground/60",
          dotState === "none" && "border border-dashed border-muted-foreground/60 bg-transparent",
        )}
      />
      <span className="truncate">
        {unbound ? "未绑机器" : `${probe.daemon_name} · ${probe.daemon_online ? "在线" : "离线"}`}
      </span>
      <span
        className={`inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[10px] font-semibold ${tag.cls}`}
      >
        {tag.text}
      </span>
    </span>
  );
}

/* ───────────────── props 契约（session-panel 两模式消费） ───────────────── */

export interface TeamTriggerPopoverProps {
  /** 会话绑定工作区 id（scope 默认「当前工作区」的数据源）；null = 未绑定。 */
  workspaceId: string | null;
  /** 当前工作区显示名（父层已知时注入；缺省短 id 兜底）。 */
  workspaceName?: string | null;
  /** 目标预填（/team 指令文本 /「用团队分析」提示句）；确认后由父层回填输入框。 */
  defaultObjective?: string | null;
  /**
   * task-07 Phase 5（2026-08-28-session-ppm-task-binding / FR-06 / D-004@v2）：
   * 项目预选 id（ppm_project 页面上下文派生，悬浮预会话「发起团队」入口传）。
   * 有值时：projectId 初值预选 + scopeMode 初值 "project" + 自动拉关联工作区并
   * 按 workspace_id 升序预选第一个作 scope（与后端 link 写入/Phase 1 工作区解析
   * 同排序键 D-004@v2）；列表空/加载失败不报错（弹层照常可用，确认走既有
   * 「至少一个工作区」校验）。缺省 → 现行为零变化。
   */
  defaultProjectId?: string;
  /**
   * task-12：预会话实例（新会话派团队，session-panel task-13 传参）。仅 true
   * 渲染「主 agent（项目经理）」选择器 + 确认按钮文案「派团队（随首句创建生效）」
   * + payload 追加 orchestrator_workspace_id；缺省 false 渲染与 payload 零变化。
   */
  preSession?: boolean;
  /** 提交中（父层 triggerSessionTeamMission 在途 → 确认按钮禁用）。 */
  submitting?: boolean;
  /** 确认回调：payload 即 TeamMissionTriggerRequest，API 调用归父层。 */
  onTrigger: (payload: TeamMissionTriggerRequest) => void;
  /** 取消/关闭回调。 */
  onClose: () => void;
}

/**
 * preSession 实例 payload 构造类型（task-12 引入；task-14 gen:types 收敛后保留
 * 为构造侧精确视图）：本组件状态用 WorkerPresetItem[]/MainAgentConfig 精确类型
 * 组装，onTrigger prop 收窄为 TeamMissionTriggerRequest（trigger 路径契约）。
 * lib 侧 create 块（SessionCreateTeamMission）已收敛为生成版
 * TeamMissionCreateBlock（worker_preset/main_agent_config 为宽松 dict 形态）——
 * 本交集（精确）→ 生成块（宽松）结构安全，session-panel 经 as 断言暂存。
 */
type TeamTriggerPayload = TeamMissionTriggerRequest & {
  orchestrator_workspace_id?: string | null;
};

/* ───────────────── 组件 ───────────────── */

export function TeamTriggerPopover({
  workspaceId,
  workspaceName,
  defaultObjective,
  defaultProjectId,
  preSession = false,
  submitting = false,
  onTrigger,
  onClose,
}: TeamTriggerPopoverProps) {
  // 目标（可选）：留空 → 后端落占位、首条 inject 回填（CC-09）。
  const [objective, setObjective] = useState(defaultObjective ?? "");
  // 范围模式：workspace（默认，需会话绑定工作区）/ project。task-07 Phase 5：
  // defaultProjectId 有值 → 预选项目维度（项目上下文入口直接落到项目 scope）。
  const [scopeMode, setScopeMode] = useState<"workspace" | "project">(
    defaultProjectId ? "project" : workspaceId ? "workspace" : "project",
  );
  // 项目下拉数据：null = 加载中；[] = 无可见项目（非项目经理/加载失败）。
  const [projects, setProjects] = useState<
    Awaited<ReturnType<typeof listProjects>> | null
  >(null);
  // task-07 Phase 5：项目初值预选（defaultProjectId；缺省空选走原逻辑）。
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  // 项目关联工作区（scope 候选）：null = 未加载。
  const [projectWorkspaces, setProjectWorkspaces] = useState<
    WorkspaceBrief[] | null
  >(null);
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  // 预算（留空 = 不限，校验同 mission-console FE-P2-4）。
  const [budget, setBudget] = useState("");
  // 分身预设折叠（默认折叠 = 主控自动拆解 + 服务端默认主控配置）。
  const [presetOpen, setPresetOpen] = useState(false);
  const [mainAgent, setMainAgent] = useState<MainAgentConfig>(
    DEFAULT_MAIN_AGENT_CONFIG,
  );
  const [workers, setWorkers] = useState<WorkerPresetItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  // task-12：probe 静态快照（workspace_id → 项；null=未拉到/失败 fail-safe）。
  const [probeMap, setProbeMap] = useState<Record<string, WorkspaceProbeItem>>({});
  // task-12：主 agent 选择（""=当前会话默认；工作区 id=钉该工作区）。仅 preSession 实例。
  const [orchestratorChoice, setOrchestratorChoice] = useState("");

  const workspaceLabel =
    workspaceName?.trim() || (workspaceId ? `#${workspaceId.slice(0, 8)}` : null);

  // 项目下拉：弹层打开即拉一次（PPM 数据范围=超管全部/经理+创建人，见文件头）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await listProjects({ page_size: 200 });
        if (!cancelled) setProjects(items);
      } catch {
        // 无权限 / 网络失败 → 视为无可选项目（范围仅当前工作区）。
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 项目切换 → 拉关联工作区（scope 候选），scope 重置为空选。
  useEffect(() => {
    if (!projectId) {
      setProjectWorkspaces(null);
      setScopeIds([]);
      return;
    }
    let cancelled = false;
    setProjectWorkspaces(null);
    setScopeIds([]);
    void (async () => {
      try {
        const list = await listProjectWorkspaces(projectId);
        if (!cancelled) setProjectWorkspaces(list);
      } catch {
        if (!cancelled) setProjectWorkspaces([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // task-07 Phase 5（FR-06 / D-004@v2）：defaultProjectId 预选——关联工作区
  // 加载成功后按 workspace_id 升序（UUID 字典序，与 Phase 1 后端工作区解析/
  // link 写入同排序键）取第一个设为 scope 预选；ref 保证只预选一次（用户改选
  // 其它项目后走原「scope 空选」逻辑，不重复自动勾选）。列表空/加载失败 →
  // 不报错不勾选（确认走既有「至少一个工作区」校验文案）。
  const workspacePreselectedRef = useRef(false);
  useEffect(() => {
    if (!defaultProjectId || workspacePreselectedRef.current) return;
    if (!projectWorkspaces || projectWorkspaces.length === 0) return;
    workspacePreselectedRef.current = true;
    const first = [...projectWorkspaces].sort((a, b) =>
      a.workspace_id < b.workspace_id ? -1 : a.workspace_id > b.workspace_id ? 1 : 0,
    )[0]!;
    setScopeIds((prev) => (prev.length > 0 ? prev : [first.workspace_id]));
  }, [defaultProjectId, projectWorkspaces]);

  const projectSelectable = (projects?.length ?? 0) > 0;
  const projectsLoading = projects === null;

  // task-12：probe 候选集 = 当前工作区 + 已加载的项目关联工作区（去重保序）。
  const probeCandidateIds = useMemo(() => {
    const ids = workspaceId ? [workspaceId] : [];
    for (const w of projectWorkspaces ?? []) {
      if (!ids.includes(w.workspace_id)) ids.push(w.workspace_id);
    }
    return ids;
  }, [workspaceId, projectWorkspaces]);

  // 同候选集只拉一次（弹层生命周期内静态快照；项目切换回已拉过的候选集不重复
  // 拉——含加载中间态 list→null 回落 mount 集的场景）。无 setInterval/轮询。
  const probedKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (probeCandidateIds.length === 0) return;
    const key = probeCandidateIds.join(",");
    if (probedKeysRef.current.has(key)) return;
    probedKeysRef.current.add(key);
    void (async () => {
      try {
        const items = await probeWorkspaces(probeCandidateIds);
        if (!Array.isArray(items)) return;
        setProbeMap((prev) => {
          const next = { ...prev };
          for (const item of items) next[item.workspace_id] = item;
          return next;
        });
      } catch {
        // fail-safe（task-12 ⑤）：probe 失败保持既有快照，meta 缺失不阻断弹层。
      }
    })();
  }, [probeCandidateIds]);

  /**
   * anchor 派生展示（scope 内 backend-code 优先否则第一个）——与后端触发端点
   * 逐字同规则，仅信息展示不进 payload（DTO 无 anchor 字段）。
   */
  const derivedAnchor = useMemo(() => {
    if (scopeMode !== "project" || !projectWorkspaces) return null;
    const selected = projectWorkspaces.filter((w) =>
      scopeIds.includes(w.workspace_id),
    );
    if (selected.length === 0) return null;
    return selected.find((w) => w.type === "backend-code") ?? selected[0]!;
  }, [scopeMode, projectWorkspaces, scopeIds]);

  /**
   * task-12：主 agent 选择器候选（scope 已选工作区）——项目模式=已勾选列表，
   * 工作区模式=当前工作区（该工作区即 scope）。仅 preSession 实例渲染。
   */
  const orchestratorOptions = useMemo(() => {
    if (scopeMode === "project") {
      return (projectWorkspaces ?? []).filter((w) =>
        scopeIds.includes(w.workspace_id),
      );
    }
    return workspaceId
      ? [
          {
            workspace_id: workspaceId,
            name: workspaceLabel ?? `#${workspaceId.slice(0, 8)}`,
          },
        ]
      : [];
  }, [scopeMode, projectWorkspaces, scopeIds, workspaceId, workspaceLabel]);

  // scope 变化（取消勾选/切模式）后所选工作区不在候选内 → 回落「当前会话」默认。
  const orchestratorValue = orchestratorOptions.some(
    (o) => o.workspace_id === orchestratorChoice,
  )
    ? orchestratorChoice
    : "";

  const toggleScope = (id: string) => {
    setScopeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const updateWorker = (idx: number, patch: Partial<WorkerPresetItem>) => {
    setWorkers((prev) =>
      prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  };

  const handleConfirm = () => {
    setError(null);
    // 预算校验（FE-P2-4 同款）：留空不限；否则必须为正的有限数值。
    const budgetNum = budget.trim() ? Number(budget) : null;
    if (budgetNum !== null && (!Number.isFinite(budgetNum) || budgetNum <= 0)) {
      setError("预算必须为正的有限数值（留空表示不限）。");
      return;
    }
    // 项目维度：项目 + scope ≥ 1（越界由后端 422 拦截，前端只做存在性校验）。
    if (scopeMode === "project" && (!projectId || scopeIds.length === 0)) {
      setError("请选择项目并勾选至少一个工作区作为派发范围。");
      return;
    }
    if (scopeMode === "workspace" && !workspaceId) {
      setError("会话未绑定工作区，请选择项目维度或在项目内勾选工作区。");
      return;
    }

    const payload: TeamTriggerPayload = {
      objective: objective.trim() || null,
      budget_usd: budgetNum,
    };
    if (scopeMode === "project" && projectId) {
      payload.project_id = projectId;
      payload.scope_workspace_ids = scopeIds;
    }
    // 分身预设：仅展开过才带（未展开 = 主控自动拆解 + 服务端默认主控配置）。
    if (presetOpen) {
      payload.main_agent_config = mainAgent;
      if (workers.length > 0) payload.worker_preset = workers;
    }
    // task-12：仅 preSession 实例追加主 agent 工作区（选工作区=其 id、默认
    // 「当前会话」=null）；非 preSession 实例 payload 不含该字段（零变化）。
    if (preSession) {
      payload.orchestrator_workspace_id = orchestratorValue || null;
    }
    onTrigger(payload);
  };

  return (
    <div
      role="dialog"
      aria-label="派团队配置"
      className="absolute bottom-full left-0 z-30 mb-1.5 max-h-[70vh] w-[400px] overflow-y-auto rounded-xl border border-violet-200 bg-card p-4 text-xs shadow-md"
    >
      {/* 标题 + 说明（原型 .team-pop .tp-title / .tp-sub；violet =「团队」固定身份色） */}
      <p className="flex items-center gap-2 text-[13px] font-bold text-violet-700">
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100"
        >
          <Users className="h-3.5 w-3.5" />
        </span>
        派团队做这件事
      </p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
        当前会话的智能体升级为主控，通过 MCP 派发分身；任务进展直接回到本会话。
      </p>

      {/* 目标（可选）：/team 指令文本或「用团队分析」提示句预填；确认后随下条消息发出 */}
      <label className="mt-3 block">
        <span className="text-[10.5px] font-semibold text-muted-foreground">
          目标（可选，确认后回填输入框，随下条消息发出）
        </span>
        <input
          type="text"
          aria-label="目标（可选，随下条消息发出）"
          placeholder="留空则在下条消息里写目标"
          className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[12.5px] text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-brand-100"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
      </label>

      {/* 派发范围（原型 .tp-lb + .tp-opt 单选卡：原生 radio 视觉隐藏，peer 自绘品牌圆点） */}
      <p className="mt-3 text-[10.5px] font-semibold text-muted-foreground">
        派发范围
      </p>
      <div className="mt-1 flex flex-col gap-1.5">
        {/* 选项 1：当前工作区（默认） */}
        <label
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] transition-colors",
            scopeMode === "workspace"
              ? "border-brand-300 bg-brand-50 ring-[3px] ring-brand-100"
              : "border-border bg-card hover:bg-muted/50",
            !workspaceId && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="radio"
            name="team-scope-mode"
            aria-label="当前工作区"
            checked={scopeMode === "workspace"}
            disabled={!workspaceId}
            onChange={() => setScopeMode("workspace")}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-border-strong bg-card transition-colors peer-checked:border-[5px] peer-checked:border-primary peer-disabled:opacity-50"
          />
          {/* task-12：单列化，首行=名称+徽标+提示，次行=机器状态 meta（原型场景②） */}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 font-semibold text-foreground">
                {workspaceLabel ?? "未绑定工作区"}
              </span>
              <span className="shrink-0 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                当前工作区
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
                分身在本工作区绑定的机器上跑
              </span>
            </span>
            {workspaceId && <WorkspaceProbeMeta probe={probeMap[workspaceId]} />}
          </span>
        </label>

        {/* 选项 2：项目维度（仅项目经理可选；scope 多选 + anchor 派生展示） */}
        <label
          className={cn(
            "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px] transition-colors",
            scopeMode === "project"
              ? "border-brand-300 bg-brand-50 ring-[3px] ring-brand-100"
              : "border-border bg-card hover:bg-muted/50",
            !projectSelectable && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="radio"
            name="team-scope-mode"
            aria-label="项目维度"
            checked={scopeMode === "project"}
            disabled={!projectSelectable}
            onChange={() => setScopeMode("project")}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-border-strong bg-card transition-colors peer-checked:border-[5px] peer-checked:border-primary peer-disabled:opacity-50"
          />
          <span className="shrink-0 font-semibold text-foreground">项目维度</span>
          <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
            项目 · 跨工作区
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
            仅项目经理可选，需选主工作区 Anchor
          </span>
        </label>
      </div>
      {projectsLoading && (
        <p className="mt-1 text-[11px] text-muted-foreground">项目加载中…</p>
      )}
      {!projectsLoading && !projectSelectable && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          暂无可选项目（项目维度仅项目经理可见；加载失败同样收窄为当前工作区）。
        </p>
      )}

      {/* 项目维度展开：项目下拉 + 工作区多选 + anchor 胶囊（原型 .tp-sub-box） */}
      {scopeMode === "project" && (
        <div className="mt-1.5 space-y-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <label className="block">
            <span className="text-[10.5px] font-semibold text-muted-foreground">
              选择项目
            </span>
            <select
              aria-label="选择项目"
              className="mt-1 h-8 w-full rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground focus:border-primary focus:outline-none"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">请选择项目</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name?.trim() || p.project_code}
                </option>
              ))}
            </select>
          </label>

          {projectId && (
            <>
              <div className="text-[10.5px] font-semibold text-muted-foreground">
                派发范围（Scope）· 勾选工作区
              </div>
              {projectWorkspaces === null ? (
                <p className="text-[11px] text-muted-foreground">
                  工作区加载中…
                </p>
              ) : projectWorkspaces.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  该项目未关联工作区。
                </p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {projectWorkspaces.map((w) => {
                    const checked = scopeIds.includes(w.workspace_id);
                    const badge = workspaceTypeBadge(w.type);
                    return (
                      <li key={w.workspace_id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-[12px] transition-colors",
                            checked
                              ? "border-brand-300 bg-brand-50 ring-[3px] ring-brand-100"
                              : "border-border bg-card hover:bg-muted/50",
                          )}
                        >
                          <input
                            type="checkbox"
                            aria-label={`勾选工作区 ${w.name}`}
                            checked={checked}
                            onChange={() => toggleScope(w.workspace_id)}
                            className="peer sr-only"
                          />
                          <span
                            aria-hidden
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-border-strong bg-card text-transparent transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white"
                          >
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </span>
                          {/* task-12：单列化，首行=名称+类型徽标，次行=机器状态 meta（原型场景①） */}
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 font-medium text-foreground">
                                {w.name}
                              </span>
                              <span
                                title={w.type ?? undefined}
                                className={`inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-semibold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </span>
                            <WorkspaceProbeMeta probe={probeMap[w.workspace_id]} />
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* anchor 派生展示（信息非交互，规则与服务端一致，见文件头注释） */}
              {derivedAnchor && (
                <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <span>主控将运行在</span>
                  <span
                    data-testid="team-anchor-name"
                    className="inline-flex h-5 items-center rounded-full border border-teal-300 bg-teal-50 px-2 text-[10.5px] font-semibold text-teal-800"
                  >
                    {derivedAnchor.name}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground/70">
                    （后端代码类型优先，自动派生）
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* task-12：主 agent（项目经理）选择器——仅 preSession 实例（原型场景③）。
          既有会话实例不渲染（主 agent 恒=当前会话，进程 cwd/机器创建时钉定，
          跨机器迁移属 C 层非目标——仅以选择器下方说明文案表达，不加交互）。 */}
      {preSession && (
        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/40 p-2.5">
          <label className="block">
            <span className="text-[10.5px] font-semibold text-violet-700">
              主 agent（项目经理）
            </span>
            <select
              aria-label="主 agent（项目经理）"
              className="mt-1 h-8 w-full rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground focus:border-primary focus:outline-none"
              value={orchestratorValue}
              onChange={(e) => setOrchestratorChoice(e.target.value)}
            >
              <option value="">当前会话（默认：用上方选择的机器与智能体）</option>
              {orchestratorOptions.map((w) => {
                const probe = probeMap[w.workspace_id];
                // fail-safe：无探测数据（未拉到/失败）同样禁选——机器状态不可
                // 确证，回落「当前会话」默认仍可确认派发。
                const selectable =
                  probe !== undefined &&
                  probe.daemon_name !== null &&
                  probe.daemon_online;
                const label = !probe
                  ? `${w.name} · 机器状态未知`
                  : probe.daemon_name === null
                    ? `${w.name} · 未绑机器`
                    : !probe.daemon_online
                      ? `${w.name} · 机器离线`
                      : `${w.name} · ${probe.daemon_name}（该工作区设备与智能体）`;
                return (
                  <option
                    key={w.workspace_id}
                    value={w.workspace_id}
                    disabled={!selectable}
                  >
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
            选工作区 → 会话创建在该工作区绑定的机器上，工作目录与智能体用该工作区默认。
            既有会话中途派团队不提供此项（会话机器与目录创建时已定）。
          </p>
        </div>
      )}

      {/* 费用上限（原型 .tp-inp：留空 = 不限） */}
      <label className="mt-3 block">
        <span className="text-[10.5px] font-semibold text-muted-foreground">
          费用上限（可选，美元）
        </span>
        <input
          type="text"
          aria-label="费用上限（美元，留空不限）"
          placeholder="留空 = 不限"
          inputMode="decimal"
          className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[12.5px] text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-brand-100"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>

      {/* 分身预设折叠（默认折叠 = 主控自动拆解；原型 §02「分身预设…」按钮） */}
      <button
        type="button"
        onClick={() => setPresetOpen((v) => !v)}
        className="mt-3 flex w-full items-center justify-between rounded-lg border border-violet-200 bg-violet-50/50 px-2.5 py-1.5 text-[11.5px] font-semibold text-violet-700 transition-colors hover:bg-violet-100/70"
        aria-expanded={presetOpen}
      >
        <span className="inline-flex items-center gap-1">
          <Settings aria-hidden className="h-3.5 w-3.5" />
          分身预设{workers.length > 0 ? `（${workers.length}）` : ""} ·
          主控配置
        </span>
        <span aria-hidden>{presetOpen ? "收起 ▴" : "展开 ▾"}</span>
      </button>
      {presetOpen && (
        <div className="mt-1.5 space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-2.5">
          {/* 主控配置（不填走默认 Claude · claude-sonnet-4-6） */}
          <div className="grid grid-cols-3 gap-1.5">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-medium text-muted-foreground">
                主控 AI 类型
              </span>
              <select
                aria-label="主控 AI 类型"
                className="h-7 rounded border border-input bg-card px-1.5 text-[11.5px] text-foreground"
                value={mainAgent.agent_type}
                onChange={(e) =>
                  setMainAgent({ ...mainAgent, agent_type: e.target.value })
                }
              >
                {AGENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-medium text-muted-foreground">
                主控厂家
              </span>
              <select
                aria-label="主控厂家"
                className="h-7 rounded border border-input bg-card px-1.5 text-[11.5px] text-foreground"
                value={mainAgent.provider}
                onChange={(e) =>
                  setMainAgent({ ...mainAgent, provider: e.target.value })
                }
              >
                {PROVIDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-medium text-muted-foreground">
                主控模型
              </span>
              <input
                type="text"
                aria-label="主控模型"
                placeholder="如 claude-sonnet-4-6"
                className="h-7 rounded border border-input bg-card px-1.5 text-[11.5px] text-foreground"
                value={mainAgent.model}
                onChange={(e) =>
                  setMainAgent({ ...mainAgent, model: e.target.value })
                }
              />
            </label>
          </div>

          {/* 分身列表（留空 = 主控自动拆） */}
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-700">
              <Users aria-hidden className="h-3 w-3" />
              分身列表（{workers.length}）· 留空 = 主控自动拆
            </span>
            <button
              type="button"
              onClick={() => setWorkers((prev) => [...prev, makeEmptyWorker()])}
              className="rounded border border-violet-300 bg-card px-2 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
            >
              + 添加分身
            </button>
          </div>
          {workers.map((w, idx) => (
            <div
              key={idx}
              className="space-y-1.5 rounded-lg border border-border bg-card p-2 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-semibold text-muted-foreground">
                  分身 #{idx + 1}
                </span>
                <button
                  type="button"
                  aria-label={`删除分身 ${idx + 1}`}
                  onClick={() =>
                    setWorkers((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-destructive transition-colors hover:bg-destructive/10"
                >
                  删除
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">AI 类型</span>
                  <select
                    aria-label={`分身 ${idx + 1} AI 类型`}
                    className="h-7 rounded border border-input bg-card px-1.5 text-[11.5px] text-foreground"
                    value={w.agent_type}
                    onChange={(e) =>
                      updateWorker(idx, { agent_type: e.target.value })
                    }
                  >
                    {AGENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">角色</span>
                  <select
                    aria-label={`分身 ${idx + 1} 角色`}
                    className="h-7 rounded border border-input bg-card px-1.5 text-[11.5px] text-foreground"
                    value={w.role}
                    onChange={(e) => updateWorker(idx, { role: e.target.value })}
                  >
                    {WORKER_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">模型</span>
                  <input
                    type="text"
                    aria-label={`分身 ${idx + 1} 模型`}
                    placeholder="留空走默认"
                    className="h-7 rounded border border-input bg-card px-1.5 text-[11.5px] text-foreground"
                    value={w.model}
                    onChange={(e) =>
                      updateWorker(idx, { model: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">分工目标</span>
                <input
                  type="text"
                  aria-label={`分身 ${idx + 1} 分工目标`}
                  placeholder="这个分身具体干什么"
                  className="h-7 rounded border border-input bg-card px-1.5 text-[11.5px] text-foreground"
                  value={w.objective}
                  onChange={(e) =>
                    updateWorker(idx, { objective: e.target.value })
                  }
                />
              </label>
            </div>
          ))}
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <p
          className="mt-2.5 rounded-lg border border-destructive/30 bg-red-50 px-2.5 py-1.5 text-[11px] text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* 底部操作（原型 .tp-foot：主按钮实心品牌色 + hint 右对齐可换行） */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-[30px] rounded-lg border border-border bg-card px-3 text-[12px] text-muted-foreground transition-colors hover:bg-muted"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="h-[30px] rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground shadow-sm transition-shadow hover:shadow-primary disabled:opacity-60"
        >
          {/* task-12：preSession 实例文案对齐原型场景③（随首句创建会话生效）。 */}
          {submitting
            ? "派发中…"
            : preSession
              ? "派团队（随首句创建生效）"
              : "就绪，随下条消息发出"}
        </button>
        <span className="ml-auto text-[10.5px] text-muted-foreground/70">
          或直接在输入框说「派团队去…」
        </span>
      </div>
    </div>
  );
}
