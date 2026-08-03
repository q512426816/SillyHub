"use client";

/**
 * AgentProfileSelect — 智能体档案下拉选择（task-12，变更
 * 2026-08-02-agent-profile-layer）。
 *
 * 用于「发起任务/对话」入口选择本 run 用哪个 AgentProfile。形态对齐
 * AgentProviderSelect（受控、自取数据、native <select>、h-8 同款样式），便于在
 * 任务详情页「分配给 Agent」表单里与 AgentProviderSelect / AgentModelInput 并排
 * 摆放（prototype 画面②）。
 *
 * 行为：
 *  - 数据来自 useWorkspaceAgentProfiles（workspace 可见：private+workspace+platform）
 *    与 usePlatformAgentProfiles（含系统预置默认档案）合并去重。
 *  - 含「不指定，用默认」兜底项（value="" → onChange(null)）。选 null 时后端走兜底
 *    链（design §8：run 显式 → workspace 默认 → 平台默认 → 无 profile 原路径），
 *    绝不因没绑档案卡住任务。
 *  - value 指向已删除/不可见档案时（如被 admin 删了），仍单独渲染该项并标「（已失效）」
 *    保证用户可识别（对齐 AgentProviderSelect 离线回退）。
 *  - 数据加载失败退化为仅兜底项，不崩。
 *
 * 注：value/onChange 传 profile.id（UUID）。当前后端 run/mission 建链 DTO 尚未接
 * agent_profile_id（见 task 报告「发起任务入口集成」gap），本组件先做成 drop-in
 * 就绪，后端 schema 落地后即可在挂载点直接生效。
 */
import { useMemo } from "react";

import {
  NO_PROFILE_VALUE,
  VISIBILITY_LABEL,
  usePlatformAgentProfiles,
  useWorkspaceAgentProfiles,
  type AgentProfileRead,
} from "@/lib/agent-profiles";
import { cn } from "@/lib/utils";

interface AgentProfileSelectProps {
  /** workspace id（拉 workspace 级可见档案用）。 */
  workspaceId: string;
  /** 当前选中的 profile id；null/undefined/空串 → 兜底项。 */
  value: string | null;
  /** 选中变化回调；兜底项 → null。 */
  onChange: (profileId: string | null) => void;
  /** 兜底项文案，默认「不指定，用默认」。 */
  includeDefault?: string;
  /** 禁用。 */
  disabled?: boolean;
  className?: string;
}

const DEFAULT_CLS =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

export function AgentProfileSelect({
  workspaceId,
  value,
  onChange,
  includeDefault = "不指定，用默认",
  disabled,
  className,
}: AgentProfileSelectProps) {
  const { profiles: wsProfiles } = useWorkspaceAgentProfiles(workspaceId);
  const { profiles: platformProfiles } = usePlatformAgentProfiles();

  // workspace 可见 ∪ platform（含系统预置默认），按 id 去重，workspace 优先。
  const profiles = useMemo(() => {
    const map = new Map<string, AgentProfileRead>();
    for (const p of platformProfiles) map.set(p.id, p);
    for (const p of wsProfiles) map.set(p.id, p);
    // 排序：系统预置默认置顶，其次按名称，让下拉稳定易找。
    return Array.from(map.values()).sort((a, b) => {
      if (a.is_system_default !== b.is_system_default) {
        return a.is_system_default ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
  }, [wsProfiles, platformProfiles]);

  // value 指向不在列表的档案（被删/不可见）→ 追加渲染并标注「（已失效）」。
  const valueInvalid =
    value && value !== NO_PROFILE_VALUE && !profiles.some((p) => p.id === value)
      ? value
      : null;

  const renderOption = (p: AgentProfileRead) => {
    const parts: string[] = [p.name];
    // 供应商/模型提示（参考 prototype 画面②：「代码审查助手 (claude/sonnet · 只读)」）。
    if (p.provider) parts.push(`(${p.provider}${p.model ? `/${p.model}` : ""})`);
    if (p.is_system_default) parts.push("· 系统预置");
    else parts.push(`· ${VISIBILITY_LABEL[p.visibility]}`);
    return (
      <option key={p.id} value={p.id}>
        {parts.join(" ")}
      </option>
    );
  };

  return (
    <select
      value={value ?? NO_PROFILE_VALUE}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === NO_PROFILE_VALUE ? null : v);
      }}
      className={cn(DEFAULT_CLS, className)}
    >
      {includeDefault ? (
        <option value={NO_PROFILE_VALUE}>{includeDefault}</option>
      ) : null}
      {profiles.map(renderOption)}
      {valueInvalid ? (
        <option value={valueInvalid}>
          （已失效）{valueInvalid.slice(0, 8)}
        </option>
      ) : null}
    </select>
  );
}
