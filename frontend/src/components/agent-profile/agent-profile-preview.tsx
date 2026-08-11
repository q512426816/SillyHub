"use client";

/**
 * AgentProfilePreview — 人设预览弹窗（纯前端只读）。
 *
 * 变更 2026-08-04-agent-profile-ui-redesign task-03 / R-05。
 *
 * 展示两段（design §7.4）：
 *  1. system_prompt 原文（<pre> 包裹，超长可纵向滚动）
 *  2. 模拟「prepend 到下发 daemon 的 CLAUDE.md 顶部」片段——纯前端拼接展示，**不调用**
 *     build_spec_bundle / 不真注入 daemon（真正写入点在 daemon 侧读取
 *     agent_profile_snapshot 后落 CLAUDE.md，见 design §7.4 v2 修正）。
 *
 * footer=null 纯只读；底部黄底 note 强调「档案只存引用，不存凭证」（design §10 红线）。
 *
 * 设计依据：tasks/task-03.md §implementation / design §7.4 / §10 R-05 / §10 红线 /
 * FRONTEND_PAGE_STYLE.md §6（antd Modal）/ §0（tailwind token）。
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal, Tag } from "antd";

import {
  VISIBILITY_LABEL,
  type AgentProfileAggregatedItem,
} from "@/lib/agent-profiles";
import { listProviders, type LlmProviderRead } from "@/lib/api/llm-providers";

export interface AgentProfilePreviewProps {
  /** 被预览的档案；为 null 时弹窗不渲染。 */
  profile: AgentProfileAggregatedItem | null;
  /** 是否展开。 */
  open: boolean;
  /** 关闭回调。 */
  onClose: () => void;
}

/**
 * 拼接「模拟 prepend 到 CLAUDE.md 顶部」片段（纯展示，不落盘）。
 *
 * 形式参考前置变更 2026-08-02-agent-profile-layer design §7 的注入语义：档案的
 * system_prompt 会作为角色人格 prepend 到下发 daemon 的 CLAUDE.md 顶部，与 spec
 * 任务上下文叠加。这里仅模拟文本形态，不触发真链路。
 */
function buildSimulatedPrepend(profile: AgentProfileAggregatedItem): string {
  const lines: string[] = [];
  lines.push(`# 智能体档案 · ${profile.name || "（未命名）"}`);
  const meta: string[] = [];
  meta.push(`供应商：${profile.provider || "—"}`);
  meta.push(`模型：${profile.model || "默认"}`);
  meta.push(`可见范围：${VISIBILITY_LABEL[profile.visibility]}`);
  meta.push(`版本：v${profile.version}`);
  lines.push(`> ${meta.join(" · ")}`);
  lines.push("");

  const mcpRefs = profile.mcp_refs ?? [];
  const skillRefs = profile.skill_refs ?? [];
  if (mcpRefs.length > 0 || skillRefs.length > 0) {
    lines.push("## 工具能力引用");
    if (mcpRefs.length > 0) {
      lines.push(`- MCP：${mcpRefs.join("、")}`);
    }
    if (skillRefs.length > 0) {
      lines.push(`- 技能：${skillRefs.join("、")}`);
    }
    lines.push("");
  }

  lines.push("## 系统提示词（agent 人格）");
  lines.push(
    profile.system_prompt && profile.system_prompt.trim()
      ? profile.system_prompt.trim()
      : "（未设置系统提示词，该档案不影响下发人格。）",
  );
  return lines.join("\n");
}

export function AgentProfilePreview({
  profile,
  open,
  onClose,
}: AgentProfilePreviewProps) {
  // task-08：绑定供应商名映射（design §4.5，复用 form/card 口径）。
  // 命中→显名，非本人（未命中）→ 回退提示，未绑→不渲染。hooks 无条件调用（规则）。
  const { data: llmProviders } = useQuery<LlmProviderRead[]>({
    queryKey: ["llm-providers", "list", "agent-profile-preview"],
    queryFn: listProviders,
    staleTime: 60_000,
  });
  const boundProviderName = useMemo(() => {
    if (!profile?.llm_provider_id) return null;
    const hit = (llmProviders ?? []).find((p) => p.id === profile.llm_provider_id);
    return hit ? hit.name : "（非本人供应商，将回退默认）";
  }, [profile?.llm_provider_id, llmProviders]);

  return (
    <Modal
      open={open && profile != null}
      onCancel={onClose}
      title="人设预览"
      width={720}
      footer={null}
      maskClosable
      destroyOnClose
    >
      {profile == null ? null : (
        <div className="flex flex-col gap-4">
          {/* 顶部档案标识 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {profile.name || "—"}
            </span>
            {profile.is_system_default && (
              <Tag color="green">系统预置</Tag>
            )}
            <Tag>{VISIBILITY_LABEL[profile.visibility]}</Tag>
            <span className="font-mono text-[11px] text-muted-foreground">
              {profile.provider}
              {profile.model ? ` / ${profile.model}` : ""} · v{profile.version}
            </span>
            {boundProviderName ? (
              <span className="text-[11px] text-muted-foreground/80">
                供应商：{boundProviderName}
              </span>
            ) : null}
          </div>

          {/* 段 1：system_prompt 原文 */}
          <section>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              系统提示词原文
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
              {profile.system_prompt && profile.system_prompt.trim()
                ? profile.system_prompt
                : "（未设置系统提示词）"}
            </pre>
          </section>

          {/* 段 2：模拟 prepend 到 CLAUDE.md 顶部片段 */}
          <section>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              模拟 prepend 到 CLAUDE.md 顶部（仅展示，不真注入）
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
              {buildSimulatedPrepend(profile)}
            </pre>
          </section>

          {/* 底部黄底 note：只存引用不存凭证 */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            档案只存「用哪些」的引用，不存任何 API Key / MCP 凭证；真正写入
            CLAUDE.md 在 daemon 侧，本预览仅模拟文本。
          </div>
        </div>
      )}
    </Modal>
  );
}
