"use client";

/**
 * SessionsPortal — 三入口统一会话门户共享组件
 * （2026-08-22-workspace-sessions-portal task-01 / FR-01 / FR-05 / D-001@v1；
 * 2026-08-23-sessions-workspace-hub task-06 双态接线与上下文解析 / FR-03 /
 * FR-04 / FR-06 / D-101 / D-105 / D-107 / X-12）。
 *
 * 依据：
 *   - tasks/task-01.md、tasks/task-06.md（allowed_paths / implementation /
 *     acceptance / constraints）
 *   - design.md §2 FR-03/FR-04/FR-06、§7 接口定义（SessionPreContext）、
 *     §9 兼容策略（深链无效落空门户态）、§11 D-107
 *   - prototype-sessions-workspace-hub.html（.picker 两步浮层 / 预会话上下文行）
 *
 * 结构（task-06 起右侧三分支，替换原「未选会话 = NewSessionForm」形态）：
 *   左 320px SessionListPanel（task-05 工作区树，组头「＋」接 onNewInGroup）；
 *   右：
 *     1. selectedSessionId → SessionPanel 真会话（key={sessionId} 重挂载契约
 *        不变：key 变化即清 SSE/轮询/队列）；
 *     2. preContext → SessionPanel sessionId=null 预会话态（task-03 契约：与
 *        真会话同构空态 + 锁定上下文行，首句发送内部 createSession，成功经
 *        onPreSessionCreated 上报本组件切真会话）；
 *     3. 两者皆无 → 空门户态轻引导（不用表单；NewSessionForm 渲染分支已由
 *        本卡替换，组件文件与 import 删除归 task-07，X-12 / D-109）。
 *
 * 上下文解析（组头「＋」onNewInGroup，FR-04 / D-107）：
 *   优先级 = 筛选 tab（机器+智能体已选，ql-20260823-001 补齐直带链：
 *   SessionListPanel 随回调透出筛选态快照，两层均具体时直接合成
 *   preContext 跳过浮层）> 两步浮层兜底（task-04：①在线机器 → ②智能体
 *   默认 Claude 高亮，缺筛选层或该引擎无在线 runtime 时走此路径，
 *   onPick(runtimeId) 合成 preContext { workspaceId(组), runtimeId }）。
 *
 * change 入口预会话（task-07 / FR-06 / D-106 / X-13）：change scope 左侧为
 *   工作区树（ql-20260823-003 起与全局同形态，组头「＋」承载新建）
 *   按钮走同一两步浮层，onPick 合成 preContext 显式双传 workspaceId +
 *   changeId（change 级隐含 workspace，原 NewSessionForm bindChangeId 契约由
 *   preContext 继承）。NewSessionForm/WorkspaceSessionPicker 本卡全量退役
 *   （D-109，文件与 import 已删，X-12 起渲染分支即空）。
 *
 * quicklog 入口（task-10 / 2026-08-25-session-spec-binding / FR-04 / D-006@v1）：
 *   QuicklogScope（workspaceId+qlId）与 change 入口同构——scope 消费分支
 *   if-chain 判等逐一补齐（X-008）：portalTitle/scopedPickerWorkspaceId/
 *   defaultExpandedWorkspaceId/空态文案；组头「＋」与两步浮层 onPick 合成
 *   preContext { workspaceId, quickId, runtimeId }（X-13 双传语义 quicklog
 *   版，quickId 首句经 task-11 上送 quicklog_id 落自动绑定）。
 *
 * 状态机（FR-03 零残留）：
 *   - 组头＋ → 浮层开（当前选中态保持，取消零影响）；
 *   - onPick → preContext 置位 + 清 selectedSessionId（右侧三分支优先级：
 *     真会话 > 预会话 > 空门户）；
 *   - 首句创建成功（onPreSessionCreated）→ setSelectedSessionId（key 重挂载
 *     → 面板状态机自然接管）+ 清 preContext + invalidate ["agentSessions"]
 *     （新会话落对应分组顶部）；
 *   - 用户切走（列表 onSelect）→ 清 preContext（首句未发 = 零服务端残留）。
 *
 * 深链恢复（D-004@v1）语义保留：?session= 有效直达选中态；无效/无参静默落
 * 空门户态（原落新建表单态，design §9 兼容策略）。
 *
 * ?new=1 直达新建（ql-20260823-005，用户反馈：ppm/projects「发起团队」等外部
 * 入口应直达会话页，不让用户再手动点组头「＋」）：挂载解析一次，机器数据就绪
 * 后按 D-005 默认机器回退解析 runtime（默认 Claude）直接进预会话态；未命中自动
 * 弹两步浮层兜底；?session= 深链优先于本参数。
 *
 * workspace 入口预展开（FR-06）：scope.workspaceId → SessionListPanel
 * defaultExpandedWorkspaceId（挂载后仅该分组展开）。
 *
 * 页头「新建会话」按钮已移除（X-12：新建入口收敛到组头「＋」，actions 空）；
 * ql-20260823-003：change 页头按钮移除（D-106 修订，树组头「＋」统一承载；原 task-07 例外（其左侧
 * 平铺列表无组头「＋」，见上）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Clock, Plus, Sparkles } from "lucide-react";

import {
  SessionPanel,
  type SessionPreContext,
} from "@/components/daemon/session-panel";
import { PreSessionPicker } from "@/components/sessions/pre-session-picker";
import {
  SessionListPanel,
  type SessionListScope,
} from "@/components/sessions/session-list-panel";
import { GitStatusBar } from "@/components/git-log/git-status-bar";
import { PageContainer, PageHeader } from "@/components/layout";
import { listProviders } from "@/lib/api/llm-providers";
import {
  getAgentSession,
  subscribeAgentSessionsEvents,
  type AgentSessionRead,
  type DaemonMachineRead,
  type SessionCreateResponse,
} from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { debounceLeadingTrailing } from "@/lib/utils";

/* ────────────────────── 组件 ────────────────────── */

/** 会话列表刷新去抖窗口（2026-08-25 P1）：SSE 变更信号风暴合并（leading 立即 +
 *  trailing 合并），见 refreshSessionLists 注释。 */
const SESSION_LIST_REFRESH_DEBOUNCE_MS = 400;

export interface SessionsPortalProps {
  /**
   * 会话范围与创建绑定（判别联合，复用 task-04 自 session-list-panel 导出的
   * SessionListScope，不重复定义）；缺省 = 全局门户（/sessions 现状）。
   */
  scope?: SessionListScope;
}

export function SessionsPortal({ scope }: SessionsPortalProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // task-06（FR-03/D-101）：预会话上下文——组头「＋」浮层选完合成；切走/创建
  // 成功即清，不残留（首句未发时零服务端实体）。
  const [preContext, setPreContext] = useState<SessionPreContext | null>(null);
  // task-06（FR-04/D-107）：两步浮层开关 + 发起组的 workspaceId
  //（null = 非工作区分组，D-105）。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerWorkspaceId, setPickerWorkspaceId] = useState<string | null>(null);
  const qc = useQueryClient();

  // task-01（D-004@v1）：?session= 深链——挂载时解析一次（urlRestoreDoneRef
  // 守卫，先例 /runtimes/page.tsx:440）。getAgentSession 验证通过才设初始
  // 选中；无参不标记 done（后续导航仍可再入），无效 id catch 后静默忽略。
  const searchParams = useSearchParams();
  const urlRestoreDoneRef = useRef(false);
  useEffect(() => {
    if (urlRestoreDoneRef.current) return;
    const deepSessionId = searchParams.get("session");
    if (!deepSessionId) return;
    urlRestoreDoneRef.current = true;
    void getAgentSession(deepSessionId)
      .then(() => setSelectedSessionId(deepSessionId))
      .catch(() => {
        // 深链 session 不存在或无权访问：静默忽略，落空门户态（design §9，
        // 原落新建表单态——task-06 起表单分支已替换）。
      });
  }, [searchParams]);

  // 选中态 ↔ URL ?session= 双向同步（ql-20260824-001 用户反馈：页面刷新要
  // 保持当前会话）：列表选中 / 继续最近会话 / 预会话创建成功 → replace 写入
  // ?session=<id>（与当前参数一致时去重跳过）；进入预会话 / 删除选中 → 移除
  // 该参数（刷新不恢复已离开的会话）。new=1 已消费一并移除（选中态下直达
  // 新建语义已终结）；写参后置 urlRestoreDoneRef 防上方深链 effect 对自己
  // 写入的参数二次验证。replace 不产生历史记录，浏览器后退仍退出页面。
  const router = useRouter();
  const pathname = usePathname();
  const syncSessionParam = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      const unchanged =
        params.get("session") === id && !params.get("new");
      params.delete("new");
      if (id) params.set("session", id);
      else params.delete("session");
      if (unchanged) return;
      urlRestoreDoneRef.current = true;
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  // 机器列表：SessionPanel 离线判定 + PreSessionPicker 第一步数据源共用；
  // sessions/isLoading 供 ?new=1 直达的 D-005 默认机器解析（ql-20260823-005）。
  const { items: machines, sessions, isLoading: machinesLoading } =
    useDaemonMachines({ limit: 100 });

  // 最近会话（空门户快捷动作「继续最近会话」）：last_active_at 优先，其次
  // created_at；无会话返回 null 不渲染入口。
  const recentSession = useMemo(() => {
    if (sessions.length === 0) return null;
    return (
      [...sessions].sort(
        (a, b) =>
          parseTs(b.last_active_at ?? b.created_at) -
          parseTs(a.last_active_at ?? a.created_at),
      )[0] ?? null
    );
  }, [sessions]);

  // 供应商列表：CtxUsageRing 分母派生（role mapping one_m / fallback model）。
  const providersQ = useQuery({
    queryKey: ["llmProviders", "sessions-portal"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers = useMemo(() => providersQ.data ?? [], [providersQ.data]);

  /** 会话配置/状态变化后刷新左侧列表：invalidate ["agentSessions"] 前缀（树
   *  查询 + scope 过滤参全部命中）。注意 useDaemonMachines 的 sessions 旁路挂在
   *  ["daemonMachines"] 键下，不在本前缀命中范围——由其自身 15s 轮询兜底（勿再
   *  称「含旁路」，2026-08-25 修正过时注释）。
   *
   *  2026-08-25 P1 修复：经 debounceLeadingTrailing（leading+trailing，400ms）
   *  去抖——SSE 变更哑信号一轮典型 2~3 帧 + onTurnCompleted 主动刷新 + 10s
   *  轮询叠加，裸 invalidate 每帧触发 limit=500 全量重拉成风暴；首帧 leading
   *  立即刷新（即时反馈），窗口期密集信号合并为一次 trailing。所有触发源
   *  （SSE onEvent/onReconnected、面板 onSessionListRefresh、预会话创建成功）
   *  统一汇入本函数，单点去抖不串联延迟。 */
  const debouncedInvalidateSessions = useMemo(
    () =>
      debounceLeadingTrailing(
        () => {
          void qc.invalidateQueries({ queryKey: ["agentSessions"] });
        },
        SESSION_LIST_REFRESH_DEBOUNCE_MS,
      ),
    [qc],
  );
  useEffect(() => {
    // 卸载清挂起的 trailing（防卸载后幽灵 invalidate）。
    return () => debouncedInvalidateSessions.cancel();
  }, [debouncedInvalidateSessions]);
  const refreshSessionLists = useCallback(() => {
    debouncedInvalidateSessions();
  }, [debouncedInvalidateSessions]);

  // 会话列表变更信号订阅（2026-08-24-sessions-live-updates task-06 / design
  // §2.2 / D-001 / D-006）：backend 在会话创建/状态迁移/删除时经 Redis Pub/Sub
  // 广播哑信号（SSE 已按当前用户过滤），前端不解析 payload——收到信号
  // （onEvent，D-001 lazy refresh：信号→重拉）或断线重连成功（onReconnected，
  // D-006：不回放历史、重连补一次 invalidate 兜断连窗口丢失的信号）即复用
  // refreshSessionLists 前缀失效 ["agentSessions"] 重拉列表；scope 键在该前缀
  // 之下，三入口（全局/workspace/change）共用本门户自动全量生效，无 per-入口
  // 接线。卸载 close 终止订阅。deps 用 refreshSessionLists（自身 deps [qc]，
  // 身份等价于卡片写的 [qc]——仅 qc 变化时重订阅）。
  // F7（后端审查遗留 B6）：onConnected——订阅**首次建立**即补拉一次列表，兜
  // 「先拉快照（useQuery）后订阅（effect 建 SSE）」盲窗内丢失的变更（此前纯靠
  // 10s 轮询兜底）；重连建立时与 onReconnected 同点触发，经同一 400ms 去抖单点
  // 天然合并不成风暴。
  useEffect(() => {
    const sub = subscribeAgentSessionsEvents({
      onEvent: refreshSessionLists,
      onReconnected: refreshSessionLists,
      onConnected: refreshSessionLists,
    });
    return () => sub.close();
  }, [refreshSessionLists]);

  /** ql-20260823-005：?new=1 直达时预会话/兜底浮层的默认组——workspace/change
   *  scope 锁定本组，全局门户不指定（null，与组头「＋」非工作区分组同语义）。
   *  task-10（X-008 消费点四）：quicklog scope 同锁定本工作区。 */
  const scopedPickerWorkspaceId = useCallback(() => {
    if (
      scope?.kind === "workspace" ||
      scope?.kind === "change" ||
      scope?.kind === "quicklog"
    ) {
      return scope.workspaceId;
    }
    return null;
  }, [scope]);

  /** 合成 preContext 切预会话态（清选中——右侧三分支优先级真会话 > 预会话）；
   *  change scope 显式双传 workspaceId + changeId（X-13）——handlePickerPick 与
   *  ?new=1 直达两入口共用（ql-20260823-005 自原 handlePickerPick 主体提取）。
   *  task-10（FR-04）：quicklog scope 同款双传 workspaceId + quickId
   * （quickId 字段类型由 task-11 同 Wave 落地，两卡 constraints 已声明耦合）。 */
  const enterPreSession = useCallback(
    (runtimeId: string, workspaceId: string | null) => {
      setPreContext(
        scope?.kind === "change"
          ? {
              workspaceId: scope.workspaceId,
              changeId: scope.changeId,
              runtimeId,
            }
          : scope?.kind === "quicklog"
            ? {
                workspaceId: scope.workspaceId,
                quickId: scope.qlId,
                runtimeId,
              }
            : { workspaceId, runtimeId },
      );
      setSelectedSessionId(null);
      // ql-20260824-001：清选中同步清 ?session=（刷新不恢复已离开的会话）。
      syncSessionParam(null);
    },
    [scope, syncSessionParam],
  );

  // ql-20260823-005（用户反馈：ppm/projects「发起团队」等外部入口应直达会话页，
  // 不让用户再手动点组头「＋」新建）：?new=1 直达新建。挂载解析一次；?session=
  // 深链优先（同传时只恢复选中，不自动新建）；机器数据就绪后按 D-005 三级回退
  // 解析默认机器（resolveDefaultMachineId——导出注释即指明门户为消费点），取其
  // 在线 claude/codex runtime（默认 Claude，与浮层第二步「默认」高亮一致）直接
  // 进预会话态（首句 createSession，FR-03 零残留不变）；未命中自动弹两步浮层
  // 兜底（无在线机器等场景由浮层空态引导承接）。
  const autoNewDoneRef = useRef(false);
  useEffect(() => {
    if (autoNewDoneRef.current) return;
    if (searchParams.get("new") !== "1") return;
    if (searchParams.get("session")) {
      // 深链选中优先：让出本效应且不再触发（无效深链落空门户态，design §9）。
      autoNewDoneRef.current = true;
      return;
    }
    if (machinesLoading) return; // 机器数据未就绪不解析（空数组会误判无在线机器）
    autoNewDoneRef.current = true;
    const machineId = resolveDefaultMachineId(machines, sessions);
    const runtimes = (
      machines.find((m) => m.id === machineId)?.runtimes ?? []
    ).filter(
      (r) =>
        r.status === "online" &&
        (r.provider === "claude" || r.provider === "codex"),
    );
    const runtime = runtimes.find((r) => r.provider === "claude") ?? runtimes[0];
    if (runtime) {
      enterPreSession(runtime.id, scopedPickerWorkspaceId());
    } else {
      setPickerWorkspaceId(scopedPickerWorkspaceId());
      setPickerOpen(true);
    }
  }, [
    searchParams,
    machinesLoading,
    machines,
    sessions,
    enterPreSession,
    scopedPickerWorkspaceId,
  ]);

  // scope 派生（design §4.A）：标题范围后缀（固定文案，不拉 workspace 名）。
  // task-10（FR-04 / X-008 消费点三）：quicklog 后缀「 · 快速修复」并附 ql
  // 短码（scope.qlId 本身即短码，零额外查询；原型场景B .portal-head 方向）。
  // 创建绑定锁（原 NewSessionForm bindWorkspaceId/bindChangeId）已由
  // preContext 解析继承（workspace 入口=组 workspaceId；change/quicklog 入口
  // =scope 双传，task-07/task-10 接线）。
  const portalTitle = `智能体会话${
    scope?.kind === "workspace"
      ? " · 工作区"
      : scope?.kind === "change"
        ? " · 变更"
        : scope?.kind === "quicklog"
          ? ` · 快速修复 · ${scope.qlId}`
          : ""
  }`;
  // change scope（task-07 / FR-06 / D-106）：左侧平铺列表无组头「＋」，预会话
  // 入口由页头 actions 承载（X-12 的例外，仅此 scope 有页头按钮）。

  /**
   * 组头「＋」（FR-04 / D-107 优先级链第一段，ql-20260823-001 补齐）：两层筛选
   * tab 已选具体机器+智能体时**直接带上下文进预会话**（用户已在具体机器和智能体
   * 上，不再弹浮层重复选择）；缺任一层或该引擎无在线 runtime 时回退两步浮层。
   */
  const handleNewInGroup = useCallback(
    (workspaceId: string | null, filter?: { machineId: string; agent: string }) => {
      if (filter?.machineId && filter.agent) {
        const machine = machines.find((m) => m.id === filter.machineId);
        const runtime = machine?.runtimes?.find(
          (r) => r.status === "online" && r.provider === filter.agent,
        );
        if (runtime) {
          setSelectedSessionId(null);
          setPreContext(
            scope?.kind === "change"
              ? // change 入口组头不出现，保守与 handlePickerPick 双传语义对齐（X-13）。
                { workspaceId: scope.workspaceId, changeId: scope.changeId, runtimeId: runtime.id }
              : scope?.kind === "quicklog"
                ? // task-10（FR-04）：quicklog 入口双传 workspaceId + quickId
                  //（X-13 语义 quicklog 版，quickId 类型由 task-11 落地）。
                  { workspaceId: scope.workspaceId, quickId: scope.qlId, runtimeId: runtime.id }
                : { workspaceId, runtimeId: runtime.id },
          );
          // ql-20260824-001：清选中同步清 ?session=（同 enterPreSession）。
          syncSessionParam(null);
          return;
        }
      }
      setPickerWorkspaceId(workspaceId);
      setPickerOpen(true);
    },
    [machines, scope, syncSessionParam],
  );

  /** 浮层两步选完（两步即达）：合成 preContext 切预会话态并关浮层（X-13 双传
   *  语义收敛进 enterPreSession，ql-20260823-005 提取共用）。 */
  const handlePickerPick = useCallback(
    (runtimeId: string) => {
      enterPreSession(runtimeId, pickerWorkspaceId);
      setPickerOpen(false);
    },
    [enterPreSession, pickerWorkspaceId],
  );

  /**
   * 预会话首句创建成功（task-03 契约）：切真会话（key 重挂载 → 面板状态机
   * 自然接管）+ 清预会话态 + 刷新列表（新会话落对应分组顶部）。
   */
  const handlePreSessionCreated = useCallback(
    (resp: SessionCreateResponse) => {
      setPreContext(null);
      setSelectedSessionId(resp.session_id);
      // ql-20260824-001：新会话选中落 URL（刷新保持）。
      syncSessionParam(resp.session_id);
      refreshSessionLists();
    },
    [refreshSessionLists, syncSessionParam],
  );

  return (
    <PageContainer
      size="full"
      className="h-[calc(100vh-56px)] gap-3 py-4"
      aria-label={portalTitle}
    >
      {/* X-12：页头「新建会话」按钮移除——新建入口收敛到组头「＋」，actions 空；
          ql-20260823-003：change 亦树形态，页头按钮移除（D-106 修订）。
          task-03（2026-08-26-workspace-git-status）：workspace scope 挂紧凑态
          Git 状态条（CC-08——change/quicklog scope 虽携带 workspaceId，但语义
          是「围绕某变更的会话」，挂工作区健康状态偏离主题，不挂）。 */}
      <PageHeader
        title={portalTitle}
        subtitle="跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建"
        actions={
          scope?.kind === "workspace" ? (
            <GitStatusBar workspaceId={scope.workspaceId} variant="compact" />
          ) : undefined
        }
      />
      {/* 原型 .main-grid：左 320px 列表 + 右面板 */}
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-3.5">
        <SessionListPanel
          scope={scope}
          selectedSessionId={selectedSessionId}
          onSelect={(s) => {
            // 用户切走（task-06 / FR-03）：清预会话态不残留。
            setPreContext(null);
            setSelectedSessionId(s.id);
            // ql-20260824-001：选中落 URL（刷新保持当前会话）。
            syncSessionParam(s.id);
          }}
          onNewInGroup={handleNewInGroup}
          defaultExpandedWorkspaceId={
            scope?.kind === "workspace" ||
            scope?.kind === "change" ||
            scope?.kind === "quicklog"
              ? scope.workspaceId
              : undefined
          }
          onDeleteSessions={async (ids) => {
            // ql-20260818-012：逐条调 deleteAgentSession（后端软删），完成后
            // invalidate 列表 + 清除选中态（若选中被删的会话）。
            // task-01：前缀 ["agentSessions"] 同时覆盖全局
            //（["agentSessions","sessionsPortal",scope,serverParams] 单一路径——D-003@v2 起 scope 走全局端点加过滤参，前缀 invalidate 全覆盖。
            const { deleteAgentSession } = await import("@/lib/daemon");
            await Promise.allSettled(ids.map((id) => deleteAgentSession(id)));
            void qc.invalidateQueries({ queryKey: ["agentSessions"] });
            if (ids.includes(selectedSessionId ?? "")) {
              setSelectedSessionId(null);
              // ql-20260824-012：选中被删清空，同步移除 ?session=。
              syncSessionParam(null);
            }
          }}
          // 2026-08-24：归档/取消归档回调（照 onDeleteSessions 模式）。
          onArchiveSessions={async (ids) => {
            const { archiveAgentSession } = await import("@/lib/daemon");
            await Promise.allSettled(ids.map((id) => archiveAgentSession(id)));
            void qc.invalidateQueries({ queryKey: ["agentSessions"] });
            if (ids.includes(selectedSessionId ?? "")) {
              setSelectedSessionId(null);
              syncSessionParam(null);
            }
          }}
          onUnarchiveSessions={async (ids) => {
            const { unarchiveAgentSession } = await import("@/lib/daemon");
            await Promise.allSettled(ids.map((id) => unarchiveAgentSession(id)));
            void qc.invalidateQueries({ queryKey: ["agentSessions"] });
            if (ids.includes(selectedSessionId ?? "")) {
              setSelectedSessionId(null);
              syncSessionParam(null);
            }
          }}
        />
        {selectedSessionId ? (
          <SessionPanel
            key={selectedSessionId}
            mode="page"
            sessionId={selectedSessionId}
            machines={machines}
            llmProviders={providers}
            onSessionListRefresh={refreshSessionLists}
          />
        ) : preContext ? (
          <SessionPanel
            key={`pre:${preContext.workspaceId ?? "-"}:${preContext.runtimeId}`}
            mode="page"
            sessionId={null}
            machines={machines}
            llmProviders={providers}
            preContext={preContext}
            onPreSessionCreated={handlePreSessionCreated}
          />
        ) : (
          // 空门户态（task-06 / X-12；2026-08-23-sessions-page-style 原型
          // .empty-portal）：渐变图标 + 引导文案 + 快捷动作——新建走两步浮层
          // （与组头「＋」同一入口，X-12 契约不变）、继续最近会话直达选中。
          <div
            data-testid="sessions-empty-portal"
            aria-label="门户空态"
            className="flex min-h-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-dashed border-brand-300 bg-card px-6 py-8 text-center shadow-sm"
          >
            <span
              aria-hidden
              className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-info text-white shadow-primary"
            >
              <Sparkles className="h-6 w-6" />
            </span>
            <h3 className="text-[15px] font-semibold text-foreground">
              开始新会话
            </h3>
            <p className="max-w-[380px] text-xs leading-6 text-muted-foreground">
              {scope?.kind === "change"
                ? "在左侧工作区分组点「＋」选择机器与智能体，发送第一句话即在当前变更下创建会话；也可以从列表选择一个既有会话继续对话。"
                : scope?.kind === "quicklog"
                  ? // task-10（FR-04 / X-008 消费点六）：quicklog 空态提示在
                    // 当前快速修复下创建会话（首句经 quickId 落自动绑定）。
                    "在左侧工作区分组点「＋」选择机器与智能体，发送第一句话即在当前快速修复下创建会话；也可以从列表选择一个既有会话继续对话。"
                  : "在左侧工作区分组点「＋」选择机器与智能体，发送第一句话即创建会话；也可以从列表选择一个既有会话继续对话。"}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPickerWorkspaceId(scopedPickerWorkspaceId());
                  setPickerOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-brand-700 hover:shadow-sm"
              >
                <Plus aria-hidden className="h-3.5 w-3.5 text-brand-600" />
                新建会话
              </button>
              {recentSession && (
                <button
                  type="button"
                  onClick={() => {
                    setPreContext(null);
                    setSelectedSessionId(recentSession.id);
                    // ql-20260824-001：继续最近会话同样落 URL（刷新保持）。
                    syncSessionParam(recentSession.id);
                  }}
                  title={`继续会话「${recentSession.title?.trim() || "未命名会话"}」`}
                  className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-brand-700 hover:shadow-sm"
                >
                  <Clock aria-hidden className="h-3.5 w-3.5 text-brand-600" />
                  <span className="truncate">
                    继续最近会话「
                    {recentSession.title?.trim() || "未命名会话"}」
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {/* task-06（FR-04/D-107）：组头「＋」两步浮层（①在线机器 ②智能体，默认
          Claude 高亮）；onPick 合成 preContext，取消仅关闭零影响。 */}
      <PreSessionPicker
        open={pickerOpen}
        machines={machines}
        onCancel={() => setPickerOpen(false)}
        onPick={handlePickerPick}
      />
    </PageContainer>
  );
}

/* ────────────────────── D-005 默认机器回退（task-06 自 new-session-form.tsx 迁入） ────────────────────── */

/**
 * 默认机器记住上次选择（D-005 第一级回退）的 localStorage key。
 * task-06 迁自 new-session-form.tsx（ql-20260814-012 / D-005）；task-07 删源
 * 后此处为唯一实现，不回退断链（先例：session-panel.tsx 底部纯函数区）。
 */
export const NEW_SESSION_MACHINE_LS_KEY = "sillyhub.sessions.new.machineId";

/** ISO 时间戳解析（空/非法 → 0；resolveDefaultMachineId 排序共用）。 */
function parseTs(v: string | null | undefined): number {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * D-005 默认机器三级回退（task-06 自 new-session-form.tsx 迁入，语义原样）：
 * localStorage 上次选择（且仍在线）→ 最近会话（last_active_at 优先）所在的
 * 在线机器 → 最新心跳的在线机器。全部不命中返回 null。
 *
 * 门户消费点（TaskCard）：非工作区组/无绑定时的默认机器解析（tab 上下文降级
 * 后经浮层人工选择承接；本卡完成迁移+导出+单测，浮层打开时的预选机器暂不接
 * ——浮层第一步自身有在线机器数据）。
 */
export function resolveDefaultMachineId(
  machines: DaemonMachineRead[],
  sessions: AgentSessionRead[],
): string | null {
  const online = machines.filter((m) => m.status === "online");
  if (online.length === 0) return null;
  const onlineIds = new Set(online.map((m) => m.id));

  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(NEW_SESSION_MACHINE_LS_KEY);
    if (saved && onlineIds.has(saved)) return saved;
  }

  const runtimeToMachine = new Map<string, string>();
  for (const m of machines) {
    for (const r of m.runtimes ?? []) runtimeToMachine.set(r.id, m.id);
  }
  const recent = [...sessions]
    .filter((s) => s.runtime_id)
    .sort(
      (a, b) =>
        parseTs(b.last_active_at ?? b.created_at) -
        parseTs(a.last_active_at ?? a.created_at),
    );
  for (const s of recent) {
    const mid = runtimeToMachine.get(s.runtime_id as string);
    if (mid && onlineIds.has(mid)) return mid;
  }

  const byHeartbeat = [...online].sort(
    (a, b) => parseTs(b.last_heartbeat_at) - parseTs(a.last_heartbeat_at),
  );
  return byHeartbeat[0]?.id ?? null;
}
