"use client";

/**
 * MemberPanel — 群聊成员面板（2026-09-01-session-group-chat task-09 / FR-14 /
 * FR-15，design §7「成员面板（右抽屉）」+ 原型 prototype-group-chat.html
 * .members-panel / .member-row / .agent-card / .ac-kv / .online-dot 视觉锚点）。
 *
 * 依据：
 *   - tasks/task-09.md（implementation 1/2 点：用户成员在线/移除 + agent 成员
 *     六要素卡片/热切换弹窗/重置记忆；acceptance 分组渲染/在线态/二次确认）
 *   - design.md §4.5 配置热切换（provider/llm/profile 下轮生效；runtime/workspace
 *     切换重建影子会话重置记忆，切换前确认）、§6.1 成员端点、§8 生命周期表
 *     member.config.switched / presence.upsert
 *   - FRONTEND_PAGE_STYLE.md §0/§0.5（antd 组件 + brand 语义阶 / shadow token /
 *     状态 StatusBadge / 确认 Modal.confirm 不用 window.confirm）
 *
 * 结构（独立组件，由 task-08 群聊面板挂载；本卡在 sessions-portal
 * GroupChatPanelMount 占位内以右列形态先行渲染）：
 *   - 群设置区（quick 群 P2）：输入草稿预览开关（群主可见；本地态 +
 *     PATCH settings_json.typing_preview——群读体未透出 settings_json，
 *     无服务端回显真值）；
 *   - Agent 成员区：六要素卡片（昵称/机器/工作区/引擎/模型/方案——config_snapshot
 *     JSON 自取键容错）+ 团队能力开关（quick 群成员团队能力：PATCH team_enabled，
 *     热切换走重建分支——确认弹窗照机器组惯例；仅 Claude 可开）+ shadow_status
 *     徽标（active 在线 / pending 待建 / none 未建 / ended 已结束 / failed 异常）
 *     +「运行中」动态徽标（runningMemberIds 命中——群详情 shadow_running ∪
 *     SSE agent typing live 态，群聊运行态可见 quick 2026-09-02）
 *     +「打断」按钮（quick 群 P1：任意群成员可打断该成员当前任务——后端
 *     interrupt 端点放行全员，按钮不按 isOwner 门控；仅运行中（running
 *     命中）渲染，未运行不占位——2026-09-04 收紧）
 *     +「切换配置」热切换弹窗 +「重置记忆」+「移除」（群主可见）；
 *   - 用户成员区：头像 + 昵称 + 在线绿点（online_member_ids 命中 user_id，
 *     presence 数据源）/ 离线灰点 + 群主标识 + 移除按钮（群主可见，confirm 后
 *     removeGroupMember）；
 *   - 分区头「+ 邀请用户」「+ 添加 Agent」入口（群聊体验对齐 quick 内建：
 *     群主可见）——邀请 = 项目人员多选（listProjectMembers 排除已在群）逐个
 *     POST members（user 体含 display_name 默认用户名）；添加 Agent = 单张
 *     六要素表单（昵称/机器/工作区=项目关联/引擎/模型/方案/团队能力/头像——
 *     照建群向导第三步单卡字段）POST members（agent 体）。
 *
 * 热切换弹窗（对照原型 switchModal）：引擎/模型/方案/机器/工作区五下拉（数据源
 * 同 task-07 向导：useDaemonMachines / listProviders / useMineAgentProfiles /
 * listWorkspaces），提交 updateGroupMember（仅送变更字段——后端 PATCH None=不改
 * 口径）；**机器或工作区变更时 Modal.confirm 二次确认提示「将重置该成员的
 * 独立记忆」**（design §4.5）。群主权限后端强校验（update_member
 * _require_group_owner），前端按钮按 isOwner 门控。
 */

import { useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Drawer, Input, Modal, Select, Switch, Tooltip } from "antd";
import { Plus, Square, UserMinus } from "lucide-react";

import { SessionPanel } from "@/components/daemon/session-panel";
import { validateMemberDisplayName } from "@/components/group-chat/create-group-wizard";
import { useMineAgentProfiles } from "@/lib/agent-profiles";
import { ApiError } from "@/lib/api";
import { listProviders } from "@/lib/api/llm-providers";
import { errMessage, useNotify } from "@/lib/errors";
import { listProjectMembers } from "@/lib/ppm/project";
import { listProjectWorkspaces } from "@/lib/workspace";
import {
  addGroupMember,
  interruptGroupMember,
  PROVIDER_META,
  removeGroupMember,
  resetGroupMemberMemory,
  updateGroupChat,
  updateGroupMember,
  type GroupChatRead,
  type GroupMemberAgentConfig,
  type GroupMemberRead,
  type GroupMemberUpdate,
} from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { listWorkspaces } from "@/lib/workspaces";
import {
  GroupMemberAvatar,
  GroupMemberAvatarUpload,
} from "@/components/group-chat/group-member-avatar";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/* ────────────────────── 常量与纯辅助 ────────────────────── */

/** 引擎选项（与 task-07 向导 ENGINE_OPTIONS 同源两档；群聊 agent 成员仅 claude/codex）。 */
const ENGINE_OPTIONS = [
  { label: "Claude Code", value: "claude" },
  { label: "Codex", value: "codex" },
] as const;

/** 支持作为群 agent 成员的引擎白名单（机器下拉 runtime 过滤，向导同源）。 */
const GROUP_SUPPORTED_PROVIDERS = new Set(["claude", "codex"]);

/**
 * shadow_status 徽标口径（design §3.3 none/pending/active/failed + 移除/解散
 * 后的 ended）：agent 成员「在线」即影子会话 active。
 */
const SHADOW_STATUS_META: Record<string, { kind: StatusKind; label: string }> = {
  active: { kind: "success", label: "在线" },
  pending: { kind: "warning", label: "待建" },
  failed: { kind: "error", label: "异常" },
  ended: { kind: "neutral", label: "已结束" },
  none: { kind: "neutral", label: "未建" },
};

function shadowStatusMeta(status: string): { kind: StatusKind; label: string } {
  return SHADOW_STATUS_META[status] ?? { kind: "neutral", label: "未知" };
}

/** config_snapshot JSON 自取键（容错：非字符串/空值 → null，展示层兜底）。 */
function snapshotString(
  member: GroupMemberRead,
  key: string,
): string | null {
  const v = (member.config_snapshot ?? {})[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 面板内工作区名解析查询键（与热切换弹窗共享缓存）。 */
const MEMBER_PANEL_WORKSPACES_KEY = ["workspaces", "member-panel"] as const;

/**
 * 热切换 payload 组装（纯函数，单测推理面）：仅送变更字段（后端 PATCH
 * None=不改，task-04 update_member 口径）；工作区锚 null=沿用群工作区，比较
 * 与送参均按「生效工作区 id」（缺省解析为 group.workspace_id）展开——切换到
 * 群工作区本身是可表达的显式值（null 重置不可表达，见 daemon.ts 端点注释）。
 */
export function buildMemberUpdatePayload(
  member: GroupMemberRead,
  group: GroupChatRead,
  next: {
    provider: string;
    llmProviderId: string;
    agentProfileId: string;
    runtimeId: string;
    workspaceId: string;
  },
): GroupMemberUpdate {
  const payload: GroupMemberUpdate = {};
  if (next.provider !== (member.provider ?? "")) payload.provider = next.provider;
  if (next.llmProviderId !== (member.llm_provider_id ?? "")) {
    payload.llm_provider_id = next.llmProviderId || null;
  }
  if (next.agentProfileId !== (member.agent_profile_id ?? "")) {
    payload.agent_profile_id = next.agentProfileId || null;
  }
  if (next.runtimeId && next.runtimeId !== member.runtime_id) {
    payload.runtime_id = next.runtimeId;
  }
  const effectiveWorkspace = next.workspaceId || group.workspace_id;
  if (effectiveWorkspace !== (member.workspace_id ?? group.workspace_id)) {
    payload.workspace_id = effectiveWorkspace;
  }
  return payload;
}

/* ────────────────────── 组件 ────────────────────── */

export interface MemberPanelProps {
  /** 群详情（GET /api/daemon/group-chats/{id}，members 含六要素 + shadow_status）。 */
  group: GroupChatRead;
  /**
   * 在线用户 id 集（presence 数据源 = GroupChatListItemRead.online_member_ids，
   * design §5.4；缺省空 = 全离线灰点）。online_member_ids 挂在列表项读体上，
   * 详情读体不含——由消费方（task-08 面板 / 列表快照）透传。
   */
  onlineMemberIds?: readonly string[];
  /**
   * 运行中 agent 成员 id 集（群聊运行态可见 quick，2026-09-02）：数据源 =
   * 群详情 members[].shadow_running ∪ SSE agent typing live 态（由消费方
   * group-chat-panel 计算透传）；命中 → agent 卡「运行中」动态徽标。
   */
  runningMemberIds?: ReadonlySet<string>;
  /** 当前用户 id（群主判定 = group.created_by；null = 未登录/未知，只读态）。 */
  currentUserId: string | null;
  /** 操作成功后的刷新回调（消费方 invalidate 群列表 + 群详情）。 */
  onRefresh?: () => void;
  className?: string;
}

export function MemberPanel({
  group,
  onlineMemberIds,
  runningMemberIds,
  currentUserId,
  onRefresh,
  className,
}: MemberPanelProps) {
  const notify = useNotify();
  const [switching, setSwitching] = useState<GroupMemberRead | null>(null);
  /* ── 群聊体验对齐 quick（2026-09-02）：邀请用户 / 添加 Agent 内建入口
   *    （群主可见；原 onInviteUser/onAddAgent props 回调形态退役）。 ── */
  const [inviting, setInviting] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);
  /* ── 群聊体验对齐 quick（2026-09-02）：影子会话面板——agent 卡整卡点击打开
   *    Drawer 内嵌 SessionPanel（mode="dialog"，会话面板本体；群主 + 普通成员
   *    都可打开——影子 logs 读端点已放行普通成员，写操作后端强校验群主）。 ── */
  const [viewingShadow, setViewingShadow] = useState<GroupMemberRead | null>(null);

  // 工作区名解析（六要素「工作区」行展示 + 热切换弹窗选项共用）。
  const workspacesQ = useQuery({
    queryKey: MEMBER_PANEL_WORKSPACES_KEY,
    queryFn: () => listWorkspaces({ limit: 100 }),
    staleTime: 60_000,
  });
  const workspaceName = (id: string | null | undefined): string => {
    if (!id) return "—";
    const ws = (workspacesQ.data?.items ?? []).find((w) => w.id === id);
    return ws ? (ws.display_alias ?? ws.name) : id.slice(0, 8);
  };

  const workspaceOptions = useMemo(() => {
    // 群工作区作显式选项置顶（「沿用」语义的可达表达——PATCH null=不改不可
    // 用于重置回缺省）；其余活跃工作区跟随其后（去重防群工作区重复出现）。
    const opts: { value: string; label: string }[] = [
      {
        value: group.workspace_id,
        label: `${workspaceName(group.workspace_id)}（群工作区）`,
      },
    ];
    const seen = new Set([group.workspace_id]);
    for (const ws of workspacesQ.data?.items ?? []) {
      if (ws.status !== "active" || seen.has(ws.id)) continue;
      seen.add(ws.id);
      opts.push({ value: ws.id, label: ws.display_alias ?? ws.name });
    }
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.workspace_id, workspacesQ.data]);

  const isOwner = currentUserId != null && group.created_by === currentUserId;
  const onlineSet = useMemo(
    () => new Set(onlineMemberIds ?? []),
    [onlineMemberIds],
  );
  const activeMembers = useMemo(
    () => (group.members ?? []).filter((m) => m.removed_at == null),
    [group.members],
  );
  const agentMembers = useMemo(
    () => activeMembers.filter((m) => m.member_type === "agent"),
    [activeMembers],
  );
  const userMembers = useMemo(
    () => activeMembers.filter((m) => m.member_type !== "agent"),
    [activeMembers],
  );

  /* ── 变更操作（一律走 task-07 群 API 客户端） ── */

  const refreshAnd = (message: string) => {
    notify.success(message);
    onRefresh?.();
  };

  const switchMutation = useMutation({
    mutationFn: (vars: { memberId: string; payload: GroupMemberUpdate }) =>
      updateGroupMember(group.id, vars.memberId, vars.payload),
    onSuccess: (member, vars) => {
      // 机器/工作区变更走重建分支（design §4.5）：提示语随 diff 分化。
      const memoryReset =
        vars.payload.runtime_id !== undefined ||
        vars.payload.workspace_id !== undefined;
      refreshAnd(
        memoryReset
          ? `已切换「${member.display_name}」的配置（独立记忆已重置，下次被 @ 时重建）`
          : `已切换「${member.display_name}」的配置（下一轮生效）`,
      );
      setSwitching(null);
    },
    onError: (err) => {
      notify.error(err, "切换配置失败，请稍后重试");
    },
  });

  const resetMemoryMutation = useMutation({
    mutationFn: (memberId: string) =>
      resetGroupMemberMemory(group.id, memberId),
    onSuccess: (member) => {
      refreshAnd(`已重置「${member.display_name}」的独立记忆`);
    },
    onError: (err) => {
      notify.error(err, "重置记忆失败，请稍后重试");
    },
  });

  /* ── quick 群 P1 打断：POST members/{mid}/interrupt（**任意群成员可打断**
   *    ——后端放行，前端按钮全员可见、仅运行中渲染）；打断后 run 终态由
   *    daemon 回报，运行徽标经 onRefresh 详情 refetch 的 shadow_running 收口
   *    （不做本地乐观剔除，徽标由后端状态驱动）。 ── */
  const interruptMutation = useMutation({
    mutationFn: (memberId: string) => interruptGroupMember(group.id, memberId),
    onSuccess: (res) => {
      refreshAnd(`已打断「${res.display_name}」的当前任务`);
    },
    onError: (err) => {
      // 409 = 该成员当前没有运行中的任务（后端中文文案透传 warning，非失败态）。
      if (err instanceof ApiError && err.status === 409) {
        notify.warning(errMessage(err));
        return;
      }
      notify.error(err, "打断失败，请稍后重试");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeGroupMember(group.id, memberId),
    onSuccess: () => {
      refreshAnd("已移出群聊");
    },
    onError: (err) => {
      notify.error(err, "移除成员失败，请稍后重试");
    },
  });

  /* ── quick 群成员团队能力：PATCH team_enabled（热切换归机器组重建分支——
   *    stage 随 lease 建时定，须重建影子才能换工具注入，UI 照机器组切换
   *    「重建重置记忆」确认惯例）。 ── */
  const teamMutation = useMutation({
    mutationFn: (vars: { memberId: string; teamEnabled: boolean }) =>
      updateGroupMember(group.id, vars.memberId, {
        team_enabled: vars.teamEnabled,
      }),
    onSuccess: (member) => {
      refreshAnd(
        `已${member.team_enabled ? "开启" : "关闭"}「${member.display_name}」的团队能力` +
          "（影子会话将重建，独立记忆已重置）",
      );
    },
    onError: (err) => {
      notify.error(err, "切换团队能力失败，请稍后重试");
    },
  });

  /* ── quick 群成员头像自定义：换头像 / 恢复默认（PATCH members/{mid}
   *    avatar——后端 None=不改、空串=清除；上传管线同建群向导）。 ── */
  const avatarMutation = useMutation({
    mutationFn: (vars: { memberId: string; avatar: string }) =>
      updateGroupMember(group.id, vars.memberId, { avatar: vars.avatar }),
    onSuccess: (member) => {
      refreshAnd(`已更新「${member.display_name}」的头像`);
    },
    onError: (err) => {
      notify.error(err, "更新头像失败，请稍后重试");
    },
  });

  /* ── quick 群 P2 群设置：typing 草稿预览开关（settings_json.typing_preview，
   *    后端默认关=只显示「正在输入」）。群读体（GroupChatRead/DetailRead）未
   *    透出 settings_json——回显无服务端真值，Switch 以本地态为准（挂载默认
   *    关=后端默认值，切一次后以本地态为准），切换即 PATCH 局部写（settings_json
   *    键级合并，只动 typing_preview 不触碰 guardrails），失败回滚本地态。 ── */
  const [typingPreview, setTypingPreview] = useState(false);
  const typingPreviewMutation = useMutation({
    mutationFn: (next: boolean) =>
      updateGroupChat(group.id, { settings_json: { typing_preview: next } }),
    onMutate: (next) => {
      setTypingPreview(next);
    },
    onError: (err, next) => {
      setTypingPreview(!next);
      notify.error(err, "设置失败，请稍后重试");
    },
    onSuccess: (_res, next) => {
      notify.success(next ? "已开启输入草稿预览" : "已关闭输入草稿预览");
    },
  });

  /* ── 群聊体验对齐 quick：邀请用户（项目人员多选 → 逐个 POST members user 体；
   *    display_name 默认用户名——后端 GroupMemberUserCreate 同口径）。 ── */
  const inviteMutation = useMutation({
    mutationFn: async (items: { user_id: string; display_name: string }[]) => {
      // 逐个串行：后端按 display_name 查重，避免并发落库竞态。
      for (const item of items) {
        await addGroupMember(group.id, {
          user: { user_id: item.user_id, display_name: item.display_name },
        });
      }
    },
    onSuccess: (_res, items) => {
      refreshAnd(
        items.length > 1
          ? `已邀请 ${items.length} 位用户入群`
          : `已邀请「${items[0]?.display_name ?? "成员"}」入群`,
      );
      setInviting(false);
    },
    onError: (err) => {
      // 后端 400 中文文案透传（如非项目成员/昵称重复）。
      notify.error(err, "邀请失败，请稍后重试");
    },
  });

  /* ── 群聊体验对齐 quick：添加 Agent（单张六要素表单 → POST members agent 体；
   *    quick 群 P1：响应 GroupMemberAddRead.warnings 预检提示逐条透传——
   *    未指定模型走本机默认 LLM 出口，与建群向导同口径双保险）。 ── */
  const addAgentMutation = useMutation({
    mutationFn: (config: GroupMemberAgentConfig) =>
      addGroupMember(group.id, { agent: config }),
    onSuccess: (member) => {
      refreshAnd(`已添加 Agent 成员「${member.display_name}」`);
      for (const w of member.warnings ?? []) notify.warning(w);
      setAddingAgent(false);
    },
    onError: (err) => {
      notify.error(err, "添加 Agent 成员失败，请稍后重试");
    },
  });

  /* ── 确认入口（antd Modal.confirm，不用 window.confirm） ── */

  /** 移除成员（agent → end 影子会话；design §8 group.member.removed）。 */
  const confirmRemove = (member: GroupMemberRead) => {
    Modal.confirm({
      title: `移除「${member.display_name}」？`,
      content:
        member.member_type === "agent"
          ? "将移出该 Agent 成员并结束其影子会话（独立记忆一并清除）。该操作不可恢复。"
          : "该成员将被移出群聊，不再可见此群的消息。该操作不可恢复。",
      okText: "确认移除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => removeMutation.mutate(member.id),
    });
  };

  /** 重置记忆（结束影子会话置 pending，下次被 @ 按现配置懒重建，design §6.1）。 */
  const confirmResetMemory = (member: GroupMemberRead) => {
    Modal.confirm({
      title: `重置「${member.display_name}」的独立记忆？`,
      content:
        "将结束其当前影子会话，下次被 @ 时按当前配置重新建立（历史群聊记录不受影响）。",
      okText: "重置记忆",
      cancelText: "取消",
      onOk: () => resetMemoryMutation.mutate(member.id),
    });
  };

  /**
   * 打断该成员当前任务（quick 群 P1）：任意群成员可操作——中断其正在处理中的
   * 这一轮（影子会话与独立记忆保留，下一轮可继续）。
   */
  const confirmInterrupt = (member: GroupMemberRead) => {
    Modal.confirm({
      title: `确定打断「${member.display_name}」的当前任务？`,
      content:
        "该成员正在处理中的这一轮将被中止；影子会话与独立记忆保留，下一轮可继续。",
      okText: "打断",
      cancelText: "取消",
      onOk: () => interruptMutation.mutate(member.id),
    });
  };

  /**
   * 切换团队能力（quick 群成员团队能力）：走后端机器组重建分支——弹
   * 「将重建影子会话并重置独立记忆」确认（design §4.5 机器组切换同惯例）。
   */
  const confirmToggleTeam = (member: GroupMemberRead, next: boolean) => {
    Modal.confirm({
      title: `${next ? "开启" : "关闭"}「${member.display_name}」的团队能力？`,
      content: next
        ? "开启后该成员可派分身并行执行子任务。将重建其影子会话并重置独立记忆（历史群聊记录不受影响）。"
        : "关闭后该成员不再可用分身协作。将重建其影子会话并重置独立记忆（历史群聊记录不受影响）。",
      okText: "确认切换",
      cancelText: "取消",
      onOk: () =>
        teamMutation.mutate({ memberId: member.id, teamEnabled: next }),
    });
  };

  /** agent 卡整卡点击 → 打开影子会话面板（内嵌按钮/开关不透传，防误开）。 */
  const handleAgentCardClick = (member: GroupMemberRead) => (e: MouseEvent<HTMLDivElement>) => {
    if (!member.shadow_session_id) return;
    if (
      (e.target as HTMLElement).closest(
        "button, a, input, textarea, [role='switch'], [role='button'], label",
      )
    ) {
      return;
    }
    setViewingShadow(member);
  };

  return (
    <aside
      data-testid="group-member-panel"
      aria-label="群成员面板"
      className={cn(
        /* 高度契约：h-full 吃满挂载列高（宽屏右列是 grid 拉伸项 / 窄屏是
         * Drawer body，均有定高），成员多时根节点 overflow-y-auto 内部滚动
         * ——面板与群聊会话列同高，不被内容撑破（session-list-panel 根
         * h-full 同惯例）。 */
        "flex h-full min-h-0 w-full flex-col overflow-y-auto rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      {/* 面板头（原型 .mp-title） */}
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="text-[15px] font-semibold text-foreground">群成员</h3>
        <span className="text-[11px] text-muted-foreground">
          {activeMembers.length} 名成员 · {agentMembers.length} 位 Agent ·{" "}
          {userMembers.length} 位用户
        </span>
      </div>

      {/* ── 群设置（quick 群 P2）：输入草稿预览开关（群主可见；回显无服务端
          真值——本地态 + PATCH settings_json.typing_preview，见 mutation 注释） ── */}
      {isOwner && (
        <div className="mx-3.5 my-2 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Switch
              size="small"
              checked={typingPreview}
              loading={typingPreviewMutation.isPending}
              onChange={(checked) => typingPreviewMutation.mutate(checked)}
              aria-label="输入草稿预览"
              data-testid="group-typing-preview-switch"
            />
            <span className="text-[11.5px] font-medium text-foreground">
              输入草稿预览
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            开启后群成员可看到彼此正在输入的草稿内容；关闭时仅显示「正在输入」。
          </p>
        </div>
      )}

      {/* ── Agent 成员区（原型 .sec-label + .agent-card） ── */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          Agent 成员（{agentMembers.length}）
        </p>
        {isOwner && (
          <button
            type="button"
            data-testid="member-panel-add-agent"
            onClick={() => setAddingAgent(true)}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            <Plus aria-hidden className="h-3 w-3" /> 添加 Agent
          </button>
        )}
      </div>
      {agentMembers.length === 0 && (
        <p className="mx-4 mb-2 rounded-md border border-dashed border-border px-3 py-2.5 text-center text-xs text-muted-foreground">
          暂无 Agent 成员——@提及需要至少一位 Agent 成员
        </p>
      )}
      {agentMembers.map((member) => {
        const status = shadowStatusMeta(member.shadow_status);
        // 运行中（群聊运行态可见 quick）：影子会话有活跃 run——brand 描边动态徽标。
        const running = runningMemberIds?.has(member.id) ?? false;
        // quick 影子会话面板：有影子会话即可整卡点击打开（title 提示）。
        const shadowViewable = member.shadow_session_id != null;
        return (
          <div
            key={member.id}
            data-testid={`agent-member-card-${member.id}`}
            onClick={handleAgentCardClick(member)}
            title={shadowViewable ? "点击打开该成员的影子会话面板" : undefined}
            className={cn(
              "mx-3.5 my-2 rounded-lg border border-border bg-card p-3 shadow-sm",
              shadowViewable && "cursor-pointer transition-colors hover:border-brand-300",
            )}
          >
            {/* 卡片头：头像 + 昵称 + 影子状态徽标（原型 .ac-head；quick：
                avatar 有值→图片，无值→首字回退） */}
            <div className="flex items-center gap-2.5">
              <GroupMemberAvatar
                avatar={member.avatar}
                name={member.display_name}
                size={36}
                className="rounded-[10px]"
                fallbackClassName="h-9 w-9 bg-brand-600 text-[13px]"
              />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                  <span className="truncate">{member.display_name}</span>
                  <StatusBadge kind={status.kind}>{status.label}</StatusBadge>
                  {running && (
                    <span
                      data-testid={`member-running-badge-${member.id}`}
                      title="影子会话有活跃 run（正在处理群消息）"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-1.5 py-px text-[10px] font-semibold text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-300"
                    >
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500"
                      />
                      运行中
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  @{member.display_name}（@提及词）
                </p>
              </div>
            </div>
            {/* 六要素（原型 .ac-kv：64px 标签列 + 值列） */}
            <dl className="mt-2.5 grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[11.5px]">
              <dt className="text-muted-foreground/70">机器</dt>
              <dd className="font-medium text-muted-foreground">
                {snapshotString(member, "machine_name") ?? "—"}
                {member.runtime_id && (
                  <code className="ml-1 rounded bg-muted px-1 py-px font-mono text-[10.5px]">
                    {member.runtime_id.slice(0, 8)}
                  </code>
                )}
              </dd>
              <dt className="text-muted-foreground/70">工作区</dt>
              <dd className="truncate font-medium text-muted-foreground">
                {workspaceName(member.workspace_id ?? group.workspace_id)}
                {member.workspace_id == null && (
                  <span className="ml-1 text-muted-foreground/70">
                    （群工作区）
                  </span>
                )}
              </dd>
              <dt className="text-muted-foreground/70">引擎</dt>
              <dd className="font-medium text-muted-foreground">
                {PROVIDER_META[member.provider ?? ""]?.label ??
                  member.provider ??
                  "—"}
              </dd>
              <dt className="text-muted-foreground/70">模型</dt>
              <dd className="truncate font-medium text-muted-foreground">
                {snapshotString(member, "model") ?? "未指定（本机默认）"}
              </dd>
              <dt className="text-muted-foreground/70">方案</dt>
              <dd className="truncate font-medium text-muted-foreground">
                {snapshotString(member, "profile_name") ?? "默认"}
              </dd>
            </dl>
            {/* 团队能力（quick 群成员团队能力）：全员可见展示；群主可切换
                （PATCH team_enabled → 机器组重建分支，确认弹窗）；仅 Claude
                引擎可开（codex 禁用 + tooltip，与建群向导同口径） */}
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
              <Tooltip
                title={
                  (member.provider ?? "claude") !== "claude"
                    ? "团队能力仅支持 Claude 引擎"
                    : undefined
                }
              >
                <Switch
                  size="small"
                  checked={member.team_enabled}
                  disabled={
                    !isOwner ||
                    (member.provider ?? "claude") !== "claude" ||
                    teamMutation.isPending
                  }
                  onChange={(checked) => confirmToggleTeam(member, checked)}
                  aria-label={`切换 ${member.display_name} 团队能力`}
                  data-testid={`team-switch-${member.id}`}
                />
              </Tooltip>
              <span className="text-[11px] font-medium text-muted-foreground">
                团队能力
              </span>
              <span className="text-[11px] text-muted-foreground">
                {member.team_enabled
                  ? "已开启 · 可派分身并行干活"
                  : "未开启"}
              </span>
            </div>
            {/* 操作行：打断按钮**全员可见、仅运行中渲染**（quick 群 P1——后端
                interrupt 端点放行任意群成员；running 命中=影子会话有活跃 run 才
                有任务可断，未运行/无影子不渲染不占位——2026-09-04 收紧）；切换
                配置/重置记忆/移除仅群主可见（后端 update/reset/remove 端点 owner
                强校验；quick 头像：换头像上传件随行，onChange 直调 PATCH）。 */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {isOwner && (
                <>
                  <GroupMemberAvatarUpload
                    compact
                    value={member.avatar ?? null}
                    name={member.display_name}
                    label={`Agent 成员 ${member.display_name} 头像`}
                    onChange={(avatar) =>
                      avatarMutation.mutate({
                        memberId: member.id,
                        avatar: avatar ?? "",
                      })
                    }
                  />
                  <Button
                    size="small"
                    type="primary"
                    disabled={switchMutation.isPending}
                    onClick={() => setSwitching(member)}
                  >
                    切换配置
                  </Button>
                  <Button
                    size="small"
                    loading={resetMemoryMutation.isPending}
                    onClick={() => confirmResetMemory(member)}
                  >
                    重置记忆
                  </Button>
                </>
              )}
              {running && (
                <Button
                  size="small"
                  icon={<Square aria-hidden className="h-3 w-3" />}
                  loading={interruptMutation.isPending}
                  onClick={() => confirmInterrupt(member)}
                  aria-label={`打断 ${member.display_name}`}
                  title="打断该成员当前运行中的任务"
                  data-testid={`member-interrupt-${member.id}`}
                >
                  打断
                </Button>
              )}
              {isOwner && (
                <>
                  <span className="flex-1" />
                  <Button
                    size="small"
                    type="text"
                    danger
                    aria-label={`移除 ${member.display_name}`}
                    title="移出群聊"
                    onClick={() => confirmRemove(member)}
                  >
                    <UserMinus aria-hidden className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* ── 用户成员区（原型 .sec-label + .member-row） ── */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          用户成员（{userMembers.length}）
        </p>
        {isOwner && (
          <button
            type="button"
            data-testid="member-panel-invite-user"
            onClick={() => setInviting(true)}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            <Plus aria-hidden className="h-3 w-3" /> 邀请用户
          </button>
        )}
      </div>
      {userMembers.map((member) => {
        const isGroupOwner =
          member.user_id != null && member.user_id === group.created_by;
        const online = member.user_id != null && onlineSet.has(member.user_id);
        // quick 头像：群主或本人可换头像（群主管理语义 + 用户自定义本人头像）。
        const canChangeAvatar =
          isOwner || (member.user_id != null && member.user_id === currentUserId);
        return (
          <div
            key={member.id}
            data-testid={`user-member-row-${member.id}`}
            className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-muted/50"
          >
            <GroupMemberAvatar
              avatar={member.avatar}
              name={member.display_name}
              size={32}
              className="rounded-[9px]"
              fallbackClassName={cn(
                "h-8 w-8 text-xs",
                isGroupOwner ? "bg-brand-600" : "bg-info",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <span className="truncate">{member.display_name}</span>
                {isGroupOwner && (
                  <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                    群主
                  </span>
                )}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                @{member.display_name}
              </p>
            </div>
            {/* 在线态（presence 绿点 / 离线灰点，原型 .online-dot/.offline-dot） */}
            <span
              role="img"
              aria-label={`${member.display_name} ${online ? "在线" : "离线"}`}
              title={online ? "在线" : "离线"}
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                online
                  ? "bg-success ring-[3px] ring-success/25"
                  : "bg-muted-foreground/40",
              )}
            />
            {canChangeAvatar && (
              <GroupMemberAvatarUpload
                compact
                value={member.avatar ?? null}
                name={member.display_name}
                label={`用户成员 ${member.display_name} 头像`}
                onChange={(avatar) =>
                  avatarMutation.mutate({
                    memberId: member.id,
                    avatar: avatar ?? "",
                  })
                }
              />
            )}
            {isOwner && !isGroupOwner && (
              <Button
                size="small"
                type="text"
                danger
                aria-label={`移除 ${member.display_name}`}
                title="移出群聊"
                onClick={() => confirmRemove(member)}
              >
                <UserMinus aria-hidden className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}

      {/* 热切换弹窗（条件挂载：打开才拉机器/供应商/方案数据源） */}
      {switching && (
        <AgentConfigSwitchModal
          group={group}
          member={switching}
          workspaceOptions={workspaceOptions}
          submitting={switchMutation.isPending}
          onCancel={() => setSwitching(null)}
          onSubmit={(payload) =>
            switchMutation.mutate({ memberId: switching.id, payload })
          }
        />
      )}

      {/* 影子会话面板（2026-09-02 quick：自研查看器退役，改挂 SessionPanel
          mode="dialog" 会话面板本体——与正常会话同一内核：logs 预取 / SSE 实时
          流 / inject 追问 / 打断 / 结束 / 视图切换全保留，顶部用量条由面板 dialog
          分支自带）。antd Drawer 全宽抽屉，Portal 挂 body——320px 右栏内嵌不下
          长会话面板（CLAUDE.md 侧栏内宽内容走浮层惯例）。 */}
      {viewingShadow && viewingShadow.shadow_session_id && (
        <ShadowSessionDrawer
          member={viewingShadow}
          onClose={() => setViewingShadow(null)}
        />
      )}

      {/* 群聊体验对齐 quick：邀请用户 / 添加 Agent 内建对话框（条件挂载——
          打开才拉项目人员 / 机器等数据源）。 */}
      {inviting && (
        <InviteUsersModal
          group={group}
          existingUserIds={
            new Set(
              activeMembers
                .map((m) => m.user_id)
                .filter((id): id is string => id != null),
            )
          }
          submitting={inviteMutation.isPending}
          onCancel={() => setInviting(false)}
          onSubmit={(items) => inviteMutation.mutate(items)}
        />
      )}
      {addingAgent && (
        <AddAgentMemberModal
          group={group}
          existingNames={activeMembers.map((m) => m.display_name)}
          submitting={addAgentMutation.isPending}
          onCancel={() => setAddingAgent(false)}
          onSubmit={(config) => addAgentMutation.mutate(config)}
        />
      )}
    </aside>
  );
}

/* ────────────────────── 热切换弹窗（原型 switchModal） ────────────────────── */

interface AgentConfigSwitchModalProps {
  group: GroupChatRead;
  member: GroupMemberRead;
  /** 工作区下拉选项（面板查询组装：群工作区置顶 + 其余活跃工作区）。 */
  workspaceOptions: { value: string; label: string }[];
  submitting: boolean;
  onCancel: () => void;
  /** 提交回调（payload 已过二次确认；调用方执行 updateGroupMember）。 */
  onSubmit: (_payload: GroupMemberUpdate) => void;
}

function AgentConfigSwitchModal({
  group,
  member,
  workspaceOptions,
  submitting,
  onCancel,
  onSubmit,
}: AgentConfigSwitchModalProps) {
  // 初始值 = 成员当前六要素（条件挂载 → 每次打开重置）；工作区缺省锚 =
  // 生效工作区（null 沿用群工作区 → 以群工作区 id 显式表达）。
  const [provider, setProvider] = useState(member.provider ?? "claude");
  const [llmProviderId, setLlmProviderId] = useState(
    member.llm_provider_id ?? "",
  );
  const [agentProfileId, setAgentProfileId] = useState(
    member.agent_profile_id ?? "",
  );
  const [runtimeId, setRuntimeId] = useState(member.runtime_id ?? "");
  const [workspaceId, setWorkspaceId] = useState(
    member.workspace_id ?? group.workspace_id,
  );

  // 数据源同 task-07 向导：机器（useDaemonMachines 融合候选）/ 模型
  // （listProviders）/ 方案（useMineAgentProfiles）；工作区选项经 props 复用
  // 面板查询。弹窗条件挂载 → 仅打开时发起查询。
  const { machineCandidates } = useDaemonMachines({ limit: 100 });
  const providersQ = useQuery({
    queryKey: ["llmProviders", "member-panel-switch"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const { profiles } = useMineAgentProfiles();

  const runtimeOptions = useMemo(() => {
    const groups: {
      label: string;
      options: { value: string; label: string; disabled?: boolean }[];
    }[] = [];
    let hasCurrent = false;
    for (const m of machineCandidates ?? []) {
      const machineOnline = m.status === "online";
      const runtimes = (m.runtimes ?? []).filter((r) =>
        GROUP_SUPPORTED_PROVIDERS.has(r.provider ?? ""),
      );
      if (runtimes.length === 0) continue;
      const alias = m.display_alias?.trim() || m.hostname;
      for (const r of runtimes) {
        if (r.id === member.runtime_id) hasCurrent = true;
      }
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
    // 当前机器不在候选（离线/共享失效）时补显式回退项，保证已选值可见可改。
    if (member.runtime_id && !hasCurrent) {
      groups.unshift({
        label: "当前机器",
        options: [
          {
            value: member.runtime_id,
            label: `${snapshotString(member, "machine_name") ?? member.runtime_id.slice(0, 8)}（当前）`,
          },
        ],
      });
    }
    return groups;
  }, [machineCandidates, member]);

  const providerOptions = useMemo(() => {
    const opts = (providersQ.data ?? []).map((p) => ({
      value: p.id,
      label: p.name,
    }));
    // 已设模型不在列表（供应商被删）时补回退项；未设模型提供「不指定」。
    if (member.llm_provider_id && !opts.some((o) => o.value === member.llm_provider_id)) {
      opts.unshift({
        value: member.llm_provider_id,
        label: `${member.llm_provider_id.slice(0, 8)}（当前）`,
      });
    }
    if (!member.llm_provider_id) {
      opts.unshift({ value: "", label: "不指定（本机默认）" });
    }
    return opts;
  }, [providersQ.data, member]);

  const profileOptions = useMemo(() => {
    const opts = profiles.map((p) => ({ value: p.id, label: p.name }));
    if (member.agent_profile_id && !opts.some((o) => o.value === member.agent_profile_id)) {
      opts.unshift({
        value: member.agent_profile_id,
        label: `${member.agent_profile_id.slice(0, 8)}（当前）`,
      });
    }
    if (!member.agent_profile_id) {
      opts.unshift({ value: "", label: "不指定，用默认" });
    }
    return opts;
  }, [profiles, member]);

  const payload = useMemo(
    () =>
      buildMemberUpdatePayload(member, group, {
        provider,
        llmProviderId,
        agentProfileId,
        runtimeId,
        workspaceId,
      }),
    [member, group, provider, llmProviderId, agentProfileId, runtimeId, workspaceId],
  );
  const dirty = Object.keys(payload).length > 0;
  // 机器或工作区变更 → 重建影子会话重置记忆（design §4.5）：弹窗内即时警示 +
  // 应用时 Modal.confirm 二次确认。
  const memoryResetWarned =
    payload.runtime_id !== undefined || payload.workspace_id !== undefined;

  const handleApply = () => {
    if (!dirty || submitting) return;
    if (memoryResetWarned) {
      Modal.confirm({
        title: "切换机器 / 工作区将重置独立记忆",
        content: `「${member.display_name}」的影子会话将按新配置重建，其独立记忆会被重置（历史群聊记录不受影响）。确定继续？`,
        okText: "确认切换",
        cancelText: "取消",
        onOk: () => onSubmit(payload),
      });
      return;
    }
    onSubmit(payload);
  };

  return (
    <Modal
      open
      title={`切换「${member.display_name}」的 Agent 配置`}
      width={520}
      onCancel={onCancel}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!dirty}
            title={dirty ? undefined : "未修改任何配置"}
            onClick={handleApply}
          >
            应用（下轮生效）
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
          群聊进行中随时切换，在当前轮结束后生效（下一轮边界热切换），不影响
          其他成员。
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            引擎供应商
          </span>
          <Select
            id="mp-switch-engine"
            aria-label="引擎供应商"
            className="w-full"
            value={provider}
            onChange={setProvider}
            options={ENGINE_OPTIONS.map((o) => ({ ...o }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            模型（LLM 供应商）
          </span>
          <Select
            id="mp-switch-model"
            aria-label="模型（LLM 供应商）"
            className="w-full"
            value={llmProviderId}
            onChange={(v) => setLlmProviderId(v ?? "")}
            disabled={provider !== "claude"}
            options={providerOptions}
          />
          {provider !== "claude" && (
            <span className="text-[11px] text-muted-foreground">
              Codex 引擎使用其本机模型配置，无需选择供应商
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            智能体方案（人格 / 工具集 / 技能）
          </span>
          <Select
            id="mp-switch-profile"
            aria-label="智能体方案（人格 / 工具集 / 技能）"
            className="w-full"
            allowClear
            showSearch
            optionFilterProp="label"
            value={agentProfileId || undefined}
            onChange={(v) => setAgentProfileId(v ?? "")}
            options={profileOptions}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">机器</span>
          <Select
            id="mp-switch-runtime"
            aria-label="机器"
            className="w-full"
            value={runtimeId || undefined}
            onChange={setRuntimeId}
            options={runtimeOptions}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            工作区
          </span>
          <Select
            id="mp-switch-workspace"
            aria-label="工作区"
            className="w-full"
            value={workspaceId || undefined}
            onChange={setWorkspaceId}
            options={workspaceOptions}
          />
        </div>
        {memoryResetWarned && (
          <p
            data-testid="mp-switch-memory-warn"
            className="rounded-md bg-warning/10 px-2.5 py-1.5 text-xs leading-5 text-warning"
          >
            机器或工作区变更将重建该成员的影子会话并重置其独立记忆（切换前
            需确认）。
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ────────────────────── 影子会话 Drawer（SessionPanel dialog 内嵌） ────────────────────── */

/**
 * 影子会话面板 Drawer（群聊体验 quick 2026-09-02 重做：自研 shadow-session-viewer
 * 退役，改挂会话面板本体）。影子会话即普通 AgentSession（kind='group_member'），
 * SessionPanel mode="page"（2026-09-02 版式统一：与 /sessions 全页同一渲染
 * 分支——头部工具栏/搜索/加载更早/视图切换/用量条完整版式；dialog 紧凑形态退役
 * 于本场景）自取数链路零适配直挂——logs 预取 /
 * SSE 实时流 / inject 追问 / 打断 / 结束 / 对话·进度视图切换 / 输入框上方用量条
 * 全部走面板既有分支（与 /sessions 页同一内核，像素级一致）。
 *
 * dialog 必需 props 照 WorkerSessionOverlay 先例（session-panel.tsx 分身浮层）：
 * providers/defaultProvider 取成员引擎；hasOnlineProvider 由成员 runtime 在线性
 * 派生（机器融合候选查询，与热切换弹窗同 hook——离线时输入/选择器禁用 + 「未
 * 连接」徽标兜底）。key=影子会话 id 驱动整体 remount（R6 重挂载契约）。
 *
 * 权限面（后端强校验，前端保持开放查看）：logs 读端点已放行群成员；SSE / 会话
 * 详情 / inject / usage 仅群主（影子属主）——普通成员打开可见历史回放，发送
 * 会收后端中文错误透传（细化体验归后续 quick）。
 */
function ShadowSessionDrawer({
  member,
  onClose,
}: {
  /** 目标 agent 成员（调用方保证 shadow_session_id 非空）。 */
  member: GroupMemberRead;
  onClose: () => void;
}) {
  const { machineCandidates } = useDaemonMachines({ limit: 100 });
  // 2026-09-02 版式统一：SessionPanel 切 page 分支（与 /sessions 全页完全同构，
  // 含头部工具栏/搜索/加载更早/用量条），需补 page 必需的 machines/llmProviders。
  const providersQ = useQuery({
    queryKey: ["llm-providers"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const shadowSessionId = member.shadow_session_id!;
  return (
    <Drawer
      open
      onClose={onClose}
      width="min(920px, 94vw)"
      destroyOnClose
      title={`${member.display_name} · 影子会话`}
      /* 面板本体自带完整 chrome（头部/输入区边距），Drawer body 零内边距对齐
         正常会话页布局；宽度沿用原查看器档位。 */
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <SessionPanel
          key={shadowSessionId}
          mode="page"
          sessionId={shadowSessionId}
          machines={machineCandidates ?? []}
          llmProviders={providersQ.data ?? []}
        />
      </div>
    </Drawer>
  );
}

/* ────────────────────── 邀请用户对话框（群聊体验对齐 quick，2026-09-02） ────────────────────── */

interface InviteUsersModalProps {
  group: GroupChatRead;
  /** 已在群用户 id 集（候选排除——含群主本人）。 */
  existingUserIds: ReadonlySet<string>;
  submitting: boolean;
  onCancel: () => void;
  /** 提交回调（选中项含解析后的默认昵称；调用方逐个 POST members）。 */
  onSubmit: (_items: { user_id: string; display_name: string }[]) => void;
}

/** 项目人员昵称解析（GroupMemberUserCreate.display_name 默认值 = 用户名）。 */
function projectMemberLabel(m: {
  user_id: string;
  user_name?: string | null;
  username?: string | null;
}): string {
  return m.user_name?.trim() || m.username?.trim() || m.user_id.slice(0, 8);
}

/**
 * 邀请用户对话框：项目人员多选（listProjectMembers——与建群向导第二步同数据
 * 源，后端「邀人范围=项目成员」400 校验的同口径前端引导），排除已在群成员。
 */
function InviteUsersModal({
  group,
  existingUserIds,
  submitting,
  onCancel,
  onSubmit,
}: InviteUsersModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  // 条件挂载（面板 inviting 态）→ 打开才拉项目人员。
  const membersQ = useQuery({
    queryKey: ["ppmProjectMembers", "member-panel-invite", group.project_id],
    queryFn: () => listProjectMembers({ pm_project_id: group.project_id! }),
    enabled: group.project_id != null,
    staleTime: 60_000,
  });
  const options = useMemo(
    () =>
      (membersQ.data ?? [])
        .filter((m) => !existingUserIds.has(m.user_id))
        .map((m) => ({
          value: m.user_id,
          label: projectMemberLabel(m),
        })),
    [membersQ.data, existingUserIds],
  );

  const handleSubmit = () => {
    if (selected.length === 0 || submitting) return;
    const byId = new Map(
      (membersQ.data ?? []).map((m) => [m.user_id, m] as const),
    );
    onSubmit(
      selected.map((uid) => ({
        user_id: uid,
        display_name: projectMemberLabel(byId.get(uid) ?? { user_id: uid }),
      })),
    );
  };

  return (
    <Modal
      open
      title="邀请用户入群"
      width={480}
      onCancel={onCancel}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={selected.length === 0}
            onClick={handleSubmit}
          >
            邀请（{selected.length}）
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {group.project_id == null ? (
          <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
            该群未关联项目，无法获取可邀请的项目成员。
          </p>
        ) : (
          <>
            <Select
              id="mp-invite-users"
              aria-label="邀请用户"
              className="w-full"
              mode="multiple"
              maxTagCount="responsive"
              placeholder={
                membersQ.isLoading ? "加载项目成员中…" : "搜索并选择要邀请的项目成员"
              }
              value={selected}
              onChange={setSelected}
              options={options}
              loading={membersQ.isLoading}
            />
            <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
              仅该群所属项目的成员可邀请（已在群成员不在候选中）；被邀请成员
              即可查看并参与群聊。
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ────────────────────── 添加 Agent 对话框（群聊体验对齐 quick，2026-09-02） ────────────────────── */

interface AddAgentMemberModalProps {
  group: GroupChatRead;
  /** 在群昵称集（查重——validateMemberDisplayName others 入参）。 */
  existingNames: string[];
  submitting: boolean;
  onCancel: () => void;
  /** 提交回调（六要素 + 头像 + 团队能力已组装；调用方 POST members agent 体）。 */
  onSubmit: (_config: GroupMemberAgentConfig) => void;
}

/**
 * 添加 Agent 对话框：单张六要素表单——照建群向导第三步单卡字段（昵称/机器/
 * 工作区=项目关联/引擎/模型/方案/团队能力/头像；向导卡片耦合向导状态抽不出
 * 公共子组件，此处做轻量对话框表单，校验复用向导导出的
 * validateMemberDisplayName 纯函数）。
 */
function AddAgentMemberModal({
  group,
  existingNames,
  submitting,
  onCancel,
  onSubmit,
}: AddAgentMemberModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [runtimeId, setRuntimeId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [provider, setProvider] = useState("claude");
  const [llmProviderId, setLlmProviderId] = useState("");
  const [agentProfileId, setAgentProfileId] = useState("");
  const [teamEnabled, setTeamEnabled] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // 数据源同向导第三步：机器（useDaemonMachines 融合候选）/ 模型
  // （listProviders）/ 方案（useMineAgentProfiles）/ 工作区=项目关联
  // （listProjectWorkspaces——agent 工作区须在项目关联集内必选）。
  const { machineCandidates } = useDaemonMachines({ limit: 100 });
  const providersQ = useQuery({
    queryKey: ["llmProviders", "member-panel-add-agent"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const { profiles } = useMineAgentProfiles();
  const projectWorkspacesQ = useQuery({
    queryKey: ["projectWorkspaces", "member-panel-add-agent", group.project_id],
    queryFn: () => listProjectWorkspaces(group.project_id!),
    enabled: group.project_id != null,
    staleTime: 60_000,
  });

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

  const workspaceOptions = useMemo(
    () =>
      (projectWorkspacesQ.data ?? []).map((w) => ({
        value: w.workspace_id,
        label: w.name,
      })),
    [projectWorkspacesQ.data],
  );
  const providerOptions = useMemo(
    () => (providersQ.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    [providersQ.data],
  );
  const profileOptions = useMemo(
    () => profiles.map((p) => ({ value: p.id, label: p.name })),
    [profiles],
  );

  const nameError = validateMemberDisplayName(displayName, existingNames);
  const runtimeMissing = runtimeId == null;
  const workspaceMissing = workspaceId === "";
  const valid = nameError === null && !runtimeMissing && !workspaceMissing;
  const showErrors = submitAttempted;

  const handleSubmit = () => {
    if (!valid || submitting) return;
    onSubmit({
      display_name: displayName.trim(),
      ...(avatar ? { avatar } : {}),
      runtime_id: runtimeId!,
      workspace_id: workspaceId || null,
      provider,
      llm_provider_id: llmProviderId || null,
      agent_profile_id: agentProfileId || null,
      team_enabled: provider === "claude" ? teamEnabled : false,
    });
  };

  return (
    <Modal
      open
      title="添加 Agent 成员"
      width={560}
      onCancel={onCancel}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!valid}
            title={valid ? undefined : "请完成昵称 / 机器 / 工作区必填项"}
            onClick={() => {
              setSubmitAttempted(true);
              handleSubmit();
            }}
          >
            添加
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-md bg-info/10 px-2.5 py-1.5 text-xs leading-5 text-info">
          配置六要素：机器 / 工作区 / 引擎 / 模型 / 智能体方案 / 群昵称
          （群内唯一，作为 @提及词）。
        </p>
        {/* 成员头像（可选，quick 群成员头像自定义） */}
        <div className="flex items-center gap-2 border-b border-border pb-2.5">
          <GroupMemberAvatarUpload
            value={avatar}
            name={displayName.trim() || "新 Agent"}
            label="Agent 成员头像"
            onChange={setAvatar}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              群昵称（@提及词）*
            </span>
            <Input
              aria-label="Agent 成员群昵称"
              placeholder="如：小码"
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              status={nameError ? "error" : undefined}
            />
            {nameError && (
              <span
                data-testid="mp-add-agent-name-error"
                className="text-[11px] leading-4 text-destructive"
              >
                {nameError}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">机器 *</span>
            <Select
              id="mp-add-agent-runtime"
              aria-label="Agent 成员机器"
              className="w-full"
              placeholder="选择在线机器 / 智能体"
              value={runtimeId ?? undefined}
              onChange={setRuntimeId}
              options={runtimeOptions}
              status={showErrors && runtimeMissing ? "error" : undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">工作区 *</span>
            <Select
              id="mp-add-agent-workspace"
              aria-label="Agent 成员工作区"
              className="w-full"
              placeholder="项目关联工作区内选择"
              value={workspaceId || undefined}
              onChange={(v) => setWorkspaceId(v ?? "")}
              options={workspaceOptions}
              status={showErrors && workspaceMissing ? "error" : undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">引擎</span>
            <Select
              id="mp-add-agent-engine"
              aria-label="Agent 成员引擎"
              className="w-full"
              value={provider}
              onChange={(v) => {
                // 引擎切换重置模型（供应商仅 claude 语义）；团队能力仅 Claude。
                setProvider(v);
                setLlmProviderId("");
                if (v !== "claude") setTeamEnabled(false);
              }}
              options={ENGINE_OPTIONS.map((o) => ({ ...o }))}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              模型（LLM 供应商）
            </span>
            <Select
              id="mp-add-agent-model"
              aria-label="Agent 成员模型"
              className="w-full"
              placeholder="不指定（本机默认）"
              allowClear
              value={llmProviderId || undefined}
              onChange={(v) => setLlmProviderId(v ?? "")}
              disabled={provider !== "claude"}
              options={[
                { value: "", label: "不指定（本机默认）" },
                ...providerOptions,
              ]}
            />
            {provider !== "claude" && (
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
              id="mp-add-agent-profile"
              aria-label="Agent 成员智能体方案"
              className="w-full"
              placeholder="不指定，用默认"
              allowClear
              showSearch
              optionFilterProp="label"
              value={agentProfileId || undefined}
              onChange={(v) => setAgentProfileId(v ?? "")}
              options={[{ value: "", label: "不指定，用默认" }, ...profileOptions]}
            />
          </div>
          {/* 团队能力开关：仅 Claude 引擎可开（向导第三步同口径）。 */}
          <div className="col-span-2 flex items-center gap-2 border-t border-border pt-2">
            <Tooltip
              title={provider !== "claude" ? "团队能力仅支持 Claude 引擎" : undefined}
            >
              <Switch
                size="small"
                checked={teamEnabled}
                disabled={provider !== "claude"}
                onChange={setTeamEnabled}
                aria-label="Agent 成员团队能力"
                data-testid="mp-add-agent-team"
              />
            </Tooltip>
            <span className="text-[11px] font-medium text-muted-foreground">
              团队能力
            </span>
            <span className="text-[11px] text-muted-foreground">
              可派分身并行干活（仅 Claude 引擎）
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
