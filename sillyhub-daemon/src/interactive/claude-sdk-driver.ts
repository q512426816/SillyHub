/**
 * interactive/claude-sdk-driver.ts —— @anthropic-ai/claude-agent-sdk 封装（task-04 §4.2）。
 *
 * 职责（design §7.1 / spike-02 §3.7 H1/H2/D1/D4）：
 *   - start(input, opts)：调用 SDK query({ prompt: AsyncIterable, options }) 启动同进程多轮
 *     （spike H2），返回 ClaudeDriverHandle（含底层 Query）供 consume/interrupt。
 *   - consume(handle, cb)：for-await 遍历底层 Query AsyncGenerator，每条 result 触发 onResult
 *     （spike D4：result 是干净 turn 边界，无孤儿后台事件），中间消息走 onMessage，
 *     generator 抛错走 onError。
 *   - interrupt(handle)：turn 级（spike D1：q.interrupt() 后当前 turn 产 error_during_execution，
 *     query 不结束可续轮）。handle=null 或抛错 → no-op 返回 false。
 *
 * task-03（D-001@v1 / D-009@v1）：`ClaudeSdkDriver implements InteractiveDriver`
 *（driver.ts provider-neutral 契约）。`start` 入参从 `AsyncIterable<SDKUserMessage>` 改为
 * `AsyncIterable<UserTurnInput>`，driver 内部用 `mapUserTurnInputToSdk` 把 provider-neutral
 * 输入转成 SDK 专属 SDKUserMessage——SDK 类型只在 driver 内部出现，SessionManager 不依赖
 * Claude SDK 类型。`consume`/`interrupt` 签名泛化到 `InteractiveDriverHandle`，但底层行为
 *（spike D1/D4、partial flush、canUseTool/onUserDialog 透传、executable 解析）一行不改
 *（FR-10 第一优先级）。
 *
 * **task-01 R-exe reverse sync（关键）**：agent-detector 给出的 claude 路径通常是 npm
 * cmd-shim wrapper（C:\nvm4w\nodejs\claude.cmd），SDK 的 child_process.spawn 不带 shell:true
 * → Windows CreateProcess 对 .cmd/.bat/.ps1 返回 EINVAL（4ms 失败，进程根本没起）。
 * 因此 driver 在 start 前必须把 wrapper 解析到底层真 .exe（node_modules\@anthropic-ai\
 * claude-code\bin\claude.exe）。agent-detector.ts 不改（不在 allowed_paths）。
 *
 * 来源：design.md §5.1 / §7.1 / §10 R-exe；spike-02 §3.7 H1（env 继承）/ H2（AsyncIterable 两轮）/
 * D1（interrupt 续轮）/ D4（result 边界）；task-01 §「R-exe 关键修正」。
 *
 * @module interactive/claude-sdk-driver
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type {
  CanUseTool,
  OnUserDialog,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverStartOptions,
  UserTurnInput,
} from './driver.js';

/** executable 缺失/解析失败抛出。code 字段供 daemon / 测试识别。 */
export class ClaudeExecutableNotFoundError extends Error {
  readonly code = 'CLAUDE_EXECUTABLE_NOT_FOUND' as const;
  constructor(reason: string) {
    super(`claude executable not found: ${reason} (CLAUDE_EXECUTABLE_NOT_FOUND)`);
    this.name = 'ClaudeExecutableNotFoundError';
  }
}

/**
 * task-01 R-exe：把 agent-detector 给出的路径解析成 SDK spawn 能直接接受的真 .exe。
 *
 * 策略：
 *   1. 空/undefined → throw ClaudeExecutableNotFoundError。
 *   2. 已是 .exe（Windows）或非 Windows 任意路径 → 校验 existsSync 后直传。
 *   3. 是 .cmd/.bat/.ps1（npm cmd-shim wrapper）→ 读 wrapper 文件内容，正则提取
 *      `node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]bin[\\/]claude.exe`，
 *      与 wrapper 所在 dir join 得真 exe 绝对路径；校验真 exe 存在；都失败 → throw。
 *   4. 非 wrapper 但既非 .exe 又无法解析（如 sh wrapper）→ 校验 existsSync 后直传
 *      （非 Windows 主路径；Windows 上 detector 已保证只给可执行扩展名，见
 *      agent-detector WINDOWS_EXTS）。
 *
 * 该函数纯函数 + fs 同步读，便于单测 mock fs。
 */
export function resolveClaudeExecutable(detectedPath: string): string {
  if (!detectedPath || detectedPath.trim() === '') {
    throw new ClaudeExecutableNotFoundError('empty path');
  }

  // Windows wrapper 后缀检测（case-insensitive）。
  const isWrapper = /\.(cmd|bat|ps1)$/i.test(detectedPath);
  const isExe = /\.exe$/i.test(detectedPath);

  if (!isWrapper) {
    // 直传路径（.exe 或 POSIX）。校验存在；不存在显式报错（避免 spawn EINVAL/ENOENT 黑盒）。
    if (!existsSync(detectedPath)) {
      throw new ClaudeExecutableNotFoundError(
        `path does not exist: ${detectedPath}`,
      );
    }
    return detectedPath;
  }

  // wrapper：必须先存在且能读。
  if (!existsSync(detectedPath)) {
    throw new ClaudeExecutableNotFoundError(
      `wrapper does not exist: ${detectedPath}`,
    );
  }
  if (isExe) {
    // 不可能同时 .exe 和 wrapper，但防御性。
    return detectedPath;
  }

  let wrapperContent: string;
  try {
    wrapperContent = readFileSync(detectedPath, 'utf8');
  } catch (e) {
    throw new ClaudeExecutableNotFoundError(
      `cannot read wrapper ${detectedPath}: ${(e as Error).message}`,
    );
  }

  // 正则提取 node_modules/@anthropic-ai/claude-code/bin/claude.exe（路径分隔符正反斜杠均允许）。
  // npm cmd-shim 生成的 wrapper 内会引用绝对或相对的真 exe 路径。
  const re =
    /([^\s"'<>|]*node_modules[\\/]+@anthropic-ai[\\/]+claude-code[\\/]+bin[\\/]+claude\.exe)/i;
  const m = re.exec(wrapperContent);
  if (!m || !m[1]) {
    throw new ClaudeExecutableNotFoundError(
      `wrapper ${detectedPath} does not reference @anthropic-ai/claude-code/bin/claude.exe`,
    );
  }
  // gap-7：cmd-shim wrapper（claude.cmd）用批处理变量 %~dp0（= wrapper 所在 dir）
  // 引用真 exe，path.join 不解析 cmd 变量 → 当字面目录名 → join 出无效路径
  // `wrapperDir\%~dp0%\node_modules\...`。去掉 %~dp0 / %~dp0\ / %dp0% 前缀，
  // 让 join(dirname(wrapper), extracted) 用 wrapper dir 作正确基目录。
  const extracted = m[1].replace(/%[~]?dp0%?[\\/]?/gi, '');

  // 提取到的可能是相对 wrapper dir 的路径（cmd-shim 内通常写绝对路径，但兼容相对）。
  let realExe: string;
  if (
    extracted.startsWith('/') ||
    extracted.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(extracted)
  ) {
    realExe = normalize(extracted);
  } else {
    realExe = normalize(join(dirname(detectedPath), extracted));
  }

  if (!existsSync(realExe)) {
    throw new ClaudeExecutableNotFoundError(
      `resolved exe from wrapper does not exist: ${realExe}`,
    );
  }
  return realExe;
}

/** driver 启动参数（design §7.1 ClaudeSdkDriverOptions + StartOptions.resume）。 */
export interface ClaudeSdkDriverOptions {
  /**
   * D-009@v1：agent-detector 检测的系统 claude 路径（必需，可为 .cmd wrapper）。
   * driver 内部经 resolveClaudeExecutable 转 wrapper→真.exe（task-01 R-exe）。
   * 缺失/空串 → start 抛 ClaudeExecutableNotFoundError（拒绝启动 interactive session）。
   */
  pathToClaudeCodeExecutable: string;
  /** 固定 cwd（resume 按 cwd 分目录，spike D3）；driver 不接受 cwd 变更。 */
  cwd: string;
  /**
   * canUseTool 回调。Wave2 地基默认 undefined=SDK 内置默认策略；
   * task-08 接远程人审（D-007）。
   */
  canUseTool?: CanUseTool;
  /**
   * onUserDialog 回调（SDK request_user_dialog / AskUserQuestion 真实路由路径）。
   *
   * 当 supportedDialogKinds 非空时，SDK 把声明的 dialog kind（如
   * 'AskUserQuestion'）经本回调转发而非 canUseTool；daemon 在此发
   * PERMISSION_REQUEST（带 dialog_kind/dialog_payload）等前端答案。
   * 缺省 undefined：SDK 不发 dialog request（AskUserQuestion 走默认行为，
   * 回 'user did not answer'）。由 SessionManager 在 manualApproval=true 时注入。
   */
  onUserDialog?: OnUserDialog;
  /**
   * 本 consumer 能渲染的 dialog kind 列表（如 ['AskUserQuestion']）。
   *
   * SDK 契约：只有声明在此的 kind 才会触发 onUserDialog；非空列表但不传
   * onUserDialog 在 SDK intake 阶段抛错。缺省 undefined：不发 dialog request。
   */
  supportedDialogKinds?: string[];
  /** 模型覆盖；缺省走 ANTHROPIC_DEFAULT_*_MODEL 环境映射（不传进 options，让 SDK 走默认）。 */
  model?: string;
  /** 允许工具白名单；缺省不传（D-008 错误透传，不预禁工具）。 */
  allowedTools?: string[];
  /**
   * env 继承策略。默认 `{ ...process.env }`（spike H1：SDK spawn 的 claude 继承
   * ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL，daemon 不读 credentials.json）。
   */
  env?: Record<string, string>;
}

/**
 * task-03（D-001@v1）：Claude 专属启动选项。extends driver.ts 的 provider-neutral
 * `InteractiveDriverStartOptions`，补 Claude SDK 专属字段（pathToClaudeCodeExecutable /
 * canUseTool / onUserDialog / supportedDialogKinds / allowedTools）。
 *
 * design §5.1：「provider 专属字段（如 pathToClaudeCodeExecutable / canUseTool）通过
 * provider 专属 StartOptions 由各 driver 自行定义并 extends 本接口的扩展类型」。
 * task-01 产出的 `InteractiveDriverStartOptions` 只含 provider 无关字段（cwd/resume/
 * model/manualApproval/askUserOnly/env），Claude 专属审批/exe 字段在此补充。
 */
export interface ClaudeStartOptions extends InteractiveDriverStartOptions {
  /** D-009@v1：claude 可执行路径（必需，可为 .cmd wrapper）。 */
  pathToClaudeCodeExecutable: string;
  /** Claude SDK 远程人审回调（D-006@v1）；缺省走 SDK 内置策略。 */
  canUseTool?: CanUseTool;
  /** Claude SDK 对话路由回调（D-008@v1，AskUserQuestion 等）。 */
  onUserDialog?: OnUserDialog;
  /** 本 consumer 能渲染的 dialog kind 列表（SDK 契约：声明在此才经 onUserDialog）。 */
  supportedDialogKinds?: string[];
  /** 允许工具白名单；缺省不传（D-008 不预禁工具）。 */
  allowedTools?: string[];
  /** env 继承；缺省 `{ ...process.env }`。 */
  env?: Record<string, string>;
}

/**
 * @deprecated task-03 起 driver 三方法 provider-neutral 化，请改用 {@link ClaudeStartOptions}。
 * 保留为兼容别名（现有 import / 测试 mock 引用 StartOptions 不破，AC-03 alias）。
 */
export type StartOptions = ClaudeStartOptions;

/** consume 回调集合（provider-neutral，对齐 driver.ts InteractiveDriverCallbacks）。 */
export interface ClaudeDriverCallbacks {
  /**
   * spike D4：result 是干净 turn 边界。每条 result 触发一次 onResult，
   * SessionManager 据此通知 backend 关闭当前 AgentRun（completed/failed）。
   * SDKResultMessage 是 InteractiveDriverResult 的超集，直接透传。
   */
  onResult: (result: SDKResultMessage) => void | Promise<void>;
  /** 中间消息（assistant text/tool_use/tool_result/system/init）→ onMessage。可选。 */
  onMessage?: (msg: SDKMessage) => void | Promise<void>;
  /** query 异常（spawn 失败 / 网络）→ session failed。 */
  onError?: (err: unknown) => void | Promise<void>;
}

/**
 * @deprecated task-03 起改用 {@link ClaudeDriverCallbacks}；保留为兼容别名
 *（现有 import / 测试 mock 引用 ConsumeCallbacks 不破，AC-03 alias）。
 */
export type ConsumeCallbacks = ClaudeDriverCallbacks;

/**
 * task-03（D-001@v1）：Claude 专属 driver 句柄。extends provider-neutral
 * `InteractiveDriverHandle`，携带底层 SDK `Query`（consume/interrupt 用）。
 *
 * `provider` 固定 `'claude'`，用于 task-02 的 interrupt 路由校验（E5：不串 provider）。
 * E7：本句柄含底层 Query/子进程资源，不可序列化、禁止落盘。
 */
export interface ClaudeDriverHandle extends InteractiveDriverHandle {
  readonly provider: 'claude';
  /** 底层 SDK Query（consume for-await / interrupt 用）。 */
  readonly query: Query;
}

/**
 * task-03（D-009@v1）：UserTurnInput → SDKUserMessage 的 AsyncIterable 转换。
 *
 * 纯转换层，不缓冲、不丢消息：for-await 上游 input，逐条把 provider-neutral
 * `{type:'user', text}` 映射成 Claude SDK 专属 `{type:'user', message:{role:'user',
 * content:text}, parent_tool_use_id:null}`。上游 close（InputQueue.close）→
 * generator 自然结束 → SDK query 退出。
 *
 * 边界（蓝图边界 1）：空串 `text:''` 仍 yield 一条消息（与 SessionManager inject
 * push 空 prompt 行为一致；语义校验在 backend 层，driver 不越权）。
 */
export async function* mapUserTurnInputToSdk(
  input: AsyncIterable<UserTurnInput>,
): AsyncGenerator<SDKUserMessage, void> {
  for await (const turn of input) {
    yield {
      type: 'user',
      message: { role: 'user', content: turn.text },
      parent_tool_use_id: null,
    };
  }
}

/**
 * ClaudeSdkDriver：封装 SDK query / interrupt / consume（task-03 起 implements
 * provider-neutral `InteractiveDriver`，D-001@v1）。
 *
 * 无状态（不持有 query 句柄；句柄以 ClaudeDriverHandle 形式由 SessionManager 持有）。
 * 便于在 SessionManagerDeps 里注入 mock 测试，也便于多 session 并发各用独立 driver
 *（或共享一个）。
 */
export class ClaudeSdkDriver implements InteractiveDriver {
  /** D-001@v1：provider 标识（task-02 interrupt 路由校验用）。 */
  readonly provider = 'claude' as const;

  /**
   * 启动 SDK query，订阅 input AsyncIterable（长生命周期，跨 turn）。
   * 返回 ClaudeDriverHandle（含底层 Query）供 consume/interrupt。
   *
   * task-03（D-009@v1）：入参从 `AsyncIterable<SDKUserMessage>` 改为 provider-neutral
   * `AsyncIterable<UserTurnInput>`；driver 内部用 mapUserTurnInputToSdk 转成
   * SDK 专属形态后交给 sdkQuery——SDK 类型只在 driver 内部出现。
   *
   * spike H2 实测签名：`query({ prompt: AsyncIterable, options: {...} })`。
   * options 透传 pathToClaudeCodeExecutable（已 wrapper→exe 解析）/ cwd / env /
   * canUseTool / model / allowedTools / resume。字段缺失不写进 options，让 SDK 走默认。
   *
   * @throws {ClaudeExecutableNotFoundError} executable 缺失 / wrapper 解析失败
   */
  async start(
    input: AsyncIterable<UserTurnInput>,
    opts: ClaudeStartOptions,
  ): Promise<ClaudeDriverHandle> {
    const realExe = resolveClaudeExecutable(opts.pathToClaudeCodeExecutable);

    // 构造 options，仅写非 undefined 字段（让 SDK 对缺失字段走默认）。
    const options: Record<string, unknown> = {
      pathToClaudeCodeExecutable: realExe,
      cwd: opts.cwd,
      env: opts.env ?? { ...process.env },
    };
    if (opts.canUseTool !== undefined) {
      options.canUseTool = opts.canUseTool;
    }
    if (opts.onUserDialog !== undefined) {
      options.onUserDialog = opts.onUserDialog;
    }
    if (opts.supportedDialogKinds !== undefined) {
      options.supportedDialogKinds = opts.supportedDialogKinds;
    }
    if (opts.model !== undefined) {
      options.model = opts.model;
    }
    if (opts.allowedTools !== undefined) {
      options.allowedTools = opts.allowedTools;
    }
    if (opts.resume !== undefined) {
      options.resume = opts.resume;
    }

    // ql-20260621-partial：开启 SDK 流式 partial 消息推送。SDK 会在每个
    // Anthropic streaming event（content_block_delta 等）到达时 emit
    // SDKPartialAssistantMessage（type='stream_event'），让 SessionManager
    // 能实时缓冲 + 节流 flush 给前端（避免 2 分钟白屏等完整 block）。
    // SessionManager._onMessage 负责识别并批量推送，不会每 token 一次 HTTP。
    options.includePartialMessages = true;

    // 2026-06-28-daemon-subagent-transcript task-01 / D-001@v1 / D-006@v1：
    // 开启子代理（Task/Agent tool spawn）text/thinking 转发。SDK 默认 false 时
    // 子代理只有 tool_use/tool_result 心跳进主流（text/thinking 丢弃，daemon
    // 根本收不到）；开启后子代理完整对话作为带 parent_tool_use_id 的
    // assistant/user message 流入主流 query generator（sdk.d.ts:1544-1550），
    // 让 SessionManager 识别归属 + partial 按 parent 分桶（task-02/03）。
    // 仅 Claude provider（D-006@v1，Codex 机制不同本期不碰）。
    options.forwardSubagentText = true;

    // D-009@v1：UserTurnInput → SDKUserMessage（SDK 类型隔离在 driver 内部）。
    const sdkInput = mapUserTurnInputToSdk(input);
    const query = sdkQuery({ prompt: sdkInput, options });
    return { provider: 'claude', query };
  }

  /**
   * spike D1：interrupt 是 turn 级。调用底层 query.interrupt() 后当前 turn 产出 result
   * subtype=error_during_execution，但 query 不结束、可续轮。
   *
   * handle 为 null / 无 interrupt 方法 / interrupt 抛错 → no-op 返回 false
   *（不向上冒泡，避免 daemon 主循环崩；E3）。
   */
  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (handle === null || handle === undefined) {
      return false;
    }
    const q = (handle as ClaudeDriverHandle).query;
    if (!q || typeof q.interrupt !== 'function') {
      return false;
    }
    try {
      await q.interrupt();
      return true;
    } catch {
      // q 已结束 / 不支持 interrupt → no-op。
      return false;
    }
  }

  /**
   * 遍历底层 Query AsyncGenerator（spike D4：result 后无孤儿后台事件）。
   * 对每条 message：onMessage（如有）；对每条 result：onResult。
   * for-await 正常结束或抛错时按需调 onError，然后 return（query 已结束）。
   *
   * task-03：签名泛化到 `InteractiveDriverHandle`，从 handle 取底层 query 后行为不变。
   * 实现：用 SDKResultMessage 的 `type === 'result'` 区分 result 与普通 message。
   * spike D4 证明 result 后无孤儿事件，所以 onResult 内可以直接收敛 AgentRun。
   */
  async consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    const q = (handle as ClaudeDriverHandle).query;
    const cb = callbacks as unknown as ClaudeDriverCallbacks;
    try {
      for await (const msg of q) {
        if (msg !== null && typeof msg === 'object' && (msg as { type?: string }).type === 'result') {
          await cb.onResult(msg as SDKResultMessage);
        } else if (cb.onMessage) {
          await cb.onMessage(msg);
        }
      }
    } catch (err) {
      if (cb.onError) {
        await cb.onError(err);
      }
    }
  }
}
