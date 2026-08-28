"use client";

/**
 * task-15 · 会话对话移动页（FR-07 / FR-09 / design §5.4 对话页，
 * D-001@V1 / D-003@V1 / D-004@V1，change 2026-08-26-mobile-workspace-page）。
 *
 * SessionPanel 第四宿主（纯装配，零渲染层新增）：
 *  - 路由命中 task-01 DRILL_ROUTES 钻取分支：上层 m/layout.tsx 裸容器直出
 *    （无 MobileTopBar、无底部 5 Tab，FR-09 沉浸钻取）；本页容器 h-[100dvh]
 *    满屏——SessionPanel 根 flex-col h-full 天然贴底（输入条可见）；
 *  - 调用形态对齐 floating-session-host.tsx:307-315（第三宿主）：key={sid}
 *    使路由参数变化天然触发重挂载（清 SSE/消息队列状态机干净重建，既有契约）。
 *
 * 页面级数据同源（对齐 floating-session-host.tsx:86-96，零新增实现）：
 *  - machines：useDaemonMachines({limit:100})（内部 15s 无条件轮询；离线判定 +
 *    默认机器解析）；
 *  - providers：useQuery ["llmProviders","floating-session"] + listProviders
 *    （@/lib/api/llm-providers，staleTime 30s；与悬浮宿主同 key 共享缓存，
 *    零重复请求）。
 */
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { SessionPanel } from "@/components/daemon/session-panel";
import { listProviders, type LlmProviderRead } from "@/lib/api/llm-providers";
import { useDaemonMachines } from "@/lib/use-daemon-machines";

export default function MobileSessionChatPage() {
  const params = useParams<{ id: string; sid: string }>();
  const sid = params.sid;
  const qc = useQueryClient();

  // ── 页面级数据（与悬浮宿主同源同 key，见文件头）──────────────────────
  // quick：融合候选（含共享机器）——离线判定覆盖共享会话。
  const { machineCandidates } = useDaemonMachines({ limit: 100 });
  const machines = machineCandidates ?? [];
  const providersQ = useQuery({
    queryKey: ["llmProviders", "floating-session"],
    queryFn: listProviders,
    staleTime: 30_000,
  });
  const providers: LlmProviderRead[] = useMemo(
    () => providersQ.data ?? [],
    [providersQ.data],
  );

  // 路由参数缺席（理论不达）：不渲染面板，防 sessionId="" 误建查询。
  if (!sid) return null;

  return (
    // ql-20260827-012：父级（m/layout 钻取裸容器）已 fixed inset-0 + overflow-hidden，
    // h-full 撑满视口并加 overflow-hidden 兜底——原 h-[100dvh] 留在流内，内容异常
    // 撑高时 body 整页可滚、头部/输入条跟滚。
    <div
      data-testid="m-session-chat-page"
      className="flex h-full w-full min-h-0 flex-col overflow-hidden"
    >
      <SessionPanel
        key={sid}
        mode="page"
        variant="mobile"
        sessionId={sid}
        machines={machines}
        llmProviders={providers}
        onSessionListRefresh={() => {
          void qc.invalidateQueries({ queryKey: ["agentSessions"] });
        }}
      />
    </div>
  );
}
