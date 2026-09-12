/**
 * useScheduledMessages —— 会话定时消息数据源 Hook
 * （2026-09-07-session-pin-rename-scheduled-send task-08 / FR-04 / D-001@v1）。
 *
 * design §总体方案 Wave 3.4：GET /sessions/{id}/scheduled 全状态列表（dispatch_at
 * 升序），queryKey ["agentSessions","scheduled",sessionId]（Grill B-05：sessionId 进
 * key，切会话换键不串数据），30s 轮询兜底；创建/取消后的即时收敛由
 * ScheduledMessagesBar（唯一挂载方）经 refreshSignal 失效本 key 重拉。
 *
 * 实现约束（任务卡 constraints 定案）：本 hook 供 ScheduledMessagesBar 内部经
 * **局部 QueryClientProvider** 挂载——session-panel 文件头 R4 不变式要求 dialog
 * 渲染路径零 react-query（3 套弹窗测试无 QueryClientProvider），bar 组件内自建
 * 局部 client 包数据子树（不依赖外层 Provider，dialog 挂载也能用；创建/取消失效
 * 走该局部 client，见 scheduled-messages-bar.tsx）。panel 层不得直接调用本 hook。
 *
 * sessionId 空串 = 预会话 idle 态，enabled 守卫停请求。
 */

import { useQuery } from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import { listScheduledMessages, type ScheduledMessageRead } from "@/lib/daemon";

/** queryKey 根（["agentSessions","scheduled"]，与既有 agentSessions 族 key 同前缀惯例）。 */
export const SCHEDULED_MESSAGES_QUERY_ROOT = ["agentSessions", "scheduled"] as const;

/**
 * 定时消息查询 key 工厂（hook 供数与 bar 取消后失效共用同一入口，对齐
 * lib/query-keys.ts「key 单一源」规则；因消费面收敛在 bar 一处，不进公共工厂文件）。
 */
export function scheduledMessagesQueryKey(sessionId: string) {
  return [...SCHEDULED_MESSAGES_QUERY_ROOT, sessionId] as const;
}

/** 轮询间隔（ms）：sweeper 到点派发（后端 30s 一轮）→ 前端同频兜底刷新。 */
const SCHEDULED_POLL_INTERVAL_MS = 30_000;

export interface UseScheduledMessagesReturn {
  /** 当前会话全部定时消息（服务端 dispatch_at 升序；加载中/失败为空数组）。 */
  scheduled: ScheduledMessageRead[];
  /** 首载进行中（bar 空列表渲染 null，此标志当前仅供调用方防御性判断）。 */
  isLoading: boolean;
}

/** 空列表模块级常量：data 未就绪/异常时复用同一引用——防回调型消费方
 * （bar onEntriesChange）因「每渲染新 []」触发 setState→渲染循环。 */
const EMPTY_SCHEDULED: ScheduledMessageRead[] = [];

export function useScheduledMessages(sessionId: string): UseScheduledMessagesReturn {
  const query = useQuery<ScheduledMessageRead[], ApiError>({
    queryKey: scheduledMessagesQueryKey(sessionId),
    queryFn: () => listScheduledMessages(sessionId),
    // 预会话 idle 态（无 sessionId）不发请求；空 key 的禁用查询 data 恒 undefined。
    enabled: sessionId !== "",
    refetchInterval: SCHEDULED_POLL_INTERVAL_MS,
  });
  return {
    // Array.isArray 防御：测试环境/异常网关可能给非数组 JSON（如全局 fetch mock
    // 兜住所有请求返回对象）——形状不符按空列表收敛（bar 渲染 null），不崩面板。
    scheduled: Array.isArray(query.data) ? query.data : EMPTY_SCHEDULED,
    isLoading: query.isLoading,
  };
}
