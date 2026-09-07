/**
 * interactive/session-manager/usage.ts —— 预算/用量簇（task-08 interactive
 * budget 软切断 + 会话级 usage 台账）。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * setBudgetTokens / _setBudgetTokensInternal / isOverBudget /
 * _aggregateSessionUsage / _liftSessionUsage / _foldTurnUsage /
 * _checkBudgetCutoff / _destroyUsageLedger 方法体原样下沉（仅 ``this`` →
 * ``mgr`` 改显式传参，行为零变化）。
 *
 * @module interactive/session-manager/usage
 */

import type { AgentEvent } from '../../types.js';
import type { SessionManagerDeps, SessionState } from '../types.js';
import type { SessionManagerCore, SessionUsageTotals } from './types.js';

/**
 * task-08：设置 session 级 budget_tokens（外部显式注入，供 daemon ``_startInteractiveSession``
 * 在 ``create({...,budget_tokens})`` 之外补登记 / 测试直接驱动）。
 *
 * 校验：number 且 finite 且 >0 才登记；非法 / undefined / ≤0 → 删除条目（= 检查点
 * 短路，FR-07 零回归）。session 不存在 → 静默 no-op（与 refreshClaimToken 同策略）。
 *
 * D-009 口径由内部检查点负责（input+output，不含 cache）；此处只存阈值。
 */
export function setBudgetTokens(
  mgr: SessionManagerCore,
  sessionId: string,
  budgetTokens: number | undefined,
): void {
  setBudgetTokensInternal(mgr, sessionId, budgetTokens);
}

/** task-08 内部共享：create + setBudgetTokens 复用的登记逻辑（带校验）。 */
export function setBudgetTokensInternal(
  mgr: SessionManagerCore,
  sessionId: string,
  budgetTokens: number | undefined,
): void {
  if (!mgr._store.has(sessionId)) return;
  if (
    typeof budgetTokens !== 'number' ||
    !Number.isFinite(budgetTokens) ||
    budgetTokens <= 0
  ) {
    mgr._sessionBudgetTokens.delete(sessionId);
    return;
  }
  mgr._sessionBudgetTokens.set(sessionId, budgetTokens);
}

/**
 * task-08：查询某 session 是否已因 budget 超限进入软切断态。
 * session 不存在 / 未配置 budget → false。供 daemon / 测试观测。
 */
export function isOverBudget(
  mgr: SessionManagerCore,
  sessionId: string,
): boolean {
  return mgr._overBudgetSessions.has(sessionId);
}

/**
 * task-08（D-009；2026-09-03-agent-provider-abstraction 改造）：聚合 session
 * 会话级 usage（历史轮折算 base + 本轮各 parentKey 最新值求和，主 agent + 各
 * 子代理）。无台账 → 0/0。**不含** cache_*（D-009 口径）。
 *
 * 对齐旧跨 ``_partialBuffers`` 桶求和口径：本轮各 parent（'main'/子代理
 * tool_use_id）的轮级累计逐一相加，再加历史轮 base。
 */
export function aggregateSessionUsage(
  mgr: SessionManagerCore,
  sessionId: string,
): SessionUsageTotals {
  const base = mgr._sessionUsageBase.get(sessionId);
  let inputTokens = base?.input_tokens ?? 0;
  let outputTokens = base?.output_tokens ?? 0;
  const turn = mgr._turnUsageByParent.get(sessionId);
  if (turn) {
    for (const latest of turn.values()) {
      inputTokens += latest.input_tokens || 0;
      outputTokens += latest.output_tokens || 0;
    }
  }
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

/**
 * task-08：事件 usage → 会话级台账更新（``_liftSessionUsage`` 的写侧）。
 *
 * 数据源守卫见 ``_turnUsageByParent`` 字段注释：仅轮级累计来源（``is_partial``
 * 事件 / usage-only 空事件）replace 更新本轮对应 parentKey 条目；其余携带
 * usage 的事件（完整消息 stamp 的单次调用终值、codex usage_update）不进台账
 * （display 用途，经上报 dict 顶层 usage 透传 daemon lift）。
 */
export function liftSessionUsage(
  mgr: SessionManagerCore,
  state: SessionState,
  ev: AgentEvent,
): void {
  const usage = ev.usage;
  if (!usage) return;
  const isTurnCumulative =
    ev.is_partial === true || (ev.type === 'text' && ev.content === '');
  if (!isTurnCumulative) return;
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const output =
    typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  const parentKey =
    typeof ev.parent_tool_use_id === 'string' && ev.parent_tool_use_id
      ? ev.parent_tool_use_id
      : 'main';
  let turn = mgr._turnUsageByParent.get(state.sessionId);
  if (!turn) {
    turn = new Map<string, SessionUsageTotals>();
    mgr._turnUsageByParent.set(state.sessionId, turn);
  }
  turn.set(parentKey, { input_tokens: input, output_tokens: output });
}

/**
 * task-08：turn 收尾折算（``_onResult`` 在 ``_checkBudgetCutoff`` **之后**调，
 * 对齐旧 ``_shrinkSubagentBuffers`` 的时序——预算聚合先看到本轮各 parent 值，
 * 再合入 base）。本轮各 parent 最新值累加进 ``_sessionUsageBase`` 后清空
 * 本轮表；seq 补号计数器同步归零（新 turn 事件序号空间独立）。
 */
export function foldTurnUsage(mgr: SessionManagerCore, state: SessionState): void {
  const turn = mgr._turnUsageByParent.get(state.sessionId);
  if (turn) {
    if (turn.size > 0) {
      const base = mgr._sessionUsageBase.get(state.sessionId) ?? {
        input_tokens: 0,
        output_tokens: 0,
      };
      for (const latest of turn.values()) {
        base.input_tokens += latest.input_tokens || 0;
        base.output_tokens += latest.output_tokens || 0;
      }
      mgr._sessionUsageBase.set(state.sessionId, base);
    }
    mgr._turnUsageByParent.delete(state.sessionId);
  }
  mgr._turnEventSeq.delete(state.sessionId);
}

/**
 * task-08（D-006 / D-009）：turn 收尾后的 budget 检查点（在 ``_onResult`` 末尾调）。
 *
 * 软切断 D-006：累计 input+output ≥ budget → 置 ``_overBudgetSessions``（幂等）
 * + 经现有 ``onTurnMessage`` 回传 ``reason='budget_exceeded'`` + usage。**不**调
 * close / kill / fail —— 当前 turn 已自然 result 完成，后续 ``inject`` 由置位拦截
 *（见 ``inject`` 头部检查）。budget_tokens 未配置 → 短路（FR-07 零回归）。
 */
export function checkBudgetCutoff(
  mgr: SessionManagerCore,
  state: SessionState,
  runId: string,
): void {
  const budget = mgr._sessionBudgetTokens.get(state.sessionId);
  if (budget === undefined) return; // FR-07 brownfield 短路
  if (mgr._overBudgetSessions.has(state.sessionId)) return; // 幂等
  const usage = aggregateSessionUsage(mgr, state.sessionId);
  const total = usage.input_tokens + usage.output_tokens;
  if (total >= budget) {
    mgr._overBudgetSessions.add(state.sessionId);
    // 经现有 onTurnMessage 回传 budget_exceeded 事件（fire-and-forget，对齐 _onMessage
    // 转发策略）。msg 形态用 Codex flat message 鸭子类型（= Record<string, unknown>，
    // daemon onTurnMessage duck-types 按顶层 event_type / usage 处理），与 batch
    // task-runner.ts ``_emitBudgetExceeded`` 输出**同构**：
    //   - event_type: 'system' / content: '[BUDGET_EXCEEDED] ...'
    //   - reason: 'budget_exceeded'（backend 据此识别软切断事件）
    //   - usage: {input_tokens, output_tokens}（D-009：仅 input+output，不含 cache）
    //   - budget_tokens: 阈值（透传便于 backend / 前端展示）
    const msg = {
      event_type: 'system',
      content: `[BUDGET_EXCEEDED] input=${usage.input_tokens} output=${usage.output_tokens} budget=${budget}`,
      reason: 'budget_exceeded',
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
      budget_tokens: budget,
    } as unknown as Parameters<
      NonNullable<SessionManagerDeps['onTurnMessage']>
    >[2];
    try {
      const ret = mgr.deps.onTurnMessage(state.sessionId, runId, msg);
      // fire-and-forget（对齐 _onMessage 的 void 包装）；异常不阻塞 turn 收尾。
      if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
        (ret as Promise<unknown>).catch((e) => {
          console.warn(
            '[session-manager] budget_exceeded message forward failed',
            e,
          );
        });
      }
    } catch (e) {
      console.warn(
        '[session-manager] budget_exceeded message throw',
        e,
      );
    }
  }
}

/**
 * task-08（FR-02 / D-002@v1）：销毁会话级 usage 台账 + seq 补号计数器
 *（取代旧 ``_destroyPartialBuffer`` 的清理职责：budget 登记由调用方
 * 额外显式清理，对齐创建失败/终态/shutdown 三处调用点；partial
 * 定时器已随缓冲链下沉归一化器，由 driver.consume 的 finally
 * dispose 兜底）。
 */
export function destroyUsageLedger(
  mgr: SessionManagerCore,
  sessionId: string,
): void {
  mgr._sessionUsageBase.delete(sessionId);
  mgr._turnUsageByParent.delete(sessionId);
  mgr._turnEventSeq.delete(sessionId);
  // budget 软切断登记同点位回收（对齐旧 _destroyPartialBuffer 的 F3 修复口径：
  // 无 usage 台账的会话 end 后同样回收，防只增不减）。
  mgr._sessionBudgetTokens.delete(sessionId);
  mgr._overBudgetSessions.delete(sessionId);
}
