// frontend/src/components/group-chat/member-config-fields.tsx
// 2026-11-02-group-member-footer-config：群成员配置块四选共享子组件——
// 供应商 / 模型（级联）/ 思考等级 / 档案，口径与会话底部配置条
//（sessions/session-config-bar.tsx）同源：
//   - 模型候选 = 所选供应商 models 条目名（sonnet 角色主模型置顶）去重保序
//     + 首项「默认（跟随供应商配置）」（镜像 session-config-bar modelCandidates，
//     不做上游 /v1/models 实时拉取，D-002 同口径）；
//   - 思考等级 = THINKING_LEVEL_OPTIONS 七档镜像（唯一维护源
//     sillyhub-daemon/src/interactive/thinking-levels.ts，两侧注释互指），
//     按引擎 caps.thinking_level 门控；
//   - 档案 = useMineAgentProfiles（AgentProfile 下拉，原「智能体方案」更名）。
// 三个消费表面：添加 Agent 对话框 / 建群向导第三步成员卡 / 切换配置弹窗
//（member-panel.tsx ×2 + create-group-wizard.tsx）。

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";

import { THINKING_LEVEL_OPTIONS, thinkingLevelLabel } from "@/components/sessions/session-config-bar";
import { useMineAgentProfiles } from "@/lib/agent-profiles";
import { listProviders, noProviderLabel } from "@/lib/api/llm-providers";
import { getProviderCaps } from "@/lib/provider-caps";

// 档位中文标签展示同源再导出（成员卡片「思考等级」行消费）。
export { thinkingLevelLabel };

/** 成员四选值（""=各维默认态：供应商=本机默认、模型=跟随供应商配置、
 * 思考等级=引擎默认、档案=不指定）。 */
export interface MemberConfigValue {
  llmProviderId: string;
  model: string;
  thinkingLevel: string;
  agentProfileId: string;
}

export const MEMBER_MODEL_DEFAULT_VALUE = "";
export const MEMBER_THINKING_DEFAULT_VALUE = "";

const MEMBER_MODEL_DEFAULT_LABEL = "默认（跟随供应商配置）";
const MEMBER_THINKING_DEFAULT_LABEL = "引擎默认";

interface MemberConfigFieldsProps {
  /** 成员引擎（claude/codex/pi）：供应商/模型/思考等级的可用性门控来源。 */
  engine: string;
  value: MemberConfigValue;
  /** 任一维变更上抛（级联重置模型已在此组件内处理：换供应商 → model 归 ""）。 */
  onChange: (next: MemberConfigValue) => void;
  /** 切换弹窗回显兜底：成员现绑供应商/方案 id 不在候选列表时补「当前」项。 */
  memberLlmProviderId?: string | null;
  memberAgentProfileId?: string | null;
  /** Select id 前缀（同屏多实例防 id 冲突——向导多卡片传 `cgw-member-${idx}`）。 */
  idPrefix?: string;
}

export function MemberConfigFields({
  engine,
  value,
  onChange,
  memberLlmProviderId,
  memberAgentProfileId,
  idPrefix = "member-config",
}: MemberConfigFieldsProps) {
  const providersQ = useQuery({
    queryKey: ["llmProviders", "member-config-fields"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const { profiles } = useMineAgentProfiles();

  const providers = providersQ.data ?? [];
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === value.llmProviderId) ?? null,
    [providers, value.llmProviderId],
  );

  // 供应商下拉（codex 等「本机模型配置」引擎禁用，与既有三表面降级语义一致）。
  const providerOptions = useMemo(() => {
    const opts = providers.map((p) => ({ value: p.id, label: p.name }));
    if (
      memberLlmProviderId &&
      !opts.some((o) => o.value === memberLlmProviderId)
    ) {
      opts.unshift({
        value: memberLlmProviderId,
        label: `${memberLlmProviderId.slice(0, 8)}（当前）`,
      });
    }
    opts.unshift({ value: "", label: noProviderLabel(providers) });
    return opts;
  }, [providers, memberLlmProviderId]);

  // 模型候选（镜像 session-config-bar modelCandidates：供应商 models 条目名、
  // sonnet 角色主模型置顶、去重保序；首项「默认」固定在选项渲染处）。
  const modelCandidates = useMemo(() => {
    if (!selectedProvider) return [] as string[];
    const entries = selectedProvider.models ?? [];
    const primaryIdx = entries.findIndex((m) => m.roles?.includes("sonnet"));
    const ordered =
      primaryIdx > 0
        ? [entries[primaryIdx], ...entries.filter((_, i) => i !== primaryIdx)]
        : entries;
    const seen = new Set<string>();
    const models: string[] = [];
    for (const m of ordered) {
      const name = m?.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      models.push(name);
    }
    return models;
  }, [selectedProvider]);

  const modelOptions = useMemo(() => {
    const base = value.model && !modelCandidates.includes(value.model)
      ? [...modelCandidates, value.model]
      : modelCandidates;
    return [{ value: MEMBER_MODEL_DEFAULT_VALUE, label: MEMBER_MODEL_DEFAULT_LABEL }, ...base.map((m) => ({ value: m, label: m }))];
  }, [modelCandidates, value.model]);

  // 思考等级：caps 门控（cursor/未知引擎不渲染下拉，仅提示文案——照 footer 口径）。
  const thinkingEnabled = getProviderCaps(engine).thinking_level;
  const thinkingOptions = useMemo(
    () => [
      { value: MEMBER_THINKING_DEFAULT_VALUE, label: MEMBER_THINKING_DEFAULT_LABEL },
      ...THINKING_LEVEL_OPTIONS.map((o) => ({ ...o })),
    ],
    [],
  );

  // 档案下拉（AgentProfile；现绑定不在列表时补「当前」兜底项）。
  const profileOptions = useMemo(() => {
    const opts = profiles.map((p) => ({ value: p.id, label: p.name }));
    if (
      memberAgentProfileId &&
      !opts.some((o) => o.value === memberAgentProfileId)
    ) {
      opts.unshift({
        value: memberAgentProfileId,
        label: `${memberAgentProfileId.slice(0, 8)}（当前）`,
      });
    }
    opts.unshift({ value: "", label: "不指定，用默认" });
    return opts;
  }, [profiles, memberAgentProfileId]);

  const engineDisabled = engine !== "claude";

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">供应商</span>
        <Select
          id={`${idPrefix}-provider`}
          aria-label="成员供应商"
          className="w-full"
          placeholder={providerOptions[0]?.label ?? "不指定（本机默认）"}
          allowClear
          value={value.llmProviderId || undefined}
          onChange={(v) =>
            // 换供应商级联重置模型（footer 同口径：模型候选跟随供应商）。
            onChange({ ...value, llmProviderId: v ?? "", model: "" })
          }
          disabled={engineDisabled}
          options={providerOptions}
        />
        {engineDisabled && (
          <span className="text-[11px] text-muted-foreground">
            Codex 引擎使用其本机模型配置，无需选择供应商
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">模型</span>
        <Select
          id={`${idPrefix}-model`}
          aria-label="成员模型"
          className="w-full"
          placeholder={MEMBER_MODEL_DEFAULT_LABEL}
          value={value.model || MEMBER_MODEL_DEFAULT_VALUE}
          onChange={(v) => onChange({ ...value, model: v ?? "" })}
          disabled={engineDisabled || !value.llmProviderId}
          options={modelOptions}
        />
        {!value.llmProviderId && !engineDisabled && (
          <span className="text-[11px] text-muted-foreground">
            先选供应商后可选具体模型；不选=跟随供应商配置
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">思考等级</span>
        {thinkingEnabled ? (
          <Select
            id={`${idPrefix}-thinking`}
            aria-label="成员思考等级"
            className="w-full"
            placeholder={MEMBER_THINKING_DEFAULT_LABEL}
            value={value.thinkingLevel || MEMBER_THINKING_DEFAULT_VALUE}
            onChange={(v) => onChange({ ...value, thinkingLevel: v ?? "" })}
            options={thinkingOptions}
          />
        ) : (
          <Select
            id={`${idPrefix}-thinking`}
            aria-label="成员思考等级"
            className="w-full"
            value={MEMBER_THINKING_DEFAULT_VALUE}
            disabled
            options={[
              { value: MEMBER_THINKING_DEFAULT_VALUE, label: "当前引擎不支持思考等级" },
            ]}
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          档案（人格 / 工具集 / 技能）
        </span>
        <Select
          id={`${idPrefix}-profile`}
          aria-label="成员档案"
          className="w-full"
          placeholder="不指定，用默认"
          allowClear
          showSearch
          optionFilterProp="label"
          value={value.agentProfileId || undefined}
          onChange={(v) => onChange({ ...value, agentProfileId: v ?? "" })}
          options={profileOptions}
        />
      </div>
    </>
  );
}
