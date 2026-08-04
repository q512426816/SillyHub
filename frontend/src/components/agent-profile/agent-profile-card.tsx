"use client";

/**
 * AgentProfileCard — 智能体档案「角色卡」（单卡）。
 *
 * 变更 2026-08-04-agent-profile-ui-redesign task-03 / D-002。
 *
 * 以卡片网格取代原 9 列表格行（design §5 P3 / §10 R-02：本卡为 FRONTEND_PAGE_STYLE
 * 表格基准的显式特例，仅限 agent-profile 目录，不外溢到其它列表页）。
 * 视觉对齐 prototype-agent-profile-redesign.html 画面① .card：
 *   - card-top：头像（按 provider 渐变取首字母 / 系统预置显 ★）+ 名称 + 系统预置 Tag
 *     + 供应商·模型 mono + 右贴可见范围 Tag（复用 VISIBILITY_LABEL/VISIBILITY_TAG_COLOR）
 *   - prompt：system_prompt 摘要 line-clamp-2 截断
 *   - abilities：mcp_refs + skill_refs 逐项 chip（design §7.2 能力展示）
 *   - card-foot：版本号 + workspace_name + 操作（编辑/复制/删除 link）/ 系统预置显「只读」
 *
 * 系统预置档案（is_system_default=true）：不显可见范围 Tag（它属平台级），名称旁加
 * 「系统预置」green Tag，操作区改显「只读」灰字，无编辑/复制/删除按钮（后端拒改拒删）。
 *
 * 设计依据：tasks/task-03.md §implementation / design §7.2 组件签名 / §10 R-02 /
 * FRONTEND_PAGE_STYLE.md §0（antd + tailwind token，不硬编码 hex）/ §5（操作列 link）/ §7（Tag color）。
 */
import { Button, Tag } from "antd";

import { SectionCard } from "@/components/layout/section-card";
import {
  VISIBILITY_LABEL,
  VISIBILITY_TAG_COLOR,
  type AgentProfileAggregatedItem,
} from "@/lib/agent-profiles";
import { cn } from "@/lib/utils";

/**
 * provider → 头像渐变 tailwind class（对齐原型 .av-claude/.av-codex/.av-default/.av-test）。
 * 未知 provider 走 default 琥珀渐变。tailwind 渐变色 token，非硬编码 hex（FRONTEND_PAGE_STYLE §0）。
 */
const AVATAR_GRADIENT_BY_PROVIDER: Record<string, string> = {
  claude: "bg-gradient-to-br from-blue-500 to-cyan-400",
  codex: "bg-gradient-to-br from-emerald-500 to-emerald-600",
  test: "bg-gradient-to-br from-violet-500 to-indigo-500",
};
const DEFAULT_AVATAR_GRADIENT =
  "bg-gradient-to-br from-amber-500 to-amber-600";

/** 取名称首字符作头像字母；空名兜底「?」。拉丁字母大写，中文取首字。 */
function avatarGlyph(name: string): string {
  if (!name) return "?";
  const ch = name.trim().charAt(0);
  if (!ch) return "?";
  // Latin 字母转大写；中文/其它字符原样返回。
  return /^[A-Za-z]$/.test(ch) ? ch.toUpperCase() : ch;
}

/** 供应商·模型 mono 文案：有模型显「provider / model」，否则只显 provider。 */
function modelLine(provider: string, model: string | null | undefined): string {
  if (!provider && !model) return "—";
  if (!model) return provider;
  return `${provider} / ${model}`;
}

export interface AgentProfileCardProps {
  /** 档案聚合项（AgentProfileAggregatedItem；workspace 级页传 AgentProfileRead 亦可，结构兼容）。 */
  profile: AgentProfileAggregatedItem;
  /** 点卡片主体（非操作按钮）触发——打开人设预览。 */
  onPreview: (profile: AgentProfileAggregatedItem) => void;
  /** 编辑（系统预置不渲染该按钮，回调不会触发）。 */
  onEdit: (profile: AgentProfileAggregatedItem) => void;
  /** 复制（系统预置不渲染该按钮）。 */
  onCopy: (profile: AgentProfileAggregatedItem) => void;
  /** 删除（系统预置不渲染该按钮）。 */
  onDelete: (profile: AgentProfileAggregatedItem) => void;
}

/**
 * 角色卡。整卡可点（onPreview）；操作按钮独立 stopPropagation 避免触发预览。
 */
export function AgentProfileCard({
  profile,
  onPreview,
  onEdit,
  onCopy,
  onDelete,
}: AgentProfileCardProps) {
  const isSystem = profile.is_system_default === true;
  const avatarGradient =
    AVATAR_GRADIENT_BY_PROVIDER[profile.provider] ?? DEFAULT_AVATAR_GRADIENT;

  const promptText =
    profile.system_prompt && profile.system_prompt.trim()
      ? profile.system_prompt.trim()
      : "（未设置系统提示词）";

  // 能力 chip：mcp_refs + skill_refs 逐项（task-03 §implementation）。
  const mcpRefs = profile.mcp_refs ?? [];
  const skillRefs = profile.skill_refs ?? [];

  const footMeta = `v${profile.version}${
    profile.workspace_name ? ` · ${profile.workspace_name}` : ""
  }`;

  return (
    <SectionCard
      hover="lift"
      bodyPadding="p-0"
      role="button"
      tabIndex={0}
      className="cursor-pointer"
      onClick={() => onPreview(profile)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPreview(profile);
        }
      }}
    >
      {/* card-top：头像 + 名称/模型 + 可见范围 */}
      <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <div
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[10px] text-sm font-bold text-white",
            avatarGradient,
          )}
          aria-hidden
        >
          {isSystem ? "★" : avatarGlyph(profile.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {profile.name || "—"}
            </span>
            {isSystem && <Tag color="green">系统预置</Tag>}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {modelLine(profile.provider, profile.model)}
          </div>
        </div>
        {!isSystem && (
          <Tag
            color={VISIBILITY_TAG_COLOR[profile.visibility]}
            className="ml-auto"
          >
            {VISIBILITY_LABEL[profile.visibility]}
          </Tag>
        )}
      </div>

      {/* prompt 摘要（line-clamp-2） */}
      <div className="mx-3.5 mb-2.5 line-clamp-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-slate-600">
        {promptText}
      </div>

      {/* abilities chips（mcp + skill refs） */}
      {mcpRefs.length + skillRefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
          {mcpRefs.map((ref) => (
            <span
              key={`mcp-${ref}`}
              className="rounded bg-muted px-2 py-0.5 text-[11px] text-slate-600"
            >
              {ref || "—"}
            </span>
          ))}
          {skillRefs.map((ref) => (
            <span
              key={`skill-${ref}`}
              className="rounded bg-muted px-2 py-0.5 text-[11px] text-slate-600"
            >
              {ref || "—"}
            </span>
          ))}
        </div>
      )}

      {/* card-foot：版本 + workspace_name + 操作 / 只读 */}
      <div className="flex items-center justify-between border-t border-dashed border-border px-3.5 py-2">
        <span className="truncate text-[11px] text-muted-foreground">
          {footMeta}
        </span>
        {isSystem ? (
          <span className="text-[11px] italic text-muted-foreground">只读</span>
        ) : (
          <div className="flex shrink-0 gap-0.5">
            <Button
              type="link"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(profile);
              }}
            >
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onCopy(profile);
              }}
            >
              复制
            </Button>
            <Button
              type="link"
              size="small"
              danger
              onClick={(e) => {
                e.stopPropagation();
                onDelete(profile);
              }}
            >
              删除
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
