"use client";

/**
 * AgentProfileForm — 智能体档案新建/编辑表单（task-12，变更
 * 2026-08-02-agent-profile-layer）。
 *
 * 对齐 prototype v2 / design D-011：表单分三组——
 *  ① 身份：name / visibility
 *  ② 大脑：provider / model / system_prompt
 *  ③ 工具能力：tool_policy_id / mcp_refs / skill_refs
 *
 * 红线（design §10）：不存任何 API Key / MCP 凭证——只存「用哪些」的引用。MCP 引用
 * 当前 workspace .mcp.json 的 server 名（useWorkspaceMcpConfig，env 已脱敏），技能
 * 引用当前用户技能池（自定义 skill + 平台 sillyspec skills manifest）。
 *
 * 遵循前端设计系统（规则 19 / FRONTEND_PAGE_STYLE.md）：antd Modal + Form
 * layout="vertical" + maskClosable=false + destroyOnClose；保存按钮 primary+loading，
 * 取消 default；校验内联（Form.Item rules message 中文）。
 *
 * 类型从 api-types.ts（规则 20）：Create/Update body 用 lib/agent-profiles 透传的
 * AgentProfileCreate / AgentProfileUpdate。
 */
import { useEffect, useMemo } from "react";
import {
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  type FormInstance,
} from "antd";

import {
  PROVIDER_META,
} from "@/lib/daemon";
import {
  useCreateAgentProfile,
  useUpdateAgentProfile,
  useWorkspaceToolPolicies,
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
import { useNotify } from "@/lib/errors";

interface AgentProfileFormProps {
  /** create=新建空白表单；edit=编辑既有档案（需传 profile）。 */
  mode: "create" | "edit";
  workspaceId: string;
  /** edit 模式必传（被编辑的档案）；create 模式忽略。 */
  profile?: AgentProfileRead | null;
  onClose: () => void;
}

/**
 * 表单内部扁平状态（antd Form 字段值）。各字段与 DTO 对齐：
 *  - tool_policy_id：空串=不引用（null）。
 *  - mcp_refs / skill_refs：字符串数组。
 */
interface ProfileFormValues {
  name: string;
  visibility: AgentProfileVisibility;
  provider: string;
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
    model: p.model ?? "",
    system_prompt: p.system_prompt ?? "",
    tool_policy_id: p.tool_policy_id ?? "",
    mcp_refs: p.mcp_refs ?? [],
    skill_refs: p.skill_refs ?? [],
  };
}

export function AgentProfileForm({
  mode,
  workspaceId,
  profile,
  onClose,
}: AgentProfileFormProps) {
  const isEdit = mode === "edit" && profile != null;
  const notify = useNotify();

  const createProfile = useCreateAgentProfile(workspaceId);
  const updateProfile = useUpdateAgentProfile(workspaceId);
  const submitting = createProfile.isPending || updateProfile.isPending;

  // ③ 工具能力数据源
  const { policies } = useWorkspaceToolPolicies(workspaceId);
  const { mcpServers } = useWorkspaceMcpConfig(workspaceId);
  const { skills: customSkills } = useCustomSkills();
  const { manifest } = usePlatformSkillsManifest();

  const mcpServerNames = useMemo(
    () => Object.keys(mcpServers).sort((a, b) => a.localeCompare(b)),
    [mcpServers],
  );
  const skillOptions = useMemo(() => {
    const set = new Set<string>();
    // 自定义 skill（用户技能池）
    for (const s of customSkills) set.add(s.name);
    // 平台 sillyspec skills（manifest.skills[].name = 顶层目录名）
    for (const s of manifest?.skills ?? []) set.add(s.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customSkills, manifest]);

  const providerOptions = useMemo(
    () => buildProviderOptions(profile?.provider),
    [profile?.provider],
  );

  const toolPolicyOptions = useMemo(
    () => [
      { value: "", label: "不指定（用默认）" },
      ...policies.map((p) => ({ value: p.id, label: p.name })),
    ],
    [policies],
  );

  return (
    <AgentProfileModal
      isEdit={isEdit}
      submitting={submitting}
      initial={profileToInitial(profile)}
      providerOptions={providerOptions}
      toolPolicyOptions={toolPolicyOptions}
      mcpServerNames={mcpServerNames}
      skillOptions={skillOptions}
      systemDefaultReadonly={profile?.is_system_default === true}
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

/* ────────────────────── 纯展示 Modal（便于单测，无 hooks 依赖） ────────────────────── */

interface AgentProfileModalProps {
  isEdit: boolean;
  submitting: boolean;
  initial: Partial<ProfileFormValues>;
  providerOptions: { value: string; label: string }[];
  toolPolicyOptions: { value: string; label: string }[];
  mcpServerNames: string[];
  skillOptions: string[];
  /** 系统预置档案：编辑态只读（后端拒改，前端禁用关键字段）。 */
  systemDefaultReadonly: boolean;
  onCancel: () => void;
  onSubmit: (v: ProfileFormValues) => Promise<void>;
}

function AgentProfileModal({
  isEdit,
  submitting,
  initial,
  providerOptions,
  toolPolicyOptions,
  mcpServerNames,
  skillOptions,
  systemDefaultReadonly,
  onCancel,
  onSubmit,
}: AgentProfileModalProps) {
  const [formInst] = Form.useForm<ProfileFormValues>();

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
      width={640}
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
            disabled={systemDefaultReadonly && !isEdit}
            onClick={() => void handleSave(formInst)}
          >
            保存
          </Button>
        </div>
      }
    >
      <Form<ProfileFormValues>
        form={formInst}
        layout="vertical"
        preserve={false}
        disabled={systemDefaultReadonly}
      >
        {/* ① 身份 */}
        <FormSectionHeader index="①" title="身份" />
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
        <FormSectionHeader index="②" title="大脑" />
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            name="provider"
            label="供应商偏好（决定选哪台 daemon）"
            rules={[{ required: true, message: "请选择供应商" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={providerOptions}
              placeholder="选择供应商"
            />
          </Form.Item>
          <Form.Item name="model" label="模型">
            <Input placeholder="例如 claude-sonnet-4（留空用供应商默认）" />
          </Form.Item>
        </div>
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
        <FormSectionHeader index="③" title="工具能力" />
        <Form.Item name="tool_policy_id" label="工具策略（引用现有 ToolPolicy）">
          <Select
            options={toolPolicyOptions}
            placeholder="不指定（用默认）"
            allowClear
          />
        </Form.Item>
        <Form.Item
          name="mcp_refs"
          label="勾选 MCP（引用当前工作区 .mcp.json 的 server，不存凭证）"
          tooltip="仅 stdio 类型，须过平台白名单（design §9）。凭证留在 daemon 本地，档案只存「用哪些」。"
        >
          <Checkbox.Group options={mcpServerNames} />
        </Form.Item>
        {mcpServerNames.length === 0 && (
          <p className="-mt-2 mb-2 text-[11px] text-muted-foreground">
            当前工作区 .mcp.json 未配置 MCP 服务器。
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
    </Modal>
  );
}

/** 三组表单的小标题（对齐 prototype v2 .group 样式：左竖条 + 序号 + 标题）。 */
function FormSectionHeader({ index, title }: { index: string; title: string }) {
  return (
    <Divider titlePlacement="left" plain className="!my-3">
      <span className="text-xs font-semibold text-blue-700">
        <span className="mr-1">{index}</span>
        {title}
      </span>
    </Divider>
  );
}
