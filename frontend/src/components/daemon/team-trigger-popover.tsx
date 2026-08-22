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
 */

import { useEffect, useMemo, useState } from "react";

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

/* ───────────────── props 契约（session-panel 两模式消费） ───────────────── */

export interface TeamTriggerPopoverProps {
  /** 会话绑定工作区 id（scope 默认「当前工作区」的数据源）；null = 未绑定。 */
  workspaceId: string | null;
  /** 当前工作区显示名（父层已知时注入；缺省短 id 兜底）。 */
  workspaceName?: string | null;
  /** 目标预填（/team 指令文本 /「用团队分析」提示句）；确认后由父层回填输入框。 */
  defaultObjective?: string | null;
  /** 提交中（父层 triggerSessionTeamMission 在途 → 确认按钮禁用）。 */
  submitting?: boolean;
  /** 确认回调：payload 即 TeamMissionTriggerRequest，API 调用归父层。 */
  onTrigger: (payload: TeamMissionTriggerRequest) => void;
  /** 取消/关闭回调。 */
  onClose: () => void;
}

/* ───────────────── 组件 ───────────────── */

export function TeamTriggerPopover({
  workspaceId,
  workspaceName,
  defaultObjective,
  submitting = false,
  onTrigger,
  onClose,
}: TeamTriggerPopoverProps) {
  // 目标（可选）：留空 → 后端落占位、首条 inject 回填（CC-09）。
  const [objective, setObjective] = useState(defaultObjective ?? "");
  // 范围模式：workspace（默认，需会话绑定工作区）/ project。
  const [scopeMode, setScopeMode] = useState<"workspace" | "project">(
    workspaceId ? "workspace" : "project",
  );
  // 项目下拉数据：null = 加载中；[] = 无可见项目（非项目经理/加载失败）。
  const [projects, setProjects] = useState<
    Awaited<ReturnType<typeof listProjects>> | null
  >(null);
  const [projectId, setProjectId] = useState("");
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

  const projectSelectable = (projects?.length ?? 0) > 0;
  const projectsLoading = projects === null;

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

    const payload: TeamMissionTriggerRequest = {
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
    onTrigger(payload);
  };

  const workspaceLabel = workspaceName?.trim() || (workspaceId ? `#${workspaceId.slice(0, 8)}` : null);

  return (
    <div
      role="dialog"
      aria-label="派团队配置"
      className="absolute bottom-full left-0 z-30 mb-1.5 max-h-[70vh] w-[380px] overflow-y-auto rounded-lg border border-violet-200 bg-card p-3.5 text-xs shadow-lg"
    >
      {/* 标题 + 说明（原型 .pop-title / .pop-sub） */}
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-violet-700">
        <span aria-hidden>👥</span>派团队做这件事
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        当前会话的智能体升级为主控，通过 MCP 派发分身；任务进展直接回到本会话。
      </p>

      {/* 目标（可选）：/team 指令文本或「用团队分析」提示句预填；确认后随下条消息发出 */}
      <label className="mt-2.5 block">
        <span className="text-[11px] font-semibold text-muted-foreground">
          目标（可选，确认后回填输入框，随下条消息发出）
        </span>
        <input
          type="text"
          aria-label="目标（可选，随下条消息发出）"
          placeholder="留空则在下条消息里写目标"
          className="mt-1 h-8 w-full rounded border border-input bg-background px-2 text-[12.5px] text-foreground focus:border-ring focus:outline-none"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
      </label>

      {/* 派发范围（原型 .pop-lb + .scope-item） */}
      <p className="mt-2.5 text-[11px] font-semibold text-muted-foreground">
        派发范围
      </p>
      <div className="mt-1 flex flex-col gap-1">
        {/* 选项 1：当前工作区（默认） */}
        <label
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-[12.5px]",
            scopeMode === "workspace"
              ? "border-brand-200 bg-brand-50/60"
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
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="shrink-0 font-semibold text-foreground">
            {workspaceLabel ?? "未绑定工作区"}
          </span>
          <span className="shrink-0 rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
            当前工作区
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground/70">
            分身在本工作区绑定的机器上跑
          </span>
        </label>

        {/* 选项 2：项目维度（仅项目经理可选；scope 多选 + anchor 派生展示） */}
        <label
          className={cn(
            "flex items-center gap-2 rounded border px-2.5 py-1.5 text-[12.5px]",
            scopeMode === "project"
              ? "border-brand-200 bg-brand-50/60"
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
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="shrink-0 font-semibold text-foreground">项目维度</span>
          <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
            项目 · 跨工作区
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground/70">
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

      {/* 项目维度展开：项目下拉 + 工作区多选 + anchor 胶囊 */}
      {scopeMode === "project" && (
        <div className="mt-1.5 space-y-1.5 rounded border border-border bg-muted/30 p-2">
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">
              选择项目
            </span>
            <select
              aria-label="选择项目"
              className="mt-1 h-8 w-full rounded border border-input bg-card px-2 text-[12.5px] text-foreground"
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
              <div className="text-[11px] font-medium text-muted-foreground">
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
                            "flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-[12px]",
                            checked
                              ? "border-brand-200 bg-brand-50/60"
                              : "border-border bg-card hover:bg-muted/50",
                          )}
                        >
                          <input
                            type="checkbox"
                            aria-label={`勾选工作区 ${w.name}`}
                            checked={checked}
                            onChange={() => toggleScope(w.workspace_id)}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          <span className="shrink-0 font-medium text-foreground">
                            {w.name}
                          </span>
                          <span
                            title={w.type ?? undefined}
                            className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold ${badge.className}`}
                          >
                            {badge.label}
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

      {/* 费用上限（原型 .pop-lb：留空 = 不限） */}
      <label className="mt-2.5 block">
        <span className="text-[11px] font-semibold text-muted-foreground">
          费用上限（可选，美元）
        </span>
        <input
          type="text"
          aria-label="费用上限（美元，留空不限）"
          placeholder="留空 = 不限"
          inputMode="decimal"
          className="mt-1 h-8 w-full rounded border border-input bg-background px-2 text-[12.5px] text-foreground focus:border-ring focus:outline-none"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>

      {/* 分身预设折叠（默认折叠 = 主控自动拆解；原型 §02「分身预设…」按钮） */}
      <button
        type="button"
        onClick={() => setPresetOpen((v) => !v)}
        className="mt-2.5 flex w-full items-center justify-between rounded border border-violet-200 bg-violet-50/40 px-2.5 py-1.5 text-[11.5px] font-semibold text-violet-700 hover:bg-violet-50"
        aria-expanded={presetOpen}
      >
        <span>
          ⚙ 分身预设{workers.length > 0 ? `（${workers.length}）` : ""} ·
          主控配置
        </span>
        <span aria-hidden>{presetOpen ? "收起 ▴" : "展开 ▾"}</span>
      </button>
      {presetOpen && (
        <div className="mt-1.5 space-y-2 rounded border border-violet-200 bg-violet-50/40 p-2.5">
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
            <span className="text-[10.5px] font-semibold text-violet-700">
              👥 分身列表（{workers.length}）· 留空 = 主控自动拆
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
              className="space-y-1.5 rounded border border-border bg-card p-2"
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
                  className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-red-600 hover:bg-red-50"
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
        <p className="mt-2 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* 底部操作（原型 .pop-foot） */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-[30px] rounded-md border border-border bg-card px-3 text-[12px] text-muted-foreground hover:bg-muted"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="h-[30px] rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60"
        >
          {submitting ? "派发中…" : "就绪，随下条消息发出"}
        </button>
        <span className="ml-auto text-[10.5px] text-muted-foreground/70">
          或直接在输入框说「派团队去…」
        </span>
      </div>
    </div>
  );
}
