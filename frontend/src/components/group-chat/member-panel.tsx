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
 *   - Agent 成员区：六要素卡片（昵称/机器/工作区/引擎/模型/方案——config_snapshot
 *     JSON 自取键容错）+ shadow_status 徽标（active 在线 / pending 待建 /
 *     none 未建 / ended 已结束 / failed 异常）+「切换配置」热切换弹窗 +
 *     「重置记忆」+「移除」（群主可见）；
 *   - 用户成员区：头像 + 昵称 + 在线绿点（online_member_ids 命中 user_id，
 *     presence 数据源）/ 离线灰点 + 群主标识 + 移除按钮（群主可见，confirm 后
 *     removeGroupMember）；
 *   - 分区头「+ 添加」「+ 邀请」入口按钮经 props 回调暴露（向导复用 task-07）。
 *
 * 热切换弹窗（对照原型 switchModal）：引擎/模型/方案/机器/工作区五下拉（数据源
 * 同 task-07 向导：useDaemonMachines / listProviders / useMineAgentProfiles /
 * listWorkspaces），提交 updateGroupMember（仅送变更字段——后端 PATCH None=不改
 * 口径）；**机器或工作区变更时 Modal.confirm 二次确认提示「将重置该成员的
 * 独立记忆」**（design §4.5）。群主权限后端强校验（update_member
 * _require_group_owner），前端按钮按 isOwner 门控。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Modal, Select } from "antd";
import { Plus, UserMinus } from "lucide-react";

import { useMineAgentProfiles } from "@/lib/agent-profiles";
import { listProviders } from "@/lib/api/llm-providers";
import { errMessage, useNotify } from "@/lib/errors";
import {
  PROVIDER_META,
  removeGroupMember,
  resetGroupMemberMemory,
  updateGroupMember,
  type GroupChatRead,
  type GroupMemberRead,
  type GroupMemberUpdate,
} from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { listWorkspaces } from "@/lib/workspaces";
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
  /** 当前用户 id（群主判定 = group.created_by；null = 未登录/未知，只读态）。 */
  currentUserId: string | null;
  /** 操作成功后的刷新回调（消费方 invalidate 群列表 + 群详情）。 */
  onRefresh?: () => void;
  /** 「+ 邀请」用户成员入口（向导复用 task-07；不传则不渲染入口）。 */
  onInviteUser?: () => void;
  /** 「+ 添加」agent 成员入口（同上）。 */
  onAddAgent?: () => void;
  className?: string;
}

export function MemberPanel({
  group,
  onlineMemberIds,
  currentUserId,
  onRefresh,
  onInviteUser,
  onAddAgent,
  className,
}: MemberPanelProps) {
  const notify = useNotify();
  const [switching, setSwitching] = useState<GroupMemberRead | null>(null);

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
      notify.error(errMessage(err, "切换配置失败，请稍后重试"));
    },
  });

  const resetMemoryMutation = useMutation({
    mutationFn: (memberId: string) =>
      resetGroupMemberMemory(group.id, memberId),
    onSuccess: (member) => {
      refreshAnd(`已重置「${member.display_name}」的独立记忆`);
    },
    onError: (err) => {
      notify.error(errMessage(err, "重置记忆失败，请稍后重试"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeGroupMember(group.id, memberId),
    onSuccess: () => {
      refreshAnd("已移出群聊");
    },
    onError: (err) => {
      notify.error(errMessage(err, "移除成员失败，请稍后重试"));
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

  return (
    <aside
      data-testid="group-member-panel"
      aria-label="群成员面板"
      className={cn(
        "flex min-h-0 w-full flex-col overflow-y-auto rounded-xl border border-border bg-card shadow-sm",
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

      {/* ── Agent 成员区（原型 .sec-label + .agent-card） ── */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          Agent 成员（{agentMembers.length}）
        </p>
        {onAddAgent && (
          <button
            type="button"
            data-testid="member-panel-add-agent"
            onClick={onAddAgent}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            <Plus aria-hidden className="h-3 w-3" /> 添加
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
        return (
          <div
            key={member.id}
            data-testid={`agent-member-card-${member.id}`}
            className="mx-3.5 my-2 rounded-lg border border-border bg-card p-3 shadow-sm"
          >
            {/* 卡片头：头像 + 昵称 + 影子状态徽标（原型 .ac-head） */}
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-600 text-[13px] font-bold text-white"
              >
                {member.display_name.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                  <span className="truncate">{member.display_name}</span>
                  <StatusBadge kind={status.kind}>{status.label}</StatusBadge>
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
            {/* 操作（群主可见——后端 update/reset 端点 owner 强校验） */}
            {isOwner && (
              <div className="mt-2.5 flex items-center gap-2">
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
              </div>
            )}
          </div>
        );
      })}

      {/* ── 用户成员区（原型 .sec-label + .member-row） ── */}
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          用户成员（{userMembers.length}）
        </p>
        {onInviteUser && (
          <button
            type="button"
            data-testid="member-panel-invite-user"
            onClick={onInviteUser}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            <Plus aria-hidden className="h-3 w-3" /> 邀请
          </button>
        )}
      </div>
      {userMembers.map((member) => {
        const isGroupOwner =
          member.user_id != null && member.user_id === group.created_by;
        const online = member.user_id != null && onlineSet.has(member.user_id);
        return (
          <div
            key={member.id}
            data-testid={`user-member-row-${member.id}`}
            className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-muted/50"
          >
            <span
              aria-hidden
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-xs font-bold text-white",
                isGroupOwner ? "bg-brand-600" : "bg-info",
              )}
            >
              {member.display_name.slice(0, 1)}
            </span>
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
