"use client";

/**
 * AgentProfileForm — 智能体档案新建/编辑表单（双栏预览版）。
 *
 * 变更 2026-08-04-agent-profile-ui-redesign task-04（重做）：
 *  - 宽弹窗(~900px) 双栏：左栏填字段、右栏实时预览角色卡（Form.useWatch 订阅，
 *    无后端往返）。右栏预览为内联简化卡，不依赖 task-03 的 AgentProfileCard。
 *  - 全局页（workspaceId 缺省）首字段「工作区上下文」选择器（D-006）：
 *    数据源 listWorkspaces()；visibility=workspace→该 ws 即归属，visibility=
 *    private/platform→仅作 sourcing，workspace_id 由后端按 visibility 决定
 *    （service.create PRIVATE/PLATFORM→ws_id=None，已核实）。
 *  - 字段三组与 8 字段完全不变（身份/大脑/能力），toCreateBody/toUpdateBody 行为
 *    兼容（不引入 workspace_id 进 body，归属由 URL wid + visibility 决定）。
 *
 * 原始实现：task-12 / 变更 2026-08-02-agent-profile-layer（D-011 三组）。
 *
 * 红线（design §10）：不存任何 API Key / MCP 凭证——只存「用哪些」的引用。MCP 引用
 *所选工作区 .mcp.json 的 server 名（env 已脱敏），技能引用当前用户技能池。
 *
 * 遵循 FRONTEND_PAGE_STYLE.md §6：antd Modal（不用 Drawer）+ Form layout="vertical"
 * + maskClosable=false + destroyOnClose；保存 primary+loading，取消 default；校验内联。
 * 双栏布局为本页显式特例（design §10 R-02 / D-003）。
 *
 * 类型从 api-types.ts（规则 20）：Create/Update body 用 lib/agent-profiles 透传的
 * AgentProfileCreate / AgentProfileUpdate。
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  Tag,
  type FormInstance,
} from "antd";

import { PROVIDER_META } from "@/lib/daemon";
import {
  useCreateAgentProfile,
  useUpdateAgentProfile,
  useWorkspaceToolPolicies,
  VISIBILITY_LABEL,
  VISIBILITY_TAG_COLOR,
  type AgentProfileCreate,
  type AgentProfileRead,
  type AgentProfileUpdate,
  type AgentProfileVisibility,
} from "@/lib/agent-profiles";
import { useWorkspaceMcpConfig } from "@/lib/workspace-skills-view";
import {
  useCustomSkills,
  usePlatformSkillsManifest,
} from "@/lib/custom-skills";
import { listWorkspaces, type Workspace } from "@/lib/workspaces";
import { listProviders, type LlmProviderRead } from "@/lib/api/llm-providers";
import { useNotify } from "@/lib/errors";

interface AgentProfileFormProps {
  /** create=新建空白表单；edit=编辑既有档案（需传 profile）。 */
  mode: "create" | "edit";
  /**
   * 工作区内页路由携带的 workspaceId。全局页（/agent-profiles）不传——此时表单
   * 顶部渲染「工作区上下文」选择器，由用户选定的 ws 决定 sourcing 与归属（D-006）。
   */
  workspaceId?: string;
  /** edit 模式必传（被编辑的档案）；create 模式忽略。 */
  profile?: AgentProfileRead | null;
  onClose: () => void;
}

/**
 * 表单内部扁平状态（antd Form 字段值）。各字段与 DTO 对齐：
 *  - tool_policy_id：空串=不引用（null）。
 *  - mcp_refs / skill_refs：字符串数组。
 *
 * 注意：contextWorkspaceId 不入表单值（避免污染 toCreateBody/toUpdateBody 与
 * ProfileFormValues 类型），作为 React state 单独管理。
 */
interface ProfileFormValues {
  name: string;
  visibility: AgentProfileVisibility;
  provider: string;
  /** 绑定的 /settings/providers 供应商 id；null=不绑定（用默认）。 */
  llm_provider_id?: string | null;
  model?: string;
  system_prompt?: string;
  tool_policy_id?: string;
  mcp_refs?: string[];
  skill_refs?: string[];
}

const VISIBILITY_OPTIONS: {
  value: AgentProfileVisibility;
  label: string;
}[] = [
  { value: "private", label: "个人（仅创建者可用）" },
  { value: "workspace", label: "工作区（本工作区成员可用）" },
  { value: "platform", label: "平台（全平台共享，需 admin）" },
];

/** provider 下拉选项：取 PROVIDER_META 已知键 + 编辑态遇到未知 provider 时追加。 */
function buildProviderOptions(current?: string | null) {
  const known = Object.keys(PROVIDER_META).map((k) => ({
    value: k,
    label: PROVIDER_META[k]?.label ?? k,
  }));
  if (current && !PROVIDER_META[current]) {
    known.push({ value: current, label: current });
  }
  return known;
}

/** 把表单扁平值组装成 Create body（必填字段补齐）。导出供单测。 */
export function toCreateBody(v: ProfileFormValues): AgentProfileCreate {
  return {
    name: v.name.trim(),
    visibility: v.visibility,
    provider: v.provider,
    llm_provider_id: v.llm_provider_id ?? null,
    model: v.model?.trim() ? v.model.trim() : null,
    system_prompt: v.system_prompt?.trim() ? v.system_prompt.trim() : null,
    tool_policy_id: v.tool_policy_id ? v.tool_policy_id : null,
    mcp_refs: v.mcp_refs ?? [],
    skill_refs: v.skill_refs ?? [],
  };
}

/** 把表单扁平值组装成 Update body（全字段可选；显式 null=清空）。导出供单测。 */
export function toUpdateBody(v: ProfileFormValues): AgentProfileUpdate {
  return {
    name: v.name.trim(),
    visibility: v.visibility,
    provider: v.provider,
    llm_provider_id: v.llm_provider_id ?? null,
    model: v.model?.trim() ? v.model.trim() : null,
    system_prompt: v.system_prompt?.trim() ? v.system_prompt.trim() : null,
    tool_policy_id: v.tool_policy_id ? v.tool_policy_id : null,
    mcp_refs: v.mcp_refs ?? [],
    skill_refs: v.skill_refs ?? [],
  };
}

/** 编辑态从 profile 读初值。 */
function profileToInitial(
  p: AgentProfileRead | null | undefined,
): Partial<ProfileFormValues> {
  if (!p) return { visibility: "private", provider: "claude", mcp_refs: [], skill_refs: [] };
  return {
    name: p.name,
    visibility: p.visibility,
    provider: p.provider,
    llm_provider_id: p.llm_provider_id ?? null,
    model: p.model ?? "",
    system_prompt: p.system_prompt ?? "",
    tool_policy_id: p.tool_policy_id ?? "",
    mcp_refs: p.mcp_refs ?? [],
    skill_refs: p.skill_refs ?? [],
  };
}

/** 头像背景渐变（按 provider 取色，未知 provider 走默认琥珀）。 */
function avatarGradient(provider?: string): string {
  switch (provider) {
    case "claude":
      return "linear-gradient(135deg,#2563EB,#06b6d4)";
    case "codex":
      return "linear-gradient(135deg,#10b981,#059669)";
    case "gemini":
      return "linear-gradient(135deg,#06b6d4,#3b82f6)";
    default:
      return "linear-gradient(135deg,#f59e0b,#d97706)";
  }
}

export function AgentProfileForm({
  mode,
  workspaceId,
  profile,
  onClose,
}: AgentProfileFormProps) {
  const isEdit = mode === "edit" && profile != null;
  const notify = useNotify();

  // ── 工作区上下文（D-006）──
  // routeWorkspaceId：工作区内页路由携带（有则不显示选择器）。
  // contextWorkspaceId：全局页用户选择的 ws（state，不入表单值）。
  const routeWorkspaceId = workspaceId;
  const isGlobalPage = !routeWorkspaceId;
  const isEditNoWs = isEdit && !profile?.workspace_id; // private/platform 档案无归属 ws
  const showContextSelector =
    isGlobalPage && (mode === "create" || isEditNoWs);
  const selectorRequired = showContextSelector && mode === "create";

  const [contextWorkspaceId, setContextWorkspaceId] = useState<string>("");

  // 工作区列表（仅在选择器可见时拉取，workspace-switcher 同源 listWorkspaces）。
  const wsListQuery = useQuery<Workspace[], Error>({
    queryKey: ["workspaces", "list", "agent-profile-form"],
    queryFn: async () => (await listWorkspaces()).items ?? [],
    enabled: showContextSelector,
    staleTime: 60_000,
  });
  const workspaceOptions = useMemo(
    () =>
      (wsListQuery.data ?? []).map((w) => ({
        value: w.id,
        label: w.name,
      })),
    [wsListQuery.data],
  );

  // 编辑态 private/platform（无归属 ws）→ sourcing 用「参考工作区」，默认首个可见 ws。
  useEffect(() => {
    if (!showContextSelector || selectorRequired) return;
    if (contextWorkspaceId) return;
    const firstId = (wsListQuery.data ?? [])[0]?.id;
    if (firstId) setContextWorkspaceId(firstId);
  }, [
    showContextSelector,
    selectorRequired,
    contextWorkspaceId,
    wsListQuery.data,
  ]);

  // 有效 sourcing/归属 ws：路由 ws > 编辑态 profile.workspace_id > 用户所选上下文 ws。
  const effectiveWsId =
    routeWorkspaceId ?? profile?.workspace_id ?? contextWorkspaceId ?? "";

  const createProfile = useCreateAgentProfile(effectiveWsId);
  const updateProfile = useUpdateAgentProfile(effectiveWsId);
  const submitting = createProfile.isPending || updateProfile.isPending;

  // ③ 工具能力 · user-scoped 部分（技能池，与 ws 无关）。
  const { skills: customSkills } = useCustomSkills();
  const { manifest } = usePlatformSkillsManifest();

  const skillOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of customSkills) set.add(s.name);
    for (const s of manifest?.skills ?? []) set.add(s.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customSkills, manifest]);

  const providerOptions = useMemo(
    () => buildProviderOptions(profile?.provider),
    [profile?.provider],
  );

  const systemDefaultReadonly = profile?.is_system_default === true;
  // 全局页新建未选工作区上下文 → 禁用保存（acceptance：未选时禁用保存）。
  const contextMissing = selectorRequired && !effectiveWsId;

  return (
    <AgentProfileModal
      isEdit={isEdit}
      submitting={submitting}
      initial={profileToInitial(profile)}
      providerOptions={providerOptions}
      skillOptions={skillOptions}
      effectiveWsId={effectiveWsId}
      showContextSelector={showContextSelector}
      selectorRequired={selectorRequired}
      isEditNoWsRef={isEditNoWs && isGlobalPage}
      workspaceOptions={workspaceOptions}
      wsListLoading={wsListQuery.isLoading}
      contextWorkspaceId={contextWorkspaceId}
      onContextWorkspaceIdChange={setContextWorkspaceId}
      systemDefaultReadonly={systemDefaultReadonly}
      saveDisabled={contextMissing}
      profileVersion={profile?.version}
      onCancel={onClose}
      onSubmit={async (v) => {
        try {
          if (isEdit && profile) {
            const updated = await updateProfile.mutateAsync({
              profileId: profile.id,
              body: toUpdateBody(v),
            });
            notify.success(`档案「${updated.name}」已更新`);
          } else {
            const created = await createProfile.mutateAsync(toCreateBody(v));
            notify.success(`档案「${created.name}」已创建`);
          }
          onClose();
        } catch (err) {
          notify.error(err, isEdit ? "更新档案失败" : "创建档案失败");
        }
      }}
    />
  );
}

/* ────────────────────── 纯展示 Modal（便于单测，业务 hooks 在外层） ────────────────────── */

interface AgentProfileModalProps {
  isEdit: boolean;
  submitting: boolean;
  initial: Partial<ProfileFormValues>;
  providerOptions: { value: string; label: string }[];
  skillOptions: string[];
  /** 当前生效的 sourcing/归属 ws（空串=全局页新建尚未选上下文）。 */
  effectiveWsId: string;
  showContextSelector: boolean;
  selectorRequired: boolean;
  /** 编辑态 private/platform 档案，选择器作「参考工作区」用途。 */
  isEditNoWsRef: boolean;
  workspaceOptions: { value: string; label: string }[];
  wsListLoading: boolean;
  contextWorkspaceId: string;
  onContextWorkspaceIdChange: (id: string) => void;
  /** 系统预置档案：编辑态只读（后端拒改，前端禁用关键字段）。 */
  systemDefaultReadonly: boolean;
  saveDisabled: boolean;
  profileVersion?: number;
  onCancel: () => void;
  onSubmit: (v: ProfileFormValues) => Promise<void>;
}

function AgentProfileModal({
  isEdit,
  submitting,
  initial,
  providerOptions,
  skillOptions,
  effectiveWsId,
  showContextSelector,
  selectorRequired,
  isEditNoWsRef,
  workspaceOptions,
  wsListLoading,
  contextWorkspaceId,
  onContextWorkspaceIdChange,
  systemDefaultReadonly,
  saveDisabled,
  profileVersion,
  onCancel,
  onSubmit,
}: AgentProfileModalProps) {
  const [formInst] = Form.useForm<ProfileFormValues>();
  // 大脑区第二层「供应商配置」联动：按第一层引擎过滤 LlmProvider.agent_kind。
  const engineProvider = Form.useWatch("provider", formInst) ?? "claude";

  // Modal 由父组件条件渲染打开，每次打开新 mount，Form 干净，setFieldsValue 填初值。
  useEffect(() => {
    formInst.setFieldsValue({
      visibility: "private",
      provider: "claude",
      mcp_refs: [],
      skill_refs: [],
      tool_policy_id: "",
      ...initial,
    } as ProfileFormValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const handleSave = async (form: FormInstance<ProfileFormValues>) => {
    if (submitting) return;
    try {
      const values = (await form.validateFields()) as ProfileFormValues;
      await onSubmit(values);
    } catch (err) {
      // antd Form 校验失败（errorFields）已由 Form.Item 内联提示；其它错误上抛。
      if (err && typeof err === "object" && "errorFields" in err) return;
      throw err;
    }
  };

  const visibilityLocked =
    systemDefaultReadonly || (isEdit && initial.visibility === "platform");

  return (
    <Modal
      open
      onCancel={onCancel}
      title={isEdit ? "编辑智能体档案" : "新建智能体档案"}
      width={900}
      maskClosable={false}
      destroyOnClose
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={(systemDefaultReadonly && !isEdit) || saveDisabled}
            onClick={() => void handleSave(formInst)}
          >
            保存
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-[1.15fr_1fr]">
        {/* 左栏：表单字段 ─────────────────────────── */}
        <div className="max-h-[68vh] overflow-y-auto border-r border-border px-5 py-1">
          <Form<ProfileFormValues>
            form={formInst}
            layout="vertical"
            preserve={false}
            disabled={systemDefaultReadonly}
          >
            {/* 工作区上下文（仅全局页显示，D-006） */}
            {showContextSelector && (
              <Form.Item
                label={
                  isEditNoWsRef
                    ? "参考工作区（MCP / 工具策略 sourcing）"
                    : "工作区上下文"
                }
                required={selectorRequired}
                tooltip={
                  isEditNoWsRef
                    ? "该档案无归属工作区（个人/平台级），此处仅用于拉取 MCP server 与工具策略选项。"
                    : "visibility=工作区 时此工作区即档案归属；visibility=个人/平台 时仅用于 MCP/工具策略 sourcing，workspace_id 由后端按 visibility 决定（个人/平台→null）。"
                }
              >
                <Select
                  value={contextWorkspaceId || undefined}
                  placeholder={
                    selectorRequired ? "请选择工作区上下文" : "选择工作区…"
                  }
                  options={workspaceOptions}
                  onChange={onContextWorkspaceIdChange}
                  showSearch
                  optionFilterProp="label"
                  notFoundContent={
                    wsListLoading ? "加载工作区…" : "暂无可见工作区"
                  }
                />
              </Form.Item>
            )}

            {/* ① 身份 */}
            <FormSectionHeader
              index="①"
              title="身份"
              desc="给这个智能体起个名字，并决定谁能看到它。"
            />
            <div className="grid grid-cols-2 gap-3">
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: "档案名称为必填项" }]}
              >
                <Input placeholder="例如 代码审查助手" maxLength={64} />
              </Form.Item>
              <Form.Item
                name="visibility"
                label="可见范围"
                rules={[{ required: true, message: "请选择可见范围" }]}
              >
                <Select
                  disabled={visibilityLocked}
                  options={VISIBILITY_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                />
              </Form.Item>
            </div>

            {/* ② 大脑 */}
            <FormSectionHeader
              index="②"
              title="大脑"
              desc="选哪台 daemon 执行、用什么模型、注入什么人设。"
            />
            <div className="grid grid-cols-2 gap-3">
              <Form.Item
                name="provider"
                label="智能体引擎"
                tooltip="决定在所选机器上用哪个 agent 程序跑（Claude Code / Codex）。"
                rules={[{ required: true, message: "请选择智能体引擎" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={providerOptions}
                  placeholder="选择智能体引擎"
                />
              </Form.Item>
              <Form.Item name="model" label="模型">
                <Input placeholder="例如 claude-sonnet-4（留空用供应商默认）" />
              </Form.Item>
            </div>
            <Form.Item
              name="llm_provider_id"
              label="供应商配置（可选，不绑定用默认）"
              tooltip="绑定 /settings/providers 里配置的供应商，任务启动优先用它的凭证；不绑定则用你的默认供应商。codex 暂未开放。"
            >
              <LlmProviderSelect engineProvider={engineProvider} />
            </Form.Item>
            <Form.Item
              name="system_prompt"
              label="系统提示词（agent 人格，与 spec 任务上下文叠加）"
              tooltip="这段会 prepend 到下发 daemon 的 CLAUDE.md 顶部（design §7）。留空则不影响。"
            >
              <Input.TextArea
                rows={3}
                placeholder="例如：你是资深代码审查员，只读不改，关注安全/性能/可维护性…"
              />
            </Form.Item>

            {/* ③ 工具能力 */}
            <FormSectionHeader
              index="③"
              title="工具能力"
              desc="引用哪些工具策略、MCP server 与技能（只存引用，不存凭证）。"
            />
            {effectiveWsId ? (
              <WorkspaceAbilityOptions workspaceId={effectiveWsId} />
            ) : (
              <p className="rounded border border-dashed border-border bg-muted/30 px-3 py-3 text-[11px] text-muted-foreground">
                请先选择上方「工作区上下文」，工具策略与 MCP 选项将按该工作区加载。
              </p>
            )}
            <Form.Item
              name="skill_refs"
              label="勾选技能（引用当前用户的技能池）"
              tooltip="自定义技能 + 平台 sillyspec 技能。daemon 只 link 选中的子集（design §9）。"
            >
              <Checkbox.Group options={skillOptions} />
            </Form.Item>
            {skillOptions.length === 0 && (
              <p className="-mt-2 mb-2 text-[11px] text-muted-foreground">
                暂无可选技能（自定义技能或平台 sillyspec 技能为空）。
              </p>
            )}

            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              ⚠️ 档案不存任何 API Key / MCP 凭证——只存「用哪些」的引用。凭证留在用户级
              LlmProvider 与 daemon 本地。
            </div>
          </Form>
        </div>

        {/* 右栏：实时预览 ─────────────────────────── */}
        <div className="bg-muted/30 px-5 py-4">
          <ProfilePreview
            form={formInst}
            isEdit={isEdit}
            profileVersion={profileVersion}
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * 工作区级能力选项（工具策略 + MCP server）。
 *
 * 独立子组件：仅当 effectiveWsId 有值时挂载，避免全局页未选上下文时对空 wsId
 * 触发 `/api/workspaces//...` 的无效请求；父级 Form 通过 context 共享，Form.Item
 * 仍归属同一表单实例。
 */
function WorkspaceAbilityOptions({ workspaceId }: { workspaceId: string }) {
  const { policies } = useWorkspaceToolPolicies(workspaceId);
  const { mcpServers } = useWorkspaceMcpConfig(workspaceId);

  const mcpServerNames = useMemo(
    () => Object.keys(mcpServers).sort((a, b) => a.localeCompare(b)),
    [mcpServers],
  );
  const toolPolicyOptions = useMemo(
    () => [
      { value: "", label: "不指定（用默认）" },
      ...policies.map((p) => ({ value: p.id, label: p.name })),
    ],
    [policies],
  );

  return (
    <>
      <Form.Item name="tool_policy_id" label="工具策略（引用现有 ToolPolicy）">
        <Select options={toolPolicyOptions} placeholder="不指定（用默认）" allowClear />
      </Form.Item>
      <Form.Item
        name="mcp_refs"
        label="勾选 MCP（引用该工作区 .mcp.json 的 server，不存凭证）"
        tooltip="仅 stdio 类型，须过平台白名单（design §9）。凭证留在 daemon 本地，档案只存「用哪些」。"
      >
        <Checkbox.Group options={mcpServerNames} />
      </Form.Item>
      {mcpServerNames.length === 0 && (
        <p className="-mt-2 mb-2 text-[11px] text-muted-foreground">
          该工作区 .mcp.json 未配置 MCP 服务器。
        </p>
      )}
    </>
  );
}

/**
 * 右栏实时预览（内联简化角色卡，不依赖 task-03 的 AgentProfileCard）。
 * 通过 Form.useWatch 订阅当前表单值，左栏任一字段变化即同步刷新。
 */
function ProfilePreview({
  form,
  isEdit,
  profileVersion,
}: {
  form: FormInstance<ProfileFormValues>;
  isEdit: boolean;
  profileVersion?: number;
}) {
  const name = Form.useWatch("name", form) ?? "";
  const visibility =
    Form.useWatch("visibility", form) ?? ("private" as AgentProfileVisibility);
  const provider = Form.useWatch("provider", form) ?? "claude";
  const llmProviderId = Form.useWatch("llm_provider_id", form) ?? null;
  const model = Form.useWatch("model", form) ?? "";
  const systemPrompt = Form.useWatch("system_prompt", form) ?? "";
  const toolPolicyId = Form.useWatch("tool_policy_id", form) ?? "";
  // 绑定供应商名映射（task-08）：用本人 /llm-providers 列表按 id 查名；非本人 → 提示。
  const { data: llmProviders } = useQuery<LlmProviderRead[]>({
    queryKey: ["llm-providers", "list", "agent-profile-form"],
    queryFn: listProviders,
    staleTime: 60_000,
  });
  const boundProviderName = useMemo(() => {
    if (!llmProviderId) return null;
    const hit = (llmProviders ?? []).find((p) => p.id === llmProviderId);
    return hit ? hit.name : "（非本人供应商，将回退默认）";
  }, [llmProviderId, llmProviders]);
  const mcpRefs = Form.useWatch("mcp_refs", form) ?? [];
  const skillRefs = Form.useWatch("skill_refs", form) ?? [];

  const avatarText = (name || provider || "?").trim().charAt(0).toUpperCase();
  const promptSnippet = systemPrompt?.trim() || "（未填写系统提示词，按供应商默认人设执行）";

  return (
    <div className="sticky top-0">
      <div className="mb-3 text-center text-[11px] tracking-wide text-muted-foreground">
        ▼ 实时预览 · 这就是别人会看到的角色卡
      </div>
      <div className="mx-auto max-w-[300px] rounded-lg border border-border bg-card p-4 shadow-md">
        {/* 头部：头像 + 名 + 可见标签 */}
        <div className="mb-3 flex items-center gap-2.5">
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[15px] font-bold text-white"
            style={{ background: avatarGradient(provider) }}
          >
            {avatarText}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold text-foreground">
                {name.trim() || "未命名档案"}
              </span>
              <Tag color={VISIBILITY_TAG_COLOR[visibility]} className="!m-0 !text-[11px]">
                {VISIBILITY_LABEL[visibility]}
              </Tag>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {provider}
              {model ? ` / ${model}` : ""}
            </div>
            {boundProviderName ? (
              <div className="mt-0.5 text-[10px] text-foreground/60">
                供应商：{boundProviderName}
              </div>
            ) : null}
          </div>
        </div>
        {/* 系统提示词摘要 */}
        <div className="mb-3 line-clamp-2 rounded-lg bg-muted/50 px-3 py-2 text-[12px] leading-snug text-foreground/80">
          {promptSnippet}
        </div>
        {/* 能力 chip */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {toolPolicyId ? (
            <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
              工具策略
            </span>
          ) : null}
          {mcpRefs.map((m) => (
            <span
              key={`mcp-${m}`}
              className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground/70"
            >
              {m}
            </span>
          ))}
          {skillRefs.map((s) => (
            <span
              key={`skill-${s}`}
              className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground/70"
            >
              {s}
            </span>
          ))}
          {!toolPolicyId && mcpRefs.length === 0 && skillRefs.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">未引用额外能力</span>
          ) : null}
        </div>
        {/* 底栏：版本 */}
        <div className="flex items-center justify-between border-t border-dashed border-border pt-2 text-[11px] text-muted-foreground">
          <span>
            {isEdit && typeof profileVersion === "number"
              ? `v${profileVersion}`
              : isEdit
                ? "编辑中"
                : "新建 · v1"}
          </span>
        </div>
      </div>
      {/* 红线提示统一在左栏 ③能力区底部展示（仅一处，与单测断言一致） */}
    </div>
  );
}

/** 三组表单的小标题（左竖条 + 序号 + 标题 + 一句说明）。 */
function FormSectionHeader({
  index,
  title,
  desc,
}: {
  index: string;
  title: string;
  desc?: string;
}) {
  return (
    <Divider titlePlacement="left" plain className="!my-3">
      <span className="text-xs font-semibold text-brand-700">
        <span className="mr-1">{index}</span>
        {title}
      </span>
      {desc ? (
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
          {desc}
        </span>
      ) : null}
    </Divider>
  );
}

/**
 * 供应商配置下拉（大脑区第二层，task-07）：绑定 /settings/providers 的供应商，可选。
 *
 * 数据源 listProviders（GET /api/llm-providers，已按 owner 过滤），按第一层引擎
 * （engineProvider）过滤 agent_kind（当前仅 claude 类）。codex 等引擎下禁用 + 提示。
 * 编辑态：当前值不在本人列表（共享档案 owner 绑定）→ 加占位 option「无权限访问」，
 * form value 不转 null，依赖后端 Update exclude_unset（不传=不动）避免误解绑。
 */
function LlmProviderSelect({
  value,
  onChange,
  engineProvider,
}: {
  value?: string | null;
  onChange?: (v: string | null) => void;
  engineProvider?: string;
}) {
  const { data, isLoading } = useQuery<LlmProviderRead[]>({
    queryKey: ["llm-providers", "list", "agent-profile-form"],
    queryFn: listProviders,
    staleTime: 60_000,
  });
  const providers = data ?? [];
  const options = useMemo(() => {
    const filtered = providers.filter((p) => p.agent_kind === engineProvider);
    const opts = filtered.map((p) => ({ value: p.id, label: p.name }));
    // 编辑态回显：非本人供应商（id 不在列表）→ 占位，不误解绑。
    if (value && !opts.some((o) => o.value === value)) {
      opts.push({ value, label: "（无权限访问该供应商，提交时不动）" });
    }
    return opts;
  }, [providers, engineProvider, value]);
  const engineUnsupported = !!engineProvider && engineProvider !== "claude";
  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      allowClear
      disabled={engineUnsupported}
      placeholder={engineUnsupported ? "该引擎暂未开放供应商配置" : "不绑定（用默认）"}
      notFoundContent={
        engineUnsupported
          ? "该引擎暂未开放供应商配置"
          : isLoading
            ? "加载中…"
            : "暂无可绑定供应商（先在 /settings/providers 配置）"
      }
    />
  );
}
