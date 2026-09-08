/**
 * interactive/session-manager/permission.ts —— 权限/用户对话框簇。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * getPermissionResolver / requestPermission / requestUserDialog /
 * _withinStaleFlipGrace / _writeChannelGuardDeny / _requestPermission /
 * _requestUserDialog / _buildCanUseToolCallback / _buildOnUserDialogCallback
 * 方法体原样下沉（仅 ``this`` → ``mgr`` 改显式传参，行为零变化）。
 *
 * @module interactive/session-manager/permission
 */

import type { PermissionResolver } from '../permission-resolver.js';
import type { CanUseToolDecision, SessionState } from '../types.js';
import { STALE_RUN_WRITE_GRACE_MS } from './types.js';
import type {
  CanUseToolFn,
  OnUserDialogFn,
  SessionManagerCore,
  UserDialogResultFn,
} from './types.js';

/**
 * task-04 轻重构⑥（2026-09-07-arch-large-file-split / design §5 Wave 1 / FR-05）：
 * allow decision 上 dialogResult 鸭子读取收敛（原 session-manager.ts 1260/2224/
 * 2322/2478 行四份复制粘贴：requestUserDialogImpl / AskUserQuestion 拦截 /
 * ExitPlanMode 审批 / buildOnUserDialogCallback 各自内联同一读取）。
 *
 * resolver 把 backend PERMISSION_RESPONSE.allow 的 dialog_result 回喂为
 * decision.dialogResult（permission-resolver.ts allow 扩展字段，前端用户选择
 * 回传）。缺失 → undefined；null 是合法「用户未答」值原样返回——缺省语义由
 * 各调用点判定（回喂 null / 'no answer payload' / answers 链），本 helper 只
 * 收敛读取，不吞不编。导出供定向测试（tests/dialog-result.test.ts）。
 */
export function dialogResultOf(decision: CanUseToolDecision): unknown {
  return (decision as { dialogResult?: unknown }).dialogResult;
}

/**
 * task-08：按 sessionId 取 resolver（daemon._handleWsMessage 路由
 * PERMISSION_RESPONSE 时调用 resolver.resolve）。session 不存在或
 * manualApproval=false 时返回 undefined。
 */
export function getPermissionResolver(
  mgr: SessionManagerCore,
  sessionId: string,
): PermissionResolver | undefined {
  return mgr._resolversBySession.get(sessionId);
}

/**
 * D-008@v1（task-02）：provider-neutral 普通审批 public 入口。Codex driver 收到
 * app-server server request（command/file/permission requestApproval）时调用，
 * Claude driver 经 _buildCanUseToolCallback 内部走相同 resolver 机制。
 *
 * 策略（D-006）：
 *   - session 非 running / 无 currentRunId → fail-closed deny（防 interrupt 后回调悬空）；
 *   - askUserOnly=true 且非用户输入类（isUserInputKind≠true）→ allow-through
 *     （不弹卡，记 metadata；scan 场景让普通工具自动推进）；
 *   - 否则 → resolver.register（send PERMISSION_REQUEST）→ await decision（fail-closed：
 *     send 失败 / signal aborted / 5min 超时 / wrapper 异常 全 deny）。
 *
 * 返回 CanUseToolDecision（Claude 直接用；Codex driver 据此映射 accept/decline）。
 *
 * @param sessionId 目标 session（resolver 按 session 隔离）
 * @param input toolName/toolInput/signal/toolUseId/isUserInputKind
 */
export async function requestPermission(
  mgr: SessionManagerCore,
  sessionId: string,
  input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    signal?: AbortSignal;
    toolUseId?: string;
    isUserInputKind?: boolean;
  },
): Promise<CanUseToolDecision> {
  return requestPermissionImpl(mgr, { sessionId, ...input });
}

/**
 * D-008@v1（task-02）：provider-neutral 用户对话 public 入口。Codex driver 收到
 * `item/tool/requestUserInput` 或可归一化的 MCP elicitation 时调用；Claude driver
 * 经 _buildOnUserDialogCallback 内部走相同 resolver 机制（PERMISSION_REQUEST 带
 * dialog_kind/dialog_payload）。
 *
 * 返回 { behavior:'completed', result } | { behavior:'cancelled' }。
 * fail-closed：session 非 running / 无 resolver / send 失败 / 超时 / wrapper 异常 → cancelled。
 */
export async function requestUserDialog(
  mgr: SessionManagerCore,
  sessionId: string,
  input: {
    dialogKind: string;
    dialogPayload: Record<string, unknown>;
    toolUseId?: string;
    signal?: AbortSignal;
  },
): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }> {
  return requestUserDialogImpl(mgr, { sessionId, ...input });
}

/**
 * D-008@v1（task-02）：requestPermission 内部实现。封装「读策略 → register → await」。
 * 与 _buildCanUseToolCallback 共享同一套 fail-closed 语义（resolver.register 内部
 * send 失败/signal aborted/5min 超时全 deny）。供 Codex driver 与未来 Claude helper 重构复用。
 */
/**
 * 写通道守卫（坑 subagent-write-channel，2026-09-03 实证 30 分钟写通道封锁）：
 * _requestPermission / _buildCanUseToolCallback 共用的 not-running 判定。
 *
 * 三态：
 *   - null = 放行继续正常审批流（running + currentRunId；或 stale-flip 宽限窗内）；
 *   - deny 对象 = fail-closed（含诊断上下文：status/currentRunId/stale 翻转距今/
 *     lastActiveAt 距今——2026-09-03 事故排查时裸文案零线索，触发条件至今不明）。
 *
 * stale-flip 宽限（误翻不封锁写通道）：inject 的 >60s 无 result 自愈会把仍活着
 * 但安静的长 turn 强翻 active 且保留 currentRunId（正常 result 收尾才清）——
 * 「active + currentRunId + staleRunResetAt 在宽限窗内」时 SDK turn 很可能未死，
 * 写调用放行；误翻是启发式猜测，写通道不该被猜测封锁。SDK 正常结束后不会调
 * canUseTool，正常收尾路径（active + currentRunId=undefined）不受宽限影响。
 */
/**
 * stale-flip 宽限窗判定（坑 subagent-write-channel + quick-bfec20a6）：
 * 「active + currentRunId 仍在 + staleRunResetAt 在宽限窗内」——turn 很可能
 * 仍活着（>60s 无 result 的强翻是启发式猜测）。写通道守卫与自更新忙屏障
 * （hasRunningTurn）共用：误翻既不该封锁写调用，也不该放行 daemon 自更新
 * 重启杀活轮（事故会话 e148364e：等 AskUserQuestion 作答的安静轮被翻 active
 * 后忙屏障放行自更新，12:39 daemon 重启杀轮）。SDK 真死时本就无调用进来；
 * 窗口 60min 有界，真死 turn 最多推迟升级 1 小时。
 */
export function withinStaleFlipGrace(
  mgr: SessionManagerCore,
  state: SessionState,
): boolean {
  return (
    state.status === 'active' &&
    !!state.currentRunId &&
    !!state.staleRunResetAt &&
    Date.now() - state.staleRunResetAt < STALE_RUN_WRITE_GRACE_MS
  );
}

export function writeChannelGuardDeny(
  mgr: SessionManagerCore,
  state: SessionState | undefined,
  toolName: string,
): { behavior: 'deny'; message: string } | null {
  if (!state) {
    return {
      behavior: 'deny',
      message: `session state missing (daemon restart?) — tool "${toolName}" denied; retry in a new turn`,
    };
  }
  if (state.status === 'running' && state.currentRunId) return null;
  if (withinStaleFlipGrace(mgr, state)) return null;
  const parts = [
    `status=${state.status}`,
    `currentRunId=${state.currentRunId ? 'set' : 'unset'}`,
    state.staleRunResetAt
      ? `staleRunReset=${Math.round((Date.now() - state.staleRunResetAt) / 1000)}s ago`
      : null,
    `lastActive=${Math.round((Date.now() - state.lastActiveAt) / 1000)}s ago`,
  ].filter(Boolean);
  return {
    behavior: 'deny',
    message:
      `session not in running turn (${parts.join(', ')}) — tool "${toolName}" denied. ` +
      'If this turn is actually still running (long quiet tool), the >60s-silent auto-reset may have misfired; wait or continue in a new turn.',
  };
}

async function requestPermissionImpl(
  mgr: SessionManagerCore,
  input: {
    sessionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    signal?: AbortSignal;
    toolUseId?: string;
    isUserInputKind?: boolean;
  },
): Promise<CanUseToolDecision> {
  const state = mgr._store.get(input.sessionId);
  // session 非 running / 无 currentRunId → fail-closed deny（stale-flip 宽限窗内放行）。
  const guardDeny = writeChannelGuardDeny(mgr, state, input.toolName);
  if (guardDeny) return guardDeny;
  if (!state || !state.currentRunId) {
    // 防御性缩窄：守卫三态已保证走到这里 currentRunId 非空
    return { behavior: 'deny', message: `session not in running turn — tool "${input.toolName}" denied` };
  }
  const runId = state.currentRunId;
  // D-006：askUserOnly=true 且非用户输入类 → allow-through（scan 场景普通工具自动推进）。
  if (state.askUserOnly === true && !input.isUserInputKind) {
    return { behavior: 'allow' };
  }
  const resolver = mgr._resolversBySession.get(input.sessionId);
  const wsClient = mgr._permissionWsClient;
  if (!resolver || !wsClient) {
    // 无 resolver（manualApproval=false 或未初始化）→ fail-closed deny。
    return {
      behavior: 'deny',
      message: `Tool "${input.toolName}" denied: no permission resolver (session=${input.sessionId}, run=${runId})`,
    };
  }
  const defaultDenyMessage = `Tool "${input.toolName}" denied by reviewer (session=${input.sessionId}, run=${runId})`;
  try {
    const { promise } = resolver.register({
      sessionId: input.sessionId,
      runId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      ...(input.toolUseId !== undefined ? { toolUseId: input.toolUseId } : {}),
      signal: input.signal,
      send: (msg) => wsClient.send(msg),
      // 用户输入类（Codex request_user_input / Claude AskUserQuestion）标记 dialog，
      // backend 据此走对话路径（不 arm 5min 超时 + SSE 携带 dialog 渲染问答卡）。
      ...(input.isUserInputKind
        ? { dialogKind: input.toolName, dialogPayload: input.toolInput }
        : {}),
    });
    const decision = await promise;
    if (decision.behavior === 'deny') {
      return { behavior: 'deny', message: decision.message ?? defaultDenyMessage };
    }
    return { behavior: 'allow' };
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : String(err ?? 'unknown error');
    return { behavior: 'deny', message: `${defaultDenyMessage}: wrapper error (${reason})` };
  }
}

/**
 * D-008@v1（task-02）：requestUserDialog 内部实现。与 _buildOnUserDialogCallback
 * 共享同一套 resolver 机制（PERMISSION_REQUEST 带 dialog_kind/dialog_payload，
 * PERMISSION_RESPONSE.allow 的 dialog_result 回喂）。
 */
async function requestUserDialogImpl(
  mgr: SessionManagerCore,
  input: {
    sessionId: string;
    dialogKind: string;
    dialogPayload: Record<string, unknown>;
    toolUseId?: string;
    signal?: AbortSignal;
  },
): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }> {
  const state = mgr._store.get(input.sessionId);
  if (!state || state.status !== 'running' || !state.currentRunId) {
    return { behavior: 'cancelled' };
  }
  const runId = state.currentRunId;
  const resolver = mgr._resolversBySession.get(input.sessionId);
  const wsClient = mgr._permissionWsClient;
  if (!resolver || !wsClient) {
    return { behavior: 'cancelled' };
  }
  try {
    const { promise } = resolver.register({
      sessionId: input.sessionId,
      runId,
      toolName: input.dialogKind,
      toolInput: input.dialogPayload,
      ...(input.toolUseId !== undefined ? { toolUseId: input.toolUseId } : {}),
      signal: input.signal,
      send: (msg) => wsClient.send(msg),
      dialogKind: input.dialogKind,
      dialogPayload: input.dialogPayload,
    });
    const decision = await promise;
    if (decision.behavior === 'deny') {
      return { behavior: 'cancelled' };
    }
    const dialogResult = dialogResultOf(decision); // task-04 轻重构⑥：收敛读取
    return {
      behavior: 'completed',
      result: dialogResult !== undefined ? dialogResult : null,
    };
  } catch {
    return { behavior: 'cancelled' };
  }
}

/**
 * task-08（D-007@v1 / spike-02 §3.7 D2）+ task-09（deny 收敛）：
 * 构造 canUseTool 远程人审回调。
 *
 * 回调内不本地批准、不读 credentials.json，唯一出口是 permissionResolver.register
 * 返回的 promise（SDK 全程 await，spike D2 已证不超时）：
 *   1. session 非 running turn / 无 currentRunId → 立即 deny（防 interrupt 后 SDK
 *      仍触发回调，spike D1 result 边界已收敛，但防御性 fail-closed）；
 *   2. resolver.register（内部 send PERMISSION_REQUEST + 启 5min 兜底 + 链 AbortSignal）；
 *   3. await promise → 返回 {behavior}。
 *
 * **task-09 deny 收敛（FR-07 / D-007@v1 / AC-09.1）**：
 *   - 远程 deny 未带 message 时用默认模板（含 toolName / sessionId / runId），
 *     让 claude 拿到可读原因决定下一步；禁止返回空 message；
 *   - driver 不二次决策、不强制结束 turn；deny.message 原样经 SDK 回喂；
 *   - allow 不篡改 input：updatedInput 透传原始 toolInput（Claude CLI Zod 校验
 *     allow 分支 updatedInput required，缺字段报 ZodError；类型虽 optional 但运行时必填）；
 *
 * **task-09 边界 12（wrapper 自身异常）**：
 *   resolver.register 抛 / await 抛 → catch 后返回 deny（带原因 message），
 *   不向上抛让 SDK 把包装器异常当 query 失败；并保证 registry 不残留半登记条目。
 *
 * @param sessionId  bind 给当前 session 的回调（同一 SessionManager 多 session 时各独立）。
 */
export function buildCanUseToolCallback(
  mgr: SessionManagerCore,
  sessionId: string,
  askUserOnly: boolean,
): CanUseToolFn {
  return async (
    toolName: string,
    toolInput: unknown,
    options?: { signal?: AbortSignal },
  ): ReturnType<CanUseToolFn> => {
    const state = mgr._store.get(sessionId);
    // state 不存在 / 非 running turn / 无 currentRunId → fail-closed deny（stale-flip
    // 宽限窗内放行——见 _writeChannelGuardDeny，坑 subagent-write-channel）。
    const guardDeny = writeChannelGuardDeny(mgr, state, toolName);
    if (guardDeny) return guardDeny;
    if (!state || !state.currentRunId) {
      // 防御性缩窄：守卫三态已保证走到这里 currentRunId 非空
      return { behavior: 'deny', message: `session not in running turn — tool "${toolName}" denied` };
    }
    const runId = state.currentRunId;
    // Claude CLI 经 --permission-prompt-tool stdio 对 allow 分支做 Zod 运行时校验，
    // updatedInput 为 required（record）；SDK 类型虽标 optional 但 CLI 运行时必填，
    // 缺字段会报 ZodError invalid_union → 全量工具调用失败（scan 阻塞根因）。
    // toolInput 形态是 unknown，归一化为 record（非 object 包装成 { value }），
    // 既满足 Zod record 校验又给 resolver / allow 透传同一份。
    const updatedInput: Record<string, unknown> =
      toolInput && typeof toolInput === 'object'
        ? (toolInput as Record<string, unknown>)
        : { value: toolInput };
    // AskUserQuestion 拦截（所有模式共享，提到 askUserOnly 判断之前）：
    // AskUserQuestion 是 Claude Code 内置工具，在 TUI 模式通过 setToolJSX 渲染，
    // SDK headless 模式无法渲染 → allow 后 SDK 执行必失败 → 立即返回空结果
    //（"The user did not answer the questions"）。
    // 故不 allow：拦截 AskUserQuestion，经 resolver 发 PERMISSION_REQUEST 到前端
    //（前端据 tool_name=AskUserQuestion 渲染选项卡片），await 用户回答后把答案作为
    // deny message 回传给 Claude——canUseTool 唯一回传自定义内容给 Claude 的方式
    //（deny 语义虽不完美，但 Claude 把 deny.message 当 tool_result 看到答案继续工作）。
    // 此拦截对所有模式（askUserOnly true/false）生效：askUserOnly=true（scan）原本就
    // 拦截；askUserOnly=false（chat 交互式）现在也拦截，确保前端弹对话卡。
    // 超时 / abort / wrapper 异常 → deny 默认 message（让 Claude 按推荐项继续）。
    if (toolName === 'AskUserQuestion') {
      const askDefaultMsg =
        'User did not respond to the question. Proceed with the recommended option.';
      // resolver/wsClient 在 manualApproval=true 时已校验存在
      //（_buildCanUseToolCallback 仅在 enableApproval=true 分支内注入 driver，
      // 调用时一定存在）。防御性取值便于单测 / 边界容错。
      const askResolver = mgr._resolversBySession.get(sessionId);
      const askWsClient = mgr._permissionWsClient;
      if (!askResolver || !askWsClient) {
        return { behavior: 'deny', message: askDefaultMsg };
      }
      try {
        const { promise } = askResolver.register({
          sessionId,
          runId,
          toolName,
          toolInput: updatedInput,
          signal: options?.signal,
          send: (msg) => askWsClient.send(msg),
          // 标记为 dialog（AskUserQuestion 不是普通审批，是对话）：
          // backend handle_permission_request 见 dialog_kind 走 dialog 路径
          //（持久化 session_dialog_requests + 不 arm 5min 超时 + SSE 携带
          // dialog_kind/dialog_payload 让前端渲染问答卡而非 allow/deny 审批卡）。
          dialogKind: 'AskUserQuestion',
          dialogPayload: updatedInput,
        });
        const decision = await promise;
        if (decision.behavior === 'allow') {
          // 用户回答了。优先取 dialogResult（前端用户选择回传字段），
          // 否则 fallback 到兜底文案（兼容旧 backend 不识别 dialog_result 的 allow）。
          const dialogResult = dialogResultOf(decision); // task-04 轻重构⑥：收敛读取
          const answer =
            dialogResult !== undefined && dialogResult !== null
              ? dialogResult
              : 'no answer payload';
          return {
            behavior: 'deny',
            message: `User answered: ${JSON.stringify(answer)}`,
          };
        }
        // deny / 超时 / abort：让 Claude 按推荐项继续，不卡死 scan。
        return {
          behavior: 'deny',
          message:
            decision.message && decision.message.length > 0
              ? `User did not answer the question (${decision.message}). Proceed with the recommended option.`
              : askDefaultMsg,
        };
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : String(err ?? 'unknown error');
        return {
          behavior: 'deny',
          message: `Failed to get user response (${reason}). Proceed with the recommended option.`,
        };
      }
    }
    // scan 真阻塞（AskUserQuestion-only 策略，改造点 D）：askUserOnly=true 的 session
    //（scan）AskUserQuestion 已在上方拦截，其他工具 allow-through 让 scan 自动推进；
    // 默认 askUserOnly=false（全工具人审的 chat）其他工具走 register
    //（task-08 远程审批危险工具语义不变）。
    if (askUserOnly) {
      // 其他工具正常 allow-through：透传归一化后的 updatedInput（不篡改语义，
      // 仅满足 Zod record 要求），让 scan 自动推进。
      return { behavior: 'allow', updatedInput };
    }
    // Plan 审批升级为 dialog（docs/sillyspec/2026-08-24-platform-session-shell-
    // plan-feedback-gaps 收口）：ExitPlanMode 的 canUseTool 原走下方普通审批——
    // 前端把无 dialog_kind 的审批卡分流到 /runtimes 面板（会话页无卡）+ backend
    // 5min 自动 deny（ephemeral 无 DB 行），用户侧表现正是「plan 发起后没响应」。
    // 复用 AskUserQuestion dialog 基建：dialog_kind='plan_approval' → backend 持久化
    // session_dialog_requests（刷新存活）+ 前端会话页按 dialog_kind 存在性渲染问答卡
    //（长驻可答，无 5min 超时）。答案映射：选「批准计划」→ allow 放行 SDK 退出计划
    // 模式；其他答案/自定义文本 → deny.message 回喂用户反馈，Claude 据此修订计划后
    // 重新提交。scan（askUserOnly）不受影响——上方分支已 allow-through。
    if (toolName === 'ExitPlanMode') {
      const planApproveLabel = '批准计划';
      const planRaw = updatedInput['plan'];
      const planText =
        typeof planRaw === 'string' && planRaw.length > 0 ? planRaw : '';
      // preview 有界：计划全文可能很长，卡片只带前 1500 字预览防巨型 payload
      const planPreview = planText.slice(0, 1500);
      const planResolver = mgr._resolversBySession.get(sessionId);
      const planWsClient = mgr._permissionWsClient;
      if (!planResolver || !planWsClient) {
        return {
          behavior: 'deny',
          message: `Plan approval channel unavailable (session=${sessionId}, run=${runId}); revise and resubmit.`,
        };
      }
      try {
        const { promise } = planResolver.register({
          sessionId,
          runId,
          toolName,
          toolInput: updatedInput,
          signal: options?.signal,
          send: (msg) => planWsClient.send(msg),
          dialogKind: 'plan_approval',
          dialogPayload: {
            questions: [
              {
                question: planPreview
                  ? 'Agent 提交了执行计划等待审批（长驻等待，不会自动超时）：'
                  : 'Agent 提交了执行计划等待审批（长驻等待，不会自动超时）。',
                header: 'Plan 审批',
                options: [
                  {
                    label: planApproveLabel,
                    description: '批准该计划，Agent 按计划开始执行',
                    ...(planPreview ? { preview: planPreview } : {}),
                  },
                  {
                    label: '需要修改',
                    description:
                      '拒绝执行；可在输入框填写修改意见，Agent 会据此修订计划后重新提交',
                    ...(planPreview ? { preview: planPreview } : {}),
                  },
                ],
              },
            ],
          },
        });
        const decision = await promise;
        if (decision.behavior === 'allow') {
          // 问答卡提交语义 = allow + dialog_result.answers；单选答案为选中 label，
          // 填了自定义文本时为文本本身（卡片逻辑：custom 非空时替换选中项）。
          const dialogResult = dialogResultOf(decision); // task-04 轻重构⑥：收敛读取
          const answers = (
            dialogResult as { answers?: unknown } | undefined
          )?.answers;
          const first = Array.isArray(answers) ? answers[0] : undefined;
          const raw = first && typeof first === 'object'
            ? (first as { answer?: unknown }).answer
            : undefined;
          const answer = Array.isArray(raw)
            ? raw.join('；')
            : typeof raw === 'string'
              ? raw
              : '';
          if (answer === planApproveLabel) {
            return { behavior: 'allow', updatedInput };
          }
          return {
            behavior: 'deny',
            message: `计划未批准。用户反馈：${answer || '（无）'}。请根据反馈修订计划后重新提交（ExitPlanMode）。`,
          };
        }
        // deny / abort（dialog 无超时）→ 带默认可读原因 deny，让 Claude 收敛。
        return {
          behavior: 'deny',
          message: `Plan approval not completed (${decision.message ?? 'no response'}). Revise the plan or ask the user in chat.`,
        };
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : String(err ?? 'unknown error');
        return {
          behavior: 'deny',
          message: `Plan approval channel error (${reason}). Revise the plan or ask the user in chat.`,
        };
      }
    }
    // task-09：默认 deny message 模板（含 toolName / sessionId / runId），
    // 远程 deny 未带 message 时回填，让 claude 拿到可读原因自决定收敛行为。
    const defaultDenyMessage = `Tool "${toolName}" denied by reviewer (session=${sessionId}, run=${runId})`;
    // resolver/wsClient 在 manualApproval=true 时已校验存在。
    const resolver = mgr._resolversBySession.get(sessionId);
    const wsClient = mgr._permissionWsClient;
    if (!resolver || !wsClient) {
      // 不应发生（create 时已建 resolver）；防御性 deny。
      return { behavior: 'deny', message: defaultDenyMessage };
    }
    try {
      // resolver.register 内部 send 失败 / signal aborted 时立即 deny（fail-closed）。
      const { promise } = resolver.register({
        sessionId,
        runId,
        toolName,
        toolInput: updatedInput,
        signal: options?.signal,
        send: (msg) => wsClient.send(msg),
      });
      // SDK PermissionResult.deny.message 必填；resolver CanUseToolDecision 的
      // deny.message 可选——此处补默认 message 兜底（task-09：含上下文字段）。
      const decision = await promise;
      if (decision.behavior === 'deny') {
        return {
          behavior: 'deny',
          message: decision.message ?? defaultDenyMessage,
        };
      }
      // 远程审批 allow：透传归一化后的 updatedInput（resolver 决策不携带 input 修改语义，
      // 不篡改；updatedInput 仅满足 Claude CLI Zod record 校验）。
      return { behavior: 'allow', updatedInput };
    } catch (err) {
      // task-09 边界 12：wrapper 自身异常（register 抛 / promise reject 非正常路径）
      // → catch 后返回 deny（带原因），不向上抛让 SDK 把它当 query 失败。
      const reason =
        err instanceof Error ? err.message : String(err ?? 'unknown error');
      return {
        behavior: 'deny',
        message: `${defaultDenyMessage}: wrapper error (${reason})`,
      };
    }
  };
}

/**
 * onUserDialog 回调（SDK request_user_dialog 路由）。
 *
 * ⚠️ AskUserQuestion **不走此路径**：AskUserQuestion 是 Claude Code 内置工具，在
 * SDK headless 模式下不会触发 SDK 的 request_user_dialog（它在 TUI 模式经 setToolJSX
 * 渲染，headless 模式 SDK 直接当普通工具调 canUseTool）。故 AskUserQuestion 的真实
 * 路由是 `_buildCanUseToolCallback` 的 askUserOnly 分支（拦截 → register → 答案经
 * deny.message 回喂 Claude）。
 *
 * 此回调仅对 SDK 真正发出 request_user_dialog 的其他 dialog kind 生效（保留能力，
 * 不影响其他 dialog 路由）。与 _buildCanUseToolCallback 同构但走 SDK 对话协议
 *（返回 {behavior:'completed', result} | {behavior:'cancelled'}），关键差异：
 *   - 走 PERMISSION_REQUEST 时 payload 额外带 dialog_kind + dialog_payload
 *     （backend/前端据此渲染对话卡而非普通审批卡）；
 *   - PERMISSION_RESPONSE.allow 带 dialog_result → 返回 {behavior:'completed',
 *     result: dialog_result}（前端用户选择的答案原样回喂 SDK）；
 *   - allow 但无 dialog_result → {behavior:'completed', result: null}（兼容
 *     旧 backend 不识别 dialog_result 的 allow，不让 SDK 因缺答案报错）；
 *   - deny / 超时 / abort / wrapper 异常 → {behavior:'cancelled'}（SDK 对
 *     cancelled 应用 dialog 默认行为；fail-closed，不本地编造答案）。
 *
 * state 非 running turn / 无 currentRunId / 无 resolver/wsClient → cancelled
 *（防 interrupt 后 SDK 仍触发回调，与 canUseTool 同 fail-closed 语义）。
 *
 * @param sessionId  bind 给当前 session 的回调（同一 SessionManager 多 session 时各独立）。
 */
export function buildOnUserDialogCallback(
  mgr: SessionManagerCore,
  sessionId: string,
): OnUserDialogFn {
  return async (
    request: {
      dialogKind: string;
      payload: Record<string, unknown>;
      toolUseID?: string;
    },
    options?: { signal?: AbortSignal },
  ): Promise<UserDialogResultFn> => {
    const state = mgr._store.get(sessionId);
    // state 不存在 / 非 running turn / 无 currentRunId → fail-closed cancelled。
    if (
      !state ||
      state.status !== 'running' ||
      !state.currentRunId
    ) {
      return { behavior: 'cancelled' };
    }
    const runId = state.currentRunId;
    const resolver = mgr._resolversBySession.get(sessionId);
    const wsClient = mgr._permissionWsClient;
    if (!resolver || !wsClient) {
      // 不应发生（create 时已建 resolver）；防御性 cancelled。
      return { behavior: 'cancelled' };
    }
    try {
      const { promise } = resolver.register({
        sessionId,
        runId,
        // toolName 标记 AskUserQuestion 便于 backend/前端按工具名分发；
        // 实际对话内容由 dialog_kind/dialog_payload 携带。
        toolName: 'AskUserQuestion',
        // toolInput 用 dialog payload（兼容既有的 input 字段，backend 侧若
        // 不读 dialog_payload 仍可从 input 渲染）。
        toolInput: request.payload,
        ...(request.toolUseID !== undefined
          ? { toolUseId: request.toolUseID }
          : {}),
        signal: options?.signal,
        send: (msg) => wsClient.send(msg),
        dialogKind: request.dialogKind,
        dialogPayload: request.payload,
      });
      const decision = await promise;
      if (decision.behavior === 'deny') {
        // deny / 超时 / abort：SDK cancelled 应用 dialog 默认行为。
        return { behavior: 'cancelled' };
      }
      // allow：dialog_result 存在则原样回喂，否则 null（不本地编造）。
      const dialogResult = dialogResultOf(decision); // task-04 轻重构⑥：收敛读取
      return {
        behavior: 'completed',
        result: dialogResult !== undefined ? dialogResult : null,
      };
    } catch {
      // wrapper 自身异常（register 抛 / await reject 非正常路径）→ cancelled，
      // 不向上抛让 SDK 把它当 query 失败。
      return { behavior: 'cancelled' };
    }
  };
}
