"use client";

/**
 * AgentProfileForm — 智能体档案新建/编辑表单（人格 + 技能清单版）。
 *
 * 2026-10-21-agent-profile-slim-default task-04：按消费现实瘦身——会话/群聊两条
 * 活跃链路只消费 system_prompt + skill_refs（D-013 裁剪变体），引擎/模型/供应商/
 * 工具策略/MCP 勾选全部移出表单（DB 列留守，读侧忽略；编辑保存显式落空值清空
 * 存量引用，不迁移）。工作区上下文选择器仅在 visibility=workspace（归属必需）
 * 时出现；private/platform 由后端按 visibility 定归属（ws_id=None），URL 载体
 * 自动取首个可见工作区，不再强制用户选择。
 *
 * 历史：双栏预览版 2026-08-04-agent-profile-ui-redesign task-04；三组 8 字段
 * 原始实现 2026-08-02-agent-profile-layer task-12（D-011）。
 *
 * 红线（design §10）：不存任何 API Key / MCP 凭证——技能引用当前用户技能池。
 *
 * 遵循 FRONTEND_PAGE_STYLE.md §6：antd Modal + Form layout="vertical" +
 * maskClosable=false + destroyOnClose。双栏布局为本页显式特例。
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

import {
  useCreateAgentProfile,
  useUpdateAgentProfile,
  VISIBILITY_LABEL,
  VISIBILITY_TAG_COLOR,
  type AgentProfileCreate,
  type AgentProfileRead,
  type AgentProfileUpdate,
  type AgentProfileVisibility,
} from "@/lib/agent-profiles";
import {
  useCustomSkills,
  usePlatformSkillsManifest,
} from "@/lib/custom-skills";
import { listWorkspaces, type Workspace } from "@/lib/workspaces";
import { useNotify } from "@/lib/errors";

interface AgentProfileFormProps {
  /** create=新建空白表单；edit=编辑既有档案（需传 profile）。 */
  mode: "create" | "edit";
  /**
   * 工作区内页路由携带的 workspaceId（visibility=workspace 时即归属）。
   * 全局页（/agent-profiles）不传。
   */
  workspaceId?: string;
  /** edit 模式必传（被编辑的档案）；create 模式忽略。 */
  profile?: AgentProfileRead | null;
  onClose: () => void;
}

/**
 * 表单内部扁平状态（antd Form 字段值）。2026-10-21 瘦身后仅四项：
 * name / visibility / system_prompt / skill_refs。
 */
interface ProfileFormValues {
  name: string;
  visibility: AgentProfileVisibility;
  system_prompt?: string;
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

/**
 * 把表单扁平值组装成 Create body。被删字段显式落空值（新建本就空；
 * 后端 provider 缺省 'claude'，前端不传）。
 */
export function toCreateBody(v: ProfileFormValues): AgentProfileCreate {
  return {
    name: v.name.trim(),
    visibility: v.visibility,
    system_prompt: v.system_prompt?.trim() ? v.system_prompt.trim() : null,
    skill_refs: v.skill_refs ?? [],
  };
}

/**
 * 把表单扁平值组装成 Update body。**显式**携带被删字段的空值（null/[]）清空
 * 存量引用——Update 语义 exclude_unset：不传=不动，传空值=清空（存量档案的
 * mcp_refs/tool_policy_id/llm_provider_id/model 随首次编辑保存自然清空）。
 */
export function toUpdateBody(v: ProfileFormValues): AgentProfileUpdate {
  return {
    name: v.name.trim(),
    visibility: v.visibility,
    system_prompt: v.system_prompt?.trim() ? v.system_prompt.trim() : null,
    skill_refs: v.skill_refs ?? [],
    model: null,
    llm_provider_id: null,
    tool_policy_id: null,
    mcp_refs: [],
  };
}

/** 编辑态从 profile 读初值（被删字段不进表单，保存时经 toUpdateBody 清空）。 */
function profileToInitial(
  p: AgentProfileRead | null | undefined,
): Partial<ProfileFormValues> {
  if (!p) return { visibility: "private", skill_refs: [] };
  return {
    name: p.name,
    visibility: p.visibility,
    system_prompt: p.system_prompt ?? "",
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
  // form 实例上提：外层 Form.useWatch("visibility") 驱动 effectiveWsId（hooks
  // 参数），Modal 内复用同一实例——antd 跨组件传 form 支持范式。
  const [formInst] = Form.useForm<ProfileFormValues>();
  const visibility =
    Form.useWatch("visibility", formInst) ?? ("private" as AgentProfileVisibility);

  // ── 工作区上下文 ──
  // routeWorkspaceId：工作区内页路由携带。全局页 visibility=workspace 时需用户
  // 选归属；private/platform 由后端按 visibility 定归属，URL 载体自动取首个可见 ws。
  const routeWorkspaceId = workspaceId;
  const [chosenWorkspaceId, setChosenWorkspaceId] = useState<string>("");

  const wsListQuery = useQuery<Workspace[], Error>({
    queryKey: ["workspaces", "list", "agent-profile-form"],
    queryFn: async () => (await listWorkspaces({ status: "active" })).items ?? [],
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
  const firstWsId = (wsListQuery.data ?? [])[0]?.id ?? "";

  const systemDefaultReadonly = profile?.is_system_default === true;
  const effectiveWsId =
    routeWorkspaceId ??
    (visibility === "workspace" ? chosenWorkspaceId : firstWsId) ??
    profile?.workspace_id ??
    "";

  const createProfile = useCreateAgentProfile(effectiveWsId);
  const updateProfile = useUpdateAgentProfile(effectiveWsId);
  const submitting = createProfile.isPending || updateProfile.isPending;

  const handleSave = async (values: ProfileFormValues) => {
    if (!effectiveWsId) {
      notify.error(new Error("未找到可用工作区，无法保存档案"));
      return;
    }
    try {
      if (isEdit && profile) {
        const updated = await updateProfile.mutateAsync({
          profileId: profile.id,
          body: toUpdateBody(values),
        });
        notify.success(`档案「${updated.name}」已更新`);
      } else {
        const created = await createProfile.mutateAsync(toCreateBody(values));
        notify.success(`档案「${created.name}」已创建`);
      }
      onClose();
    } catch (err) {
      notify.error(err, isEdit ? "更新档案失败" : "创建档案失败");
    }
  };

  const { skills: customSkills } = useCustomSkills();
  const { manifest } = usePlatformSkillsManifest();
  const skillOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of customSkills) set.add(s.name);
    for (const s of manifest?.skills ?? []) set.add(s.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customSkills, manifest]);

  return (
    <AgentProfileModal
      form={formInst}
      isEdit={isEdit}
      submitting={submitting}
      initial={profileToInitial(profile)}
      skillOptions={skillOptions}
      routeWorkspaceId={routeWorkspaceId ?? ""}
      workspaceOptions={workspaceOptions}
      wsListLoading={wsListQuery.isLoading}
      chosenWorkspaceId={chosenWorkspaceId}
      onChosenWorkspaceIdChange={setChosenWorkspaceId}
      systemDefaultReadonly={systemDefaultReadonly}
      onCancel={onClose}
      onSubmit={handleSave}
    />
  );
}

/* ────────────────────── 纯展示 Modal（便于单测，业务 hooks 在外层） ────────────────────── */

interface AgentProfileModalProps {
  form: FormInstance<ProfileFormValues>;
  isEdit: boolean;
  submitting: boolean;
  initial: Partial<ProfileFormValues>;
  skillOptions: string[];
  routeWorkspaceId: string;
  workspaceOptions: { value: string; label: string }[];
  wsListLoading: boolean;
  chosenWorkspaceId: string;
  onChosenWorkspaceIdChange: (id: string) => void;
  /** 系统预置档案：编辑态只读（后端拒改，前端禁用关键字段）。 */
  systemDefaultReadonly: boolean;
  onCancel: () => void;
  onSubmit: (v: ProfileFormValues) => Promise<void>;
}

function AgentProfileModal({
  form: formInst,
  isEdit,
  submitting,
  initial,
  skillOptions,
  routeWorkspaceId,
  workspaceOptions,
  wsListLoading,
  chosenWorkspaceId,
  onChosenWorkspaceIdChange,
  systemDefaultReadonly,
  onCancel,
  onSubmit,
}: AgentProfileModalProps) {
  const visibility = Form.useWatch("visibility", formInst) ?? "private";

  useEffect(() => {
    formInst.setFieldsValue({
      visibility: "private",
      skill_refs: [],
      ...initial,
    } as ProfileFormValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const handleSave = async (form: FormInstance<ProfileFormValues>) => {
    try {
      const values = (await form.validateFields()) as ProfileFormValues;
      await onSubmit(values);
    } catch (err) {
      // antd Form 校验失败已内联提示；其它错误上抛给 onSubmit 的 notify。
      if (err && typeof err === "object" && "errorFields" in err) return;
      throw err;
    }
  };

  const visibilityLocked =
    systemDefaultReadonly || (isEdit && initial.visibility === "platform");
  // 归属选择器仅 visibility=workspace 且无路由 ws 时出现（归属必需）。
  const showWsSelector = visibility === "workspace" && !routeWorkspaceId;

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
            disabled={systemDefaultReadonly && !isEdit}
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
            {/* 归属工作区（仅 visibility=workspace 且全局页时显示） */}
            {showWsSelector && (
              <Form.Item
                label="归属工作区"
                required
                tooltip="可见范围为「工作区」的档案将归属于该工作区（成员可用）。"
              >
                <Select
                  value={chosenWorkspaceId || undefined}
                  placeholder="请选择归属工作区"
                  options={workspaceOptions}
                  onChange={onChosenWorkspaceIdChange}
                  showSearch
                  optionFilterProp="label"
                  notFoundContent={
                    wsListLoading ? "加载工作区…" : "暂无可见工作区"
                  }
                />
              </Form.Item>
            )}

            <FormSectionHeader
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
            <Form.Item
              name="system_prompt"
              label="系统提示词（agent 人格，与 spec 任务上下文叠加）"
              tooltip="这段会注入下发 daemon 的会话 system prompt（保留引擎默认能力并追加）。留空则不影响。"
            >
              <Input.TextArea
                rows={6}
                placeholder="例如：你是资深代码审查员，只读不改，关注安全/性能/可维护性…"
              />
            </Form.Item>

            <FormSectionHeader
              title="技能"
              desc="勾选该档案可用的技能（只存引用；未勾选 = 该档案的会话不挂载任何技能）。"
            />
            <Form.Item name="skill_refs">
              <Checkbox.Group options={skillOptions} />
            </Form.Item>
            {skillOptions.length === 0 && (
              <p className="-mt-2 mb-2 text-[11px] text-muted-foreground">
                暂无可选技能（自定义技能或平台 sillyspec 技能为空）。
              </p>
            )}

            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              ⚠️ 档案不存任何 API Key / 凭证——引擎、模型、供应商、MCP 均在会话与
              群成员配置里各自指定；本档案只承载人格与技能清单。
            </div>
          </Form>
        </div>

        {/* 右栏：实时预览 ─────────────────────────── */}
        <div className="bg-muted/30 px-5 py-4">
          <ProfilePreview form={formInst} isEdit={isEdit} />
        </div>
      </div>
    </Modal>
  );
}

/**
 * 右栏实时预览（人格卡：名称/可见范围/提示词摘要/技能 chips）。
 */
function ProfilePreview({
  form,
  isEdit,
}: {
  form: FormInstance<ProfileFormValues>;
  isEdit: boolean;
}) {
  const name = Form.useWatch("name", form) ?? "";
  const visibility =
    Form.useWatch("visibility", form) ?? ("private" as AgentProfileVisibility);
  const systemPrompt = Form.useWatch("system_prompt", form) ?? "";
  const skillRefs = Form.useWatch("skill_refs", form) ?? [];

  const avatarText = (name || "?").trim().charAt(0).toUpperCase();
  const promptSnippet = systemPrompt?.trim() || "（未填写系统提示词，按引擎默认人设执行）";

  return (
    <div className="sticky top-0">
      <div className="mb-3 text-center text-[11px] tracking-wide text-muted-foreground">
        ▼ 实时预览 · 这就是别人会看到的角色卡
      </div>
      <div className="mx-auto max-w-[300px] rounded-lg border border-border bg-card p-4 shadow-md">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/15 text-[15px] font-bold text-primary">
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
          </div>
        </div>
        <div className="mb-3 line-clamp-3 rounded-lg bg-muted/50 px-3 py-2 text-[12px] leading-snug text-foreground/80">
          {promptSnippet}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {skillRefs.map((s) => (
            <span
              key={`skill-${s}`}
              className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground/70"
            >
              {s}
            </span>
          ))}
          {skillRefs.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">无技能（不挂载）</span>
          ) : null}
        </div>
        <div className="border-t border-dashed border-border pt-2 text-[11px] text-muted-foreground">
          {isEdit ? "编辑中" : "新建 · v1"}
        </div>
      </div>
    </div>
  );
}

/** 表单小节标题（左竖条 + 标题 + 一句说明）。 */
function FormSectionHeader({
  title,
  desc,
}: {
  title: string;
  desc?: string;
}) {
  return (
    <Divider titlePlacement="left" plain className="!my-3">
      <span className="text-xs font-semibold text-brand-700">{title}</span>
      {desc ? (
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
          {desc}
        </span>
      ) : null}
    </Divider>
  );
}
