"use client";

/**
 * task-08（2026-07-12-team-main-agent-orchestration / FR-8）：Stage Team 配置面板。
 *
 * execute / verify stage 的 worker 预设编辑（D-002@v2 用户预设）。
 *
 * 2026-08-12-dispatch-bind-agent-profile：每 worker 选档案（替换原手动 agent_type/model），
 * 主 agent 也选档案。worker 数量/增删交互不变（D-005@v1）。输出 StageWorkerPreset[]
 * = `{profile_id, objective, role}`，透传 backend change.stages.team_worker_preset。
 *
 * 输出（onWorkersChange）：StageWorkerPreset[]，page.tsx 透传给 backend create_mission。
 */

import { useEffect } from "react";

import { AgentProfileSelect } from "@/components/agent-profile-select";
import { Badge } from "@/components/ui/badge";

/** stage 化 worker 预设（2026-08-12：每 worker 选档案，去 agent_type/model）。 */
export interface StageWorkerPreset {
  /** 选中档案 id；null/undefined = 跟随工作区默认。 */
  profile_id?: string;
  objective: string;
  role: string;
}

/** stage 角色默认（execute→impl，verify→verify，对齐 mission-console ROLE_LABEL）。 */
const STAGE_DEFAULT_ROLE: Record<"execute" | "verify", string> = {
  execute: "impl",
  verify: "verify",
};

const STAGE_DEFAULT_OBJECTIVE: Record<"execute" | "verify", string> = {
  execute: "按变更 plan 执行任务实现",
  verify: "核验变更实现是否符合 design 与 tasks",
};

const ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "impl", label: "实现" },
  { value: "verify", label: "验证" },
  { value: "test", label: "测试" },
  { value: "arch", label: "架构分析" },
  { value: "code_style", label: "代码规范" },
  { value: "integration", label: "集成" },
  { value: "risk", label: "风险" },
] as const;

export interface StageTeamConfigProps {
  stage: "execute" | "verify";
  workers: StageWorkerPreset[];
  onWorkersChange: (next: StageWorkerPreset[]) => void;
  /** workspace id（2026-08-12：每 worker / 主 agent AgentProfileSelect 拉档案用）。 */
  workspaceId: string;
  /** 2026-08-12：主 agent 选的档案 id（由 page stageProfileId 透传，
   *  团队开关下方只读展示主 agent 用哪个档案；主 agent 选择器在 change-stage-actions 顶部统一）。 */
  mainProfileId?: string | null;
}

export function StageTeamConfig({
  stage,
  workers,
  onWorkersChange,
  workspaceId,
  mainProfileId,
}: StageTeamConfigProps) {
  // stage 切换 / 首次挂载且 workers 为空时，塞入 stage 默认 1 个 worker（D-002 用户预设雏形）。
  // 不重复初始化（workers 非空尊重用户已有编辑）。
  useEffect(() => {
    if (workers.length === 0) {
      onWorkersChange([makeDefaultWorker(stage)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const updateWorker = (idx: number, patch: Partial<StageWorkerPreset>) => {
    onWorkersChange(
      workers.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  };
  const removeWorker = (idx: number) => {
    onWorkersChange(workers.filter((_, i) => i !== idx));
  };
  const addWorker = () => {
    onWorkersChange([...workers, makeDefaultWorker(stage)]);
  };

  return (
    <div className="space-y-3 rounded-md border border-violet-200 bg-violet-50/30 p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
          👥 Stage Worker 预设（{stage === "verify" ? "验证" : "执行"}）
          <Badge variant="outline" className="ml-1 text-[10px]">
            {workers.length} 个
          </Badge>
        </div>
        <button
          type="button"
          onClick={addWorker}
          className="rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
        >
          + 添加 Worker
        </button>
      </header>

      {/* 主 agent 档案（来自顶部统一选择，此处只读展示） */}
      <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600">
        <span className="text-slate-400">主 Agent 档案：</span>
        <span className="font-medium">
          {mainProfileId ? "已选档案" : "跟随工作区默认"}
        </span>
      </div>

      {workers.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-[11px] text-slate-400">
          尚未添加 Worker。
        </p>
      )}

      <ul className="space-y-2">
        {workers.map((w, idx) => (
          <li
            key={idx}
            className="space-y-2 rounded-md border border-slate-200 bg-white p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-600">
                Worker #{idx + 1}
              </span>
              <button
                type="button"
                onClick={() => removeWorker(idx)}
                aria-label={`删除 worker ${idx + 1}`}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">Worker 档案</span>
                <AgentProfileSelect
                  workspaceId={workspaceId}
                  value={w.profile_id ?? null}
                  onChange={(v) => updateWorker(idx, { profile_id: v ?? undefined })}
                  includeDefault="跟随工作区默认"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-500">角色</span>
                <select
                  aria-label={`stage worker ${idx + 1} 角色`}
                  className="h-[32px] rounded-md border border-slate-300 bg-white px-2 text-[12.5px] text-slate-800"
                  value={w.role}
                  onChange={(e) => updateWorker(idx, { role: e.target.value })}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">分工目标</span>
              <input
                type="text"
                aria-label={`stage worker ${idx + 1} 分工目标`}
                placeholder={STAGE_DEFAULT_OBJECTIVE[stage]}
                className="h-[32px] rounded-md border border-slate-300 bg-white px-2 text-[12.5px] text-slate-800"
                value={w.objective}
                onChange={(e) =>
                  updateWorker(idx, { objective: e.target.value })
                }
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function makeDefaultWorker(stage: "execute" | "verify"): StageWorkerPreset {
  return {
    profile_id: undefined,
    objective: STAGE_DEFAULT_OBJECTIVE[stage],
    role: STAGE_DEFAULT_ROLE[stage],
  };
}
