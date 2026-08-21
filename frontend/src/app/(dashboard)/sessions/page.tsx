"use client";

/**
 * 智能体会话总入口页 /sessions（2026-08-14-sessions-portal task-10）。
 *
 * 依据：
 *   - tasks/task-10.md（allowed_paths / implementation / acceptance）
 *   - design.md §2 FR-01/FR-02、§5 Wave3 页面骨架段、§9（/runtimes 弹窗零回归 D-002）
 *   - prototype-sessions-portal.html（两栏布局 / 两态面板 / 横幅语义，视觉基准）
 *   - FRONTEND_PAGE_STYLE.md（PageContainer/PageHeader + antd 组件 + tailwind token）
 *
 * 结构（原型 .main-grid）：
 *   左 320px SessionListPanel（task-11：筛选 + 虚拟滚动 + 紧凑两行条目）；
 *   右两态——未选会话 = NewSessionForm（task-12 四选择器），选中会话 = SessionPanel。
 *
 * task-05（2026-08-21-session-message-queue / design §2 D-005）：页内 SessionPanel
 * 已提取为共享组件 components/daemon/session-panel.tsx（props 接口与闭包依赖归属
 * 见 diff-analysis.md §4），本页只剩外壳——左栏 / 表单 / 布局 + 页级数据注入
 * （machines / llmProviders）+ mode="page" 渲染。SSE 建流、turn 状态机、消息队列
 * （useMessageQueue + MessageQueueBar）、attach 竞态修复、whoLine 注入、CtxUsageBar /
 * SessionConfigBar / SubagentCatalog 组装等面板内部逻辑见该组件文件头注释，
 * 提取为整块搬运（行为零回归）。
 *
 * 数据流（页面外壳部分）：
 *   - 机器列表 useDaemonMachines、供应商列表 listProviders（react-query，staleTime
 *     30s）为页级数据，经 props 注入 SessionPanel（diff-analysis §4.2/§4.3 归属
 *     决策：页面级数据面板不自持）；
 *   - 会话切换 / 删除经 selectedSessionId 状态 + key 重挂载驱动（key 契约见
 *     diff-analysis §4.1 原则 4：key 变化即清 SSE/轮询/队列）；
 *   - 新会话创建走 NewSessionForm → onCreated 切入选中态。
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";

import { SessionPanel } from "@/components/daemon/session-panel";
import { NewSessionForm } from "@/components/sessions/new-session-form";
import { SessionListPanel } from "@/components/sessions/session-list-panel";
import { PageContainer, PageHeader } from "@/components/layout";
import { listProviders } from "@/lib/api/llm-providers";
import { useDaemonMachines } from "@/lib/use-daemon-machines";

/* ────────────────────── 页面 ────────────────────── */

export default function SessionsPortalPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const qc = useQueryClient();

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

  return (
    <PageContainer
      size="full"
      className="h-[calc(100vh-56px)] gap-3 py-4"
      aria-label="智能体会话"
    >
      <PageHeader
        title="智能体会话"
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
          selectedSessionId={selectedSessionId}
          onSelect={(s) => setSelectedSessionId(s.id)}
          onDeleteSessions={async (ids) => {
            // ql-20260818-012：逐条调 deleteAgentSession（后端软删），完成后
            // invalidate 列表 + 清除选中态（若选中被删的会话）。
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
