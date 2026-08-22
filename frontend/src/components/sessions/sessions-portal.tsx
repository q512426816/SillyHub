"use client";

/**
 * SessionsPortal — 三入口统一会话门户共享组件
 * （2026-08-22-workspace-sessions-portal task-01 / FR-01 / FR-05 / D-001@v1）。
 *
 * 依据：
 *   - tasks/task-01.md（allowed_paths / implementation / acceptance / constraints）
 *   - design.md §4.A（共享门户组件 + scope 派生 + 深链）、§4.D（变更入口卡经
 *     ?session= 深链直达选中态）、§4.E（三入口统一渲染体）
 *   - 提取源：app/(dashboard)/sessions/page.tsx :46-117 外壳整块搬运（行为
 *     零回归；PageContainer/PageHeader 随外壳进组件，三入口标题统一），
 *     页面薄壳化接线归 task-02，本组件先行落地契约。
 *
 * 结构（自提取源原样保留）：
 *   左 320px SessionListPanel（task-11 筛选/虚拟滚动 + task-04 scope 化）；
 *   右两态——未选会话 = NewSessionForm（task-12 + task-05 锁定绑定）、
 *   选中会话 = SessionPanel mode="page"（key 重挂载契约：key 变化即清
 *   SSE/轮询/队列，diff-analysis §4.1 原则 4）。
 *
 * 数据流（页级数据随门户整体迁移，面板不自持）：
 *   - 机器列表 useDaemonMachines、供应商列表 listProviders（react-query，
 *     staleTime 30s）为门户级数据，经 props 注入 SessionPanel；
 *   - 会话切换/删除经 selectedSessionId 状态 + key 重挂载驱动；
 *   - 新会话创建走 NewSessionForm → onCreated 切入选中态并刷新列表。
 *
 * scope 派生（design §4.A，按 scope 三处路由）：
 *   - SessionListPanel scope 透传 → 列表数据源切换（task-04 契约）；
 *   - NewSessionForm bindWorkspaceId（workspace/change 均传 workspaceId）/
 *     bindChangeId（仅 change 传，级隐含 workspace 双传）→ 创建绑定锁定
 *     （task-05 契约）；
 *   - PageHeader 标题「智能体会话」+ 范围后缀（D-001@v1：三入口标题统一，
 *     后缀取固定文案「· 工作区」「· 变更」，不额外拉取 workspace 名）。
 *
 * 深链恢复（D-004@v1，Grill P0-2 修订——?session= 升级为门户统一能力）：
 *   挂载时 useSearchParams 解析一次 ?session=<id>，经 getAgentSession 验证
 *   存在且有权后设初始 selectedSessionId；无参或无效 id 静默忽略（迁移旧
 *   workspace-session-section :95-113 语义：不存在/无权 → 留在新建表单态）。
 *   遵循 /runtimes/page.tsx 先例，不加 Suspense 包裹。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Button } from "antd";

import { SessionPanel } from "@/components/daemon/session-panel";
import { NewSessionForm } from "@/components/sessions/new-session-form";
import {
  SessionListPanel,
  type SessionListScope,
} from "@/components/sessions/session-list-panel";
import { PageContainer, PageHeader } from "@/components/layout";
import { listProviders } from "@/lib/api/llm-providers";
import { getAgentSession } from "@/lib/daemon";
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
        // 深链 session 不存在或无权访问：静默忽略，留在新建表单态
        //（旧 workspace-session-section :106-108 语义，design §4.A）。
      });
  }, [searchParams]);

  // 机器列表：SessionPanel 离线判定用（列表/表单/控件条各自另有数据源）。
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

  // scope 派生（design §4.A 三处路由之二/三）：标题范围后缀（固定文案，不拉
  // workspace 名）+ NewSessionForm 锁定绑定（change 级隐含 workspace 双传）。
  const portalTitle = `智能体会话${
    scope?.kind === "workspace" ? " · 工作区" : scope?.kind === "change" ? " · 变更" : ""
  }`;
  const bindWorkspaceId = scope?.workspaceId;
  const bindChangeId = scope?.kind === "change" ? scope.changeId : undefined;

  return (
    <PageContainer
      size="full"
      className="h-[calc(100vh-56px)] gap-3 py-4"
      aria-label={portalTitle}
    >
      <PageHeader
        title={portalTitle}
        subtitle="跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建"
        actions={
          selectedSessionId ? (
            <Button onClick={() => setSelectedSessionId(null)}>新建会话</Button>
          ) : null
        }
      />
      {/* 原型 .main-grid：左 320px 列表 + 右面板 */}
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-3.5">
        <SessionListPanel
          scope={scope}
          selectedSessionId={selectedSessionId}
          onSelect={(s) => setSelectedSessionId(s.id)}
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
        ) : (
          <div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card px-6 py-6">
            <NewSessionForm
              bindWorkspaceId={bindWorkspaceId}
              bindChangeId={bindChangeId}
              onCreated={(resp) => {
                setSelectedSessionId(resp.session_id);
                refreshSessionLists();
              }}
            />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
