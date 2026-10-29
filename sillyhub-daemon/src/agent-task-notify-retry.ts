/**
 * agent-task-notify-retry —— agent_task_status 上报有限重试
 * （2026-10-30-task-resume-revive-notify-retry / FR-04）。
 *
 * 背景：daemon→平台 agent-task-status HTTP 上报失败（生产实测多次 502——
 * 平台网关故障时段，daemon.log `[cli] onSessionEvent notify failed`）原先仅
 * console.error 即丢，状态事件永久丢失（平台任务卡不翻转）。本模块给
 * cli.ts onSessionEvent 桥的 agent_task_status 分支加有限退避重试：
 *
 * - 触发面：HubHttpError 且 status ≥ 500（含实测 502）；非 HubHttpError 的
 *   Error（传输层——fetch 连接失败/超时/连接重置；4xx 语义错误恒 HubHttpError
 *   不入此列）。4xx 与其它非 Error 形态不重试（语义错误重试无益，直接抛出）。
 * - 上限：AGENT_TASK_NOTIFY_RETRY_DELAYS_MS 共 3 次额外尝试（1s/4s/16s
 *   指数退避），最坏 4 次请求/事件——多事件并发各退避，无聚合风暴面。
 * - 幂等安全：backend upsert 幂等（running latest-wins / 终态重放刷
 *   finished_at 均无害），重放安全。
 * - sleep 可注入（单测 fake timers/记录退避序列）；模块纯函数零副作用，
 *   独立于 cli.ts 入口（测试 import 不触发 CLI 装配）。
 */

import { HubHttpError, type HubClient } from './hub-client.js';

/** 退避间隔（1s / 4s / 16s），长度即额外尝试次数。 */
export const AGENT_TASK_NOTIFY_RETRY_DELAYS_MS: readonly number[] = [
  1000,
  4000,
  16000,
];

/**
 * 是否值得重试：5xx（含 502 网关故障）与传输层 Error 重试；4xx（HubHttpError
 * status < 500，语义/权限错误）与非 Error 形态直接抛出。
 */
export function isRetryableAgentTaskNotifyError(err: unknown): boolean {
  if (err instanceof HubHttpError) return err.status >= 500;
  return err instanceof Error;
}

/** notifyAgentTaskStatus 的最小 client 面（结构化注入，测试替身零依赖）。 */
export type AgentTaskNotifyClient = Pick<HubClient, 'notifyAgentTaskStatus'>;

/**
 * 带退避重试的 agent_task_status 上报。成功即返回；不可重试错误或重试耗尽
 * 抛最后一次错误（调用方 catch 走既有 console.error 落日志，不阻塞主链路）。
 */
export async function notifyAgentTaskStatusWithRetry(
  client: AgentTaskNotifyClient,
  args: Parameters<HubClient['notifyAgentTaskStatus']>,
  opts?: {
    /** 退避 sleep 注入（缺省 setTimeout）；单测用 fake 记录序列。 */
    sleep?: (ms: number) => Promise<void>;
    /** 退避序列注入（缺省 AGENT_TASK_NOTIFY_RETRY_DELAYS_MS）。 */
    delays?: readonly number[];
  },
): Promise<void> {
  const sleep =
    opts?.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays = opts?.delays ?? AGENT_TASK_NOTIFY_RETRY_DELAYS_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      await sleep(delays[attempt - 1]!);
    }
    try {
      await client.notifyAgentTaskStatus(...args);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableAgentTaskNotifyError(err)) {
        throw err;
      }
    }
  }
  throw lastErr;
}
