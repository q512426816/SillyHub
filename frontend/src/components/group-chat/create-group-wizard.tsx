"use client";

/**
 * CreateGroupWizard — 三步建群向导对话框（2026-09-01-session-group-chat
 * task-07 / FR-01 / FR-04，design §7「建群向导」；quick 群 PPM 项目化改造）。
 *
 * 依据：
 *   - tasks/task-07.md（implementation 第 3 点 / acceptance 六要素校验 +
 *     agent 8 / 用户 50 上限拦截）
 *   - design.md §7 建群向导（群名 → 邀请用户 → 配置 agent 成员六要素 →
 *     创建；不内置角色模板——人格即角色，纯自定义）
 *   - lib/api-types.ts GroupChatCreate（quick 项目化口径：project_id 必填；
 *     workspace_id 可选——后端自动取项目首个关联工作区，UI 不再出现群工作区
 *     选择；邀请范围=项目成员、agent 工作区须在项目关联集内——后端 400 校验
 *     的同口径前端引导：候选直接查项目人员 / 项目关联工作区，从源头避免 400）
 *   - prototype-group-chat.html .modal（createModal 建群向导示意 + 六要素
 *     callout 文案）
 *
 * 三步（antd Modal + 控件 / tailwind 布局，照 FRONTEND_PAGE_STYLE §0）：
 *   ① 群信息：群名称（必填 ≤120）+ PPM 项目（listSimpleProjects 全量候选 +
 *      搜索；选中后显示该项目关联工作区数提示；无关联工作区 → 禁下一步 +
 *      引导文案「请先在项目管理中关联工作区」）；
 *   ② 邀请用户：项目人员多选（listProjectMembers({pm_project_id})，排除本人
 *      ——建群人自动成为群主且后端要求其为项目成员；上限 50）；每个被邀人
 *      可选上传群内头像（GroupMemberAvatarUpload 同管线，填
 *      GroupMemberUserCreate.avatar）；
 *   ③ Agent 成员：可增删多张六要素卡片（昵称（群内唯一 @提及词，即时查重 +
 *      保留词「全体/all」禁用）/ 机器（在线 runtime，按机器分组）/ 工作区
 *      （**项目关联工作区必选**——群工作区由后端推导，不再有「沿用群工作区」）/
 *      引擎（claude/codex）/ 模型（llm_provider，codex 引擎无供应商切换语义
 *      ——照 session-config-bar providerLocked 先例禁用）/ 智能体方案
 *      （AgentProfile，缺省=用默认））；每张卡片可上传成员头像（填
 *      GroupMemberAgentConfig.avatar）。
 *
 * 提交调 createGroupChat（GroupChatCreate：project_id 必填、**不带
 * workspace_id**（后端推导）；agent_cross_mention 默认开 / cross_mention_depth
 * context_window 20——后端 schema 同款默认值镜像，生成版 TS 类型必填须显式
 * 传）；成功 invalidate ["groupChats"] 前缀 + onCreated(新群) 由门户选中新群。
 *
 * 样式：AI-Native 双主题铁律——brand-* 语义阶 / 不手写 hex / shadow token；
 * 侧栏内组件禁 md: 响应式前缀（本组件为模态，固定 grid-cols-2 两列）。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Select } from "antd";
import { Bot, Plus, Trash2 } from "lucide-react";

import { useMineAgentProfiles } from "@/lib/agent-profiles";
import { listProviders } from "@/lib/api/llm-providers";
import { errMessage, useNotify } from "@/lib/errors";
import { listSimpleProjects, listProjectMembers } from "@/lib/ppm/project";
import type { ProjectMember } from "@/lib/ppm/types";
import { listProjectWorkspaces } from "@/lib/workspace";
import type { WorkspaceBrief } from "@/lib/workspace";
import {
  createGroupChat,
  PROVIDER_META,
  type GroupChatCreate,
  type GroupChatRead,
} from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { useSession } from "@/stores/session";
import {
  GroupMemberAvatar,
  GroupMemberAvatarUpload,
} from "@/components/group-chat/group-member-avatar";
import { cn } from "@/lib/utils";

/* ────────────────────── 常量（design §9.3 护栏参数镜像） ────────────────────── */

/** agent 成员上限（design §9.3 首版保守值；建群/加成员双侧同守）。 */
export const GROUP_AGENT_MEMBER_LIMIT = 8;
/** 用户成员上限（design §9.3；建群人（群主）不计入邀请数）。 */
export const GROUP_USER_MEMBER_LIMIT = 50;
/** 群名长度上限（agent_group_chats.title String(120)）。 */
const GROUP_TITLE_MAX_LEN = 120;
/** 群内昵称长度上限（agent_group_members.display_name String(40)）。 */
const GROUP_MEMBER_NAME_MAX_LEN = 40;

/**
 * 群内昵称保留词（@路由广播语义，design §4.1）：「全体」/「all」为 @全体
 * 触发词，不可被成员占用（否则 @路由歧义）。
 */
const RESERVED_MEMBER_NAMES = new Set(["全体", "all"]);

/** 引擎选项（对齐 AGENT_TABS 两档；群聊 agent 成员仅 claude/codex）。 */
const ENGINE_OPTIONS = [
  { label: "Claude Code", value: "claude" },
  { label: "Codex", value: "codex" },
] as const;

/** 支持作为群 agent 成员的引擎白名单（PreSessionPicker 同源约束）。 */
const GROUP_SUPPORTED_PROVIDERS = new Set(["claude", "codex"]);

/* ────────────────────── 纯校验（组件外便于单测推理） ────────────────────── */

/**
 * 群内昵称即时校验：必填 / 保留词（全体、all）/ 与已配置成员重名 / 长度。
 * 返回错误文案；null = 通过。
 */
export function validateMemberDisplayName(
  name: string,
  others: string[],
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "请填写群内昵称（@提及词）";
  if (RESERVED_MEMBER_NAMES.has(trimmed.toLowerCase())) {
    return "「全体 / all」是 @广播保留词，不可用作昵称";
  }
  if (others.includes(trimmed)) {
    return `昵称「${trimmed}」与已配置成员重复（群内唯一）`;
  }
  if (trimmed.length > GROUP_MEMBER_NAME_MAX_LEN) {
    return `昵称最长 ${GROUP_MEMBER_NAME_MAX_LEN} 字`;
  }
  return null;
}

/** agent 成员卡片编辑态（六要素 + 头像；id 为本地 key 供列表渲染）。 */
export interface AgentMemberCardState {
  id: string;
  displayName: string;
  /** 群内头像 URL（文件中心上传产出；null = 首字默认）。 */
  avatar: string | null;
  runtimeId: string | null;
  /** 工作区（项目关联工作区内必选——quick 起「沿用群工作区」选项退役）。 */
  workspaceId: string;
  provider: string;
  /** 空串 = 不指定（本机/供应商默认）。 */
  llmProviderId: string;
  /** 空串 = 不指定（走默认档案兜底链）。 */
  agentProfileId: string;
}

/** 新建一张空白 agent 成员卡片（引擎默认 claude，对齐浮层第二步默认高亮）。 */
function newAgentCard(): AgentMemberCardState {
  return {
    id: `card-${Math.random().toString(36).slice(2, 10)}`,
    displayName: "",
    avatar: null,
    runtimeId: null,
    workspaceId: "",
    provider: "claude",
    llmProviderId: "",
    agentProfileId: "",
  };
}

/* ────────────────────── 组件 ────────────────────── */

export interface CreateGroupWizardProps {
  /** 受控开关（父层持有；取消/遮罩点击仅回调 onCancel）。 */
  open: boolean;
  /** 取消回调（✕ / 遮罩 / footer 取消按钮）。 */
  onCancel: () => void;
  /**
   * 建群成功回调（携 GroupChatRead；调用方刷新群列表并选中新群——门户
   * 挂载点选中态由 onCreated 驱动）。
   */
  onCreated: (_group: GroupChatRead) => void;
}

const WIZARD_STEPS = ["群信息", "邀请用户", "Agent 成员"] as const;

export function CreateGroupWizard({
  open,
  onCancel,
  onCreated,
}: CreateGroupWizardProps) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  /** 已邀用户（user_id + 可选群内头像；Select onChange 时保号同步）。 */
  const [invited, setInvited] = useState<{ user_id: string; avatar: string | null }[]>([]);
  const [agentCards, setAgentCards] = useState<AgentMemberCardState[]>([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const qc = useQueryClient();
  const notify = useNotify();

  // 当前用户（邀人候选排除本人——建群人自动成为群主）。
  const meId = useSession((s) => s.user?.id ?? null);

  // 打开时重置向导（取消不清父层状态，重开从第一步重新开始）。
  useEffect(() => {
    if (open) {
      setStep(0);
      setTitle("");
      setProjectId(null);
      setInvited([]);
      setAgentCards([]);
      setSubmitAttempted(false);
    }
  }, [open]);

  /* ── 数据源（全部照现有惯例的查询/ hook） ── */

  // PPM 项目下拉：simple-list 全量候选（登录可见项目）+ 搜索。
  const projectsQ = useQuery({
    queryKey: ["ppmProjects", "simple", "create-group-wizard"],
    queryFn: listSimpleProjects,
    staleTime: 60_000,
    enabled: open,
  });
  const projectOptions = useMemo(
    () =>
      (projectsQ.data ?? []).map((p) => ({
        value: p.id,
        // 项目名空回退 id 短码（PPM 列表惯例）。
        label: p.project_name?.trim() || p.id.slice(0, 8),
      })),
    [projectsQ.data],
  );

  // 项目关联工作区（步骤①关联数提示 + 步骤③ agent 成员工作区候选共用）：
  // quick 后端口径同源——群工作区由该集推导，agent 工作区须在集内。
  const projectWorkspacesQ = useQuery({
    queryKey: ["projectWorkspaces", "create-group-wizard", projectId],
    queryFn: () => listProjectWorkspaces(projectId!),
    enabled: open && projectId != null,
    staleTime: 60_000,
  });
  const projectWorkspaces = useMemo<WorkspaceBrief[]>(
    () => projectWorkspacesQ.data ?? [],
    [projectWorkspacesQ.data],
  );
  const projectWorkspaceOptions = useMemo(
    () =>
      projectWorkspaces.map((w) => ({
        value: w.workspace_id,
        label: w.name,
      })),
    [projectWorkspaces],
  );

  // 邀请候选：项目人员（后端 400 同口径——邀人范围=项目成员；排除本人）。
  const projectMembersQ = useQuery({
    queryKey: ["ppmProjectMembers", "create-group-wizard", projectId],
    queryFn: () => listProjectMembers({ pm_project_id: projectId! }),
    enabled: open && step === 1 && projectId != null,
    staleTime: 60_000,
  });
  const memberOptions = useMemo(
    () =>
      (projectMembersQ.data ?? [])
        .filter((m) => !meId || m.user_id !== meId)
        .map((m: ProjectMember) => ({
          value: m.user_id,
          label: m.user_name?.trim() || m.username?.trim() || m.user_id.slice(0, 8),
        })),
    [projectMembersQ.data, meId],
  );

  // 机器（runtime 下拉）：useDaemonMachines 融合候选（自有+共享），仅在线
  // 机器的 claude/codex runtime 可选（pinned 派发要求触发时在线；离线项置灰
  // 保留可见性——照机器小节「（离线）」先例）。
  const { machineCandidates } = useDaemonMachines({ limit: 100 });
  const runtimeOptions = useMemo(() => {
    const groups: {
      label: string;
      options: { value: string; label: string; disabled?: boolean }[];
    }[] = [];
    for (const m of machineCandidates ?? []) {
      const machineOnline = m.status === "online";
      const runtimes = (m.runtimes ?? []).filter((r) =>
        GROUP_SUPPORTED_PROVIDERS.has(r.provider ?? ""),
      );
      if (runtimes.length === 0) continue;
      const alias = m.display_alias?.trim() || m.hostname;
      groups.push({
        label: machineOnline ? alias : `${alias}（离线）`,
        options: runtimes.map((r) => ({
          value: r.id,
          label:
            r.display_alias?.trim() ||
            PROVIDER_META[r.provider ?? ""]?.label ||
            r.id,
          disabled: !machineOnline || r.status !== "online",
        })),
      });
    }
    return groups;
  }, [machineCandidates]);

  // 模型（llm_provider 下拉）：listProviders（sessions-portal providersQ 同源）。
  const providersQ = useQuery({
    queryKey: ["llmProviders", "create-group-wizard"],
    queryFn: listProviders,
    staleTime: 30_000,
    enabled: open,
  });
  const providerOptions = useMemo(
    () =>
      (providersQ.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    [providersQ.data],
  );

  // 智能体方案（AgentProfile 下拉）：useMineAgentProfiles（跨工作区可见，
  // session-config-bar 档案下拉同源）。
  const { profiles } = useMineAgentProfiles();
  const profileOptions = useMemo(
    () => profiles.map((p) => ({ value: p.id, label: p.name })),
    [profiles],
  );

  /* ── 校验 ── */

  const titleError = useMemo(() => {
    const trimmed = title.trim();
    if (!trimmed) return "请填写群名称";
    if (trimmed.length > GROUP_TITLE_MAX_LEN)
      return `群名称最长 ${GROUP_TITLE_MAX_LEN} 字`;
    return null;
  }, [title]);

  /** 项目关联工作区提示（null = 不渲染：未选项目/仍在加载）。 */
  const workspaceHint = useMemo<{
    kind: "ok" | "empty" | "loading";
    text: string;
  } | null>(() => {
    if (projectId == null) return null;
    if (projectWorkspacesQ.isLoading) {
      return { kind: "loading", text: "正在加载项目关联工作区…" };
    }
    if (projectWorkspacesQ.isError) {
      return { kind: "empty", text: "项目关联工作区加载失败，请稍后重试" };
    }
    if (projectWorkspaces.length === 0) {
      return {
        kind: "empty",
        text: "该项目尚未关联工作区——请先在项目管理中关联工作区后再建群",
      };
    }
    return {
      kind: "ok",
      text: `已关联 ${projectWorkspaces.length} 个工作区（群工作区将自动取该项目首个关联工作区）`,
    };
  }, [projectId, projectWorkspacesQ, projectWorkspaces.length]);

  /** 某张卡片的昵称错误（即时查重：与其它卡片的已填昵称比对）。 */
  const nameErrorOf = (card: AgentMemberCardState): string | null =>
    validateMemberDisplayName(
      card.displayName,
      agentCards
        .filter((c) => c.id !== card.id)
        .map((c) => c.displayName.trim())
        .filter(Boolean),
    );

  /** 某张卡片整体可提交（昵称通过 + 机器已选 + 工作区已选（项目关联集必选））。 */
  const cardValid = (card: AgentMemberCardState): boolean =>
    nameErrorOf(card) === null && card.runtimeId != null && card.workspaceId !== "";

  const stepValid = useMemo(() => {
    if (step === 0) {
      // 群名 + 项目已选 + 项目关联工作区就位（空集/加载中/失败均禁走下一步）。
      return (
        !titleError &&
        projectId != null &&
        projectWorkspacesQ.isSuccess &&
        projectWorkspaces.length > 0
      );
    }
    if (step === 1) return true; // 邀请可跳过（0 人合法——仅群主也成群）
    return agentCards.every(cardValid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, titleError, projectId, projectWorkspacesQ.isSuccess, projectWorkspaces.length, agentCards]);

  /* ── 提交 ── */

  const createMutation = useMutation({
    mutationFn: (payload: GroupChatCreate) => createGroupChat(payload),
    onSuccess: (group) => {
      // 前缀失效：门户/列表的 ["groupChats", …] 查询全部命中重拉（新群落
      // 群分区顶部）。
      void qc.invalidateQueries({ queryKey: ["groupChats"] });
      notify.success(`群聊「${group.title}」已创建`);
      onCreated(group);
    },
    onError: (err) => {
      notify.error(errMessage(err, "建群失败，请稍后重试"));
    },
  });

  const handleSubmit = () => {
    if (!stepValid || createMutation.isPending) return;
    setSubmitAttempted(true);
    const payload: GroupChatCreate = {
      title: title.trim(),
      // quick 群 PPM 项目化：project_id 必填；workspace_id 不传——后端自动取
      // 项目首个关联工作区（步骤①已按同口径引导）。
      project_id: projectId!,
      // 生成版 TS 类型必填须显式传；取值沿用向导既有保守值（后端 schema
      // default=4，取值域 ge=1 le=8，2 合法——非 UI 暴露项，行为维持不变）。
      agent_cross_mention: true,
      cross_mention_depth: 4,
      context_window: 20,
      ...(invited.length > 0
        ? {
            user_members: invited.map((u) => ({
              user_id: u.user_id,
              ...(u.avatar ? { avatar: u.avatar } : {}),
            })),
          }
        : {}),
      ...(agentCards.length > 0
        ? {
            agent_members: agentCards.map((c) => ({
              display_name: c.displayName.trim(),
              ...(c.avatar ? { avatar: c.avatar } : {}),
              runtime_id: c.runtimeId!,
              workspace_id: c.workspaceId || null,
              provider: c.provider,
              llm_provider_id: c.llmProviderId || null,
              agent_profile_id: c.agentProfileId || null,
            })),
          }
        : {}),
    };
    createMutation.mutate(payload);
  };

  /* ── 卡片编辑 ── */

  const updateCard = (id: string, patch: Partial<AgentMemberCardState>) => {
    setAgentCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  };
  const removeCard = (id: string) => {
    setAgentCards((prev) => prev.filter((c) => c.id !== id));
  };

  if (!open) return null;

  const showErrors = submitAttempted;

  /** 被邀人昵称解析（头像上传行展示用）。 */
  const invitedLabel = (userId: string): string =>
    memberOptions.find((o) => o.value === userId)?.label ?? userId.slice(0, 8);

  return (
    <Modal
      open={open}
      title="新建群聊"
      width={560}
      onCancel={onCancel}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          {step > 0 && (
            <Button
              onClick={() => {
                setStep(step - 1);
                setSubmitAttempted(false);
              }}
            >
              上一步
            </Button>
          )}
          {step < WIZARD_STEPS.length - 1 ? (
            <Button
              type="primary"
              disabled={!stepValid}
              title={stepValid ? undefined : "请先完成本步必填项"}
              onClick={() => setStep(step + 1)}
            >
              下一步
            </Button>
          ) : (
            <Button
              type="primary"
              loading={createMutation.isPending}
              disabled={!stepValid}
              title={stepValid ? undefined : "请修正 Agent 成员配置"}
              onClick={handleSubmit}
            >
              创建群聊
            </Button>
          )}
        </div>
      }
    >
      {/* 步骤指示（对照原型 .modal 三步语义；brand 语义阶选中态） */}
      <div className="mb-3 flex items-center gap-1.5" aria-label="建群步骤">
        {WIZARD_STEPS.map((label, i) => (
          <span
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]",
              i === step
                ? "bg-brand-100 font-semibold text-brand-700"
                : i < step
                  ? "text-brand-600"
                  : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold",
                i === step
                  ? "bg-brand-600 text-white"
                  : i < step
                    ? "bg-brand-100 text-brand-700"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {i < step ? "✓" : i + 1}
            </span>
            {label}
          </span>
        ))}
      </div>

      {/* ── 步骤① 群信息 ── */}
      {step === 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              群名称 <span className="text-destructive">*</span>
            </span>
            <Input
              aria-label="群名称"
              placeholder="如：前端攻坚小分队"
              maxLength={GROUP_TITLE_MAX_LEN}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              status={showErrors && titleError ? "error" : undefined}
            />
            {showErrors && titleError && (
              <span className="text-[11px] text-destructive">{titleError}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              所属项目 <span className="text-destructive">*</span>
            </span>
            <Select
              id="cgw-project"
              aria-label="所属项目"
              className="w-full"
              placeholder="搜索并选择 PPM 项目"
              showSearch
              optionFilterProp="label"
              value={projectId ?? undefined}
              onChange={(v) => setProjectId(v ?? null)}
              loading={projectsQ.isLoading}
              options={projectOptions}
            />
            {(showErrors && projectId == null) && (
              <span className="text-[11px] text-destructive">请选择所属项目</span>
            )}
            {projectsQ.isSuccess && projectOptions.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                暂无可选项目——请先在项目管理中创建项目后再建群
              </span>
            )}
            {projectsQ.isError && (
              <span className="text-[11px] text-destructive">
                项目列表加载失败：{errMessage(projectsQ.error, "请稍后重试")}
              </span>
            )}
            {workspaceHint && (
              <span
                data-testid="cgw-workspace-hint"
                className={cn(
                  "text-[11px]",
                  workspaceHint.kind === "empty"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {workspaceHint.text}
              </span>
            )}
          </div>
          <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
            群聊归属 PPM 项目：群工作区取项目关联工作区，可邀请项目成员、
            添加 Agent 成员协作——@昵称 唤起指定 Agent，@全体 通知所有 Agent；
            未被 @ 的消息仅进群背景摘要。
          </p>
        </div>
      )}

      {/* ── 步骤② 邀请用户（项目人员） ── */}
      {step === 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              邀请用户（项目成员，可跳过）
            </span>
            <span className="text-[11px] text-muted-foreground">
              已选 {invited.length}/{GROUP_USER_MEMBER_LIMIT}（不含群主）
            </span>
          </div>
          <Select
            id="cgw-invitees"
            aria-label="邀请用户"
            className="w-full"
            mode="multiple"
            maxTagCount="responsive"
            maxCount={GROUP_USER_MEMBER_LIMIT}
            placeholder={
              projectMembersQ.isLoading ? "加载项目成员中…" : "搜索并选择要邀请的项目成员"
            }
            value={invited.map((u) => u.user_id)}
            onChange={(ids: string[]) =>
              // 保号同步：保留已选成员已上传的头像，移除的丢弃。
              setInvited((prev) =>
                ids.map(
                  (uid) =>
                    prev.find((p) => p.user_id === uid) ?? {
                      user_id: uid,
                      avatar: null,
                    },
                ),
              )
            }
            options={memberOptions}
            loading={projectMembersQ.isLoading}
          />
          {invited.length > 0 && (
            <div
              data-testid="cgw-invited-avatars"
              className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-2"
            >
              <span className="text-[11px] text-muted-foreground">
                群内头像（可选，未设置时显示昵称首字）
              </span>
              {invited.map((u) => (
                <div key={u.user_id} className="flex items-center gap-2">
                  <GroupMemberAvatarUpload
                    value={u.avatar}
                    name={invitedLabel(u.user_id)}
                    label={`被邀成员 ${invitedLabel(u.user_id)} 头像`}
                    onChange={(avatar) =>
                      setInvited((prev) =>
                        prev.map((p) =>
                          p.user_id === u.user_id ? { ...p, avatar } : p,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
            仅该项目成员可邀请（上限 {GROUP_USER_MEMBER_LIMIT} 人）；你将作为群主，
            被邀请成员即可查看并参与群聊。
          </p>
        </div>
      )}

      {/* ── 步骤③ Agent 成员（六要素卡片） ── */}
      {step === 2 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Agent 成员（{agentCards.length}/{GROUP_AGENT_MEMBER_LIMIT}，可跳过）
            </span>
            <Button
              size="small"
              disabled={agentCards.length >= GROUP_AGENT_MEMBER_LIMIT}
              title={
                agentCards.length >= GROUP_AGENT_MEMBER_LIMIT
                  ? `Agent 成员上限 ${GROUP_AGENT_MEMBER_LIMIT} 个`
                  : undefined
              }
              onClick={() =>
                setAgentCards((prev) => [...prev, newAgentCard()])
              }
            >
              <Plus aria-hidden className="h-3 w-3" /> 添加 Agent 成员
            </Button>
          </div>
          <p className="rounded-md bg-info/10 px-2.5 py-1.5 text-xs leading-5 text-info">
            添加 Agent 成员时逐一配置六要素：机器 / 工作区 / 引擎 / 模型 /
            智能体方案 / 群昵称（群内唯一，作为 @提及词）。
          </p>
          {agentCards.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
              暂未添加 Agent 成员——点上方「添加 Agent 成员」开始配置
            </p>
          )}
          <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto pr-0.5">
            {agentCards.map((card, idx) => {
              const nameError = nameErrorOf(card);
              const runtimeMissing = card.runtimeId == null;
              const workspaceMissing = card.workspaceId === "";
              return (
                <div
                  key={card.id}
                  data-testid="agent-member-card"
                  className="rounded-lg border border-border bg-card p-3 shadow-sm"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      aria-hidden
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white"
                    >
                      <Bot aria-hidden className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[13px] font-semibold text-foreground">
                      Agent 成员 {idx + 1}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      aria-label={`移除 Agent 成员 ${idx + 1}`}
                      onClick={() => removeCard(card.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {/* 成员头像（可选，quick 群成员头像自定义） */}
                  <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                    <GroupMemberAvatarUpload
                      value={card.avatar}
                      name={card.displayName || `Agent ${idx + 1}`}
                      label={`Agent 成员 ${idx + 1} 头像`}
                      onChange={(avatar) => updateCard(card.id, { avatar })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        群昵称（@提及词）*
                      </span>
                      <Input
                        aria-label={`Agent 成员 ${idx + 1} 群昵称`}
                        placeholder="如：小码"
                        maxLength={GROUP_MEMBER_NAME_MAX_LEN}
                        value={card.displayName}
                        onChange={(e) =>
                          updateCard(card.id, { displayName: e.target.value })
                        }
                        status={nameError ? "error" : undefined}
                      />
                      {nameError && (
                        <span
                          data-testid="agent-name-error"
                          className="text-[11px] leading-4 text-destructive"
                        >
                          {nameError}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        机器 *
                      </span>
                      <Select
                        id={`cgw-runtime-${idx}`}
                        aria-label={`Agent 成员 ${idx + 1} 机器`}
                        className="w-full"
                        placeholder="选择在线机器 / 智能体"
                        value={card.runtimeId ?? undefined}
                        onChange={(v) => updateCard(card.id, { runtimeId: v })}
                        options={runtimeOptions}
                        status={
                          showErrors && runtimeMissing ? "error" : undefined
                        }
                      />
                      {showErrors && runtimeMissing && (
                        <span className="text-[11px] leading-4 text-destructive">
                          请选择机器
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        工作区 *
                      </span>
                      <Select
                        id={`cgw-card-ws-${idx}`}
                        aria-label={`Agent 成员 ${idx + 1} 工作区`}
                        className="w-full"
                        placeholder="项目关联工作区内选择"
                        value={card.workspaceId || undefined}
                        onChange={(v) =>
                          updateCard(card.id, { workspaceId: v ?? "" })
                        }
                        options={projectWorkspaceOptions}
                        status={
                          showErrors && workspaceMissing ? "error" : undefined
                        }
                      />
                      {showErrors && workspaceMissing && (
                        <span className="text-[11px] leading-4 text-destructive">
                          请选择工作区（项目关联集内）
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        引擎
                      </span>
                      <Select
                        id={`cgw-engine-${idx}`}
                        aria-label={`Agent 成员 ${idx + 1} 引擎`}
                        className="w-full"
                        value={card.provider}
                        onChange={(v) => {
                          // 引擎切换重置模型选择（供应商仅 claude 引擎语义，
                          // session-config-bar providerLocked 同源）。
                          updateCard(card.id, {
                            provider: v,
                            llmProviderId: "",
                          });
                        }}
                        options={ENGINE_OPTIONS.map((o) => ({ ...o }))}
                      />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        模型（LLM 供应商）
                      </span>
                      <Select
                        id={`cgw-model-${idx}`}
                        aria-label={`Agent 成员 ${idx + 1} 模型`}
                        className="w-full"
                        placeholder="不指定（本机默认）"
                        allowClear
                        value={card.llmProviderId || undefined}
                        onChange={(v) =>
                          updateCard(card.id, { llmProviderId: v ?? "" })
                        }
                        disabled={card.provider !== "claude"}
                        options={[
                          { value: "", label: "不指定（本机默认）" },
                          ...providerOptions,
                        ]}
                      />
                      {card.provider !== "claude" && (
                        <span className="text-[11px] text-muted-foreground">
                          Codex 引擎使用其本机模型配置，无需选择供应商
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        智能体方案（人格 / 工具集 / 技能）
                      </span>
                      <Select
                        id={`cgw-profile-${idx}`}
                        aria-label={`Agent 成员 ${idx + 1} 智能体方案`}
                        className="w-full"
                        placeholder="不指定，用默认"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        value={card.agentProfileId || undefined}
                        onChange={(v) =>
                          updateCard(card.id, { agentProfileId: v ?? "" })
                        }
                        options={[
                          { value: "", label: "不指定，用默认" },
                          ...profileOptions,
                        ]}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ────────────────────── 群行 facepile 辅助（session-list-panel 复用导出） ────────────────────── */

/**
 * 成员头像堆叠预览（facepile，原型 .facepile/.fp）：avatar 有值 → 头像图片
 *（GroupMemberAvatar）；无值 → agent=brand 紫、用户=info 青圆形字头像，前 N
 * 个 + 溢出 +n；空成员回退渐变群头像。群分区行与群视图顶栏共用。
 */
export function MemberFacepile({
  members,
  max = 3,
  size = "sm",
}: {
  members: { display_name: string; member_type: string; avatar?: string | null }[];
  max?: number;
  size?: "sm" | "md";
}): ReactNode {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  const px = size === "md" ? 28 : 18;
  const dim =
    size === "md"
      ? "h-7 w-7 text-[11px]"
      : "h-[18px] w-[18px] text-[9px]";
  if (shown.length === 0) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-info font-bold text-white",
          dim,
        )}
      >
        群
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((m, i) => (
        <GroupMemberAvatar
          key={`${m.display_name}-${i}`}
          avatar={m.avatar}
          name={m.display_name}
          size={px}
          title={m.display_name}
          className={cn("rounded-full border border-card", i > 0 && "-ml-1")}
          fallbackClassName={cn(
            dim,
            m.member_type === "agent" ? "bg-brand-600" : "bg-info",
          )}
        />
      ))}
      {rest > 0 && (
        <span
          title={`另 ${rest} 名成员`}
          className={cn(
            "flex items-center justify-center rounded-full border border-card bg-muted font-semibold text-muted-foreground",
            dim,
            "-ml-1",
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
