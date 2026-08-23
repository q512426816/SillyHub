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
 * 上下文解析（组头「＋」onNewInGroup，FR-04 / D-107——降级说明）：
 *   设计优先级 = 筛选 tab（机器+智能体已选）> 工作区绑定在线机器 > D-005 三级
 *   回退。task-05 的 SessionListPanel 把两层筛选 tab 态收在组件内部（未暴露
 *   回调/受控 prop，本卡 allowed_paths 不含该文件不可加）→ 降级为「全部态
 *   统一弹 task-04 两步浮层」：①在线机器 → ②智能体（默认 Claude 高亮），
 *   onPick(runtimeId) 后合成 preContext { workspaceId(组), runtimeId }。与
 *   筛选一致的意图经浮层默认高亮承接，用户无感知差异；tab 上下文直取待后续
 *   给 SessionListPanel 加受控 prop 后恢复。
 *
 * change 入口预会话（task-07 / FR-06 / D-106 / X-13）：change scope 左侧为
 *   平铺列表（design §3，无组头「＋」）→ 页头 actions 放「新建会话（本变更）」
 *   按钮走同一两步浮层，onPick 合成 preContext 显式双传 workspaceId +
 *   changeId（change 级隐含 workspace，原 NewSessionForm bindChangeId 契约由
 *   preContext 继承）。NewSessionForm/WorkspaceSessionPicker 本卡全量退役
 *   （D-109，文件与 import 已删，X-12 起渲染分支即空）。
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
 * workspace 入口预展开（FR-06）：scope.workspaceId → SessionListPanel
 * defaultExpandedWorkspaceId（挂载后仅该分组展开）。
 *
 * 页头「新建会话」按钮已移除（X-12：新建入口收敛到组头「＋」，actions 空）；
 * task-07 例外：change scope 页头 actions 放「新建会话（本变更）」（其左侧
 * 平铺列表无组头「＋」，见上）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Button } from "antd";

import {
  SessionPanel,
  type SessionPreContext,
} from "@/components/daemon/session-panel";
import { PreSessionPicker } from "@/components/sessions/pre-session-picker";
import {
  SessionListPanel,
  type SessionListScope,
} from "@/components/sessions/session-list-panel";
import { PageContainer, PageHeader } from "@/components/layout";
import { listProviders } from "@/lib/api/llm-providers";
import {
  getAgentSession,
  type AgentSessionRead,
  type DaemonMachineRead,
  type SessionCreateResponse,
} from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";

/* ────────────────────── 组件 ────────────────────── */

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

  // 机器列表：SessionPanel 离线判定 + PreSessionPicker 第一步数据源共用。
  const { items: machines } = useDaemonMachines({ limit: 100 });

  // 供应商列表：CtxUsageRing 分母派生（role mapping one_m / fallback model）。
  const providersQ = useQuery({
    queryKey: ["llmProviders", "sessions-portal"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers = useMemo(() => providersQ.data ?? [], [providersQ.data]);

  /** 会话配置/状态变化后刷新左侧列表（含 useDaemonMachines 的 sessions 旁路）。 */
  const refreshSessionLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["agentSessions"] });
  }, [qc]);

  // scope 派生（design §4.A 三处路由之二）：标题范围后缀（固定文案，不拉
  // workspace 名）。创建绑定锁（原 NewSessionForm bindWorkspaceId/bindChangeId）
  // 已由 preContext 解析继承（workspace 入口=组 workspaceId；change 入口=页头
  // 按钮双传，task-07 接线）。
  const portalTitle = `智能体会话${
    scope?.kind === "workspace" ? " · 工作区" : scope?.kind === "change" ? " · 变更" : ""
  }`;
  // change scope（task-07 / FR-06 / D-106）：左侧平铺列表无组头「＋」，预会话
  // 入口由页头 actions 承载（X-12 的例外，仅此 scope 有页头按钮）。
  const isChangeScope = scope?.kind === "change";

  /** 组头「＋」（FR-04）：统一弹两步浮层（tab 上下文降级说明见文件头）。 */
  const handleNewInGroup = useCallback((workspaceId: string | null) => {
    setPickerWorkspaceId(workspaceId);
    setPickerOpen(true);
  }, []);

  /** change 入口「新建会话（本变更）」：走同一浮层（pickerWorkspaceId 置
   *  scope.workspaceId，X-13 双传见 handlePickerPick）。 */
  const handleNewInChange = useCallback(() => {
    if (scope?.kind !== "change") return;
    setPickerWorkspaceId(scope.workspaceId);
    setPickerOpen(true);
  }, [scope]);

  /** 浮层两步选完（两步即达）：合成 preContext 切预会话态（清选中——三分支
   *  优先级）。change scope 显式双传 workspaceId + changeId（X-13：change 级
   *  隐含 workspace，先例原 NewSessionForm bindChangeId「调用方须同时双传」）。 */
  const handlePickerPick = useCallback(
    (runtimeId: string) => {
      setPreContext(
        scope?.kind === "change"
          ? {
              workspaceId: scope.workspaceId,
              changeId: scope.changeId,
              runtimeId,
            }
          : { workspaceId: pickerWorkspaceId, runtimeId },
      );
      setSelectedSessionId(null);
      setPickerOpen(false);
    },
    [pickerWorkspaceId, scope],
  );

  /**
   * 预会话首句创建成功（task-03 契约）：切真会话（key 重挂载 → 面板状态机
   * 自然接管）+ 清预会话态 + 刷新列表（新会话落对应分组顶部）。
   */
  const handlePreSessionCreated = useCallback(
    (resp: SessionCreateResponse) => {
      setPreContext(null);
      setSelectedSessionId(resp.session_id);
      refreshSessionLists();
    },
    [refreshSessionLists],
  );

  return (
    <PageContainer
      size="full"
      className="h-[calc(100vh-56px)] gap-3 py-4"
      aria-label={portalTitle}
    >
      {/* X-12：页头「新建会话」按钮移除——新建入口收敛到组头「＋」，actions 空；
          task-07 例外：change scope 平铺列表无组头「＋」，页头承载预会话入口。 */}
      <PageHeader
        title={portalTitle}
        subtitle="跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建"
        actions={
          isChangeScope ? (
            <Button onClick={handleNewInChange}>新建会话（本变更）</Button>
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
          }}
          onNewInGroup={handleNewInGroup}
          defaultExpandedWorkspaceId={
            scope?.kind === "workspace" ? scope.workspaceId : undefined
          }
          onDeleteSessions={async (ids) => {
            // ql-20260818-012：逐条调 deleteAgentSession（后端软删），完成后
            // invalidate 列表 + 清除选中态（若选中被删的会话）。
            // task-01：前缀 ["agentSessions"] 同时覆盖全局
            //（["agentSessions","sessionsPortal",scope,serverParams] 单一路径——D-003@v2 起 scope 走全局端点加过滤参，前缀 invalidate 全覆盖。
            const { deleteAgentSession } = await import("@/lib/daemon");
            await Promise.allSettled(ids.map((id) => deleteAgentSession(id)));
            void qc.invalidateQueries({ queryKey: ["agentSessions"] });
            if (ids.includes(selectedSessionId ?? "")) setSelectedSessionId(null);
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
          // 空门户态（task-06 / X-12）：轻引导占位——不用表单，新建入口在左侧
          // 组头「＋」；深链无效/无参也落此处（design §9）。
          <div
            data-testid="sessions-empty-portal"
            aria-label="门户空态"
            className="flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-6 py-6 text-center"
          >
            <h3 className="text-sm font-semibold text-foreground">开始新会话</h3>
            <p className="max-w-[320px] text-xs leading-5 text-muted-foreground">
              {isChangeScope
                ? "点右上「新建会话（本变更）」选择机器与智能体，发送第一句话即在当前变更下创建会话；也可以从列表选择一个既有会话继续对话。"
                : "在左侧工作区分组点「＋」选择机器与智能体，发送第一句话即创建会话；也可以从列表选择一个既有会话继续对话。"}
            </p>
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
