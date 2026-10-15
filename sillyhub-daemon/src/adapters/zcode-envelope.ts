/**
 * ZcodeEnvelope —— ZCode 私有协议（app-server）NDJSON 信封层（纯编解码，无进程 IO）。
 *
 * 2026-10-15-zcode-engine-appserver task-02（D-005/D-007）。
 *
 * 协议事实（2026-10-15 实测钉板，decisions.md D-005 evidence）：
 *   - 信封 strict 四分支 union（服务端 zod strict 校验，多余键直接拒——实测
 *     jsonrpc / requestId 键均被拒）：
 *       1. 请求      {id, method, params?, trace?}   —— daemon→server 出站（id 数字自增）
 *       2. 通知      {method, params?, trace?}       —— 双向
 *       3. 响应      {id, result}                    —— 双向（id 随发起方）
 *       4. 错误帧    {id, error:{code,message,data?}} —— 双向
 *   - 服务端主动请求（requestRuntimePreferences / requestPermission 等）的 id 为
 *     字符串（"server-N"），客户端必须以 {id, result} 回应答；
 *   - 无 initialize 握手；出站帧不得携带 jsonrpc 等多余键。
 *
 * 与 adapters/json-rpc.ts 的关系（D-007 红线）：完全独立，不改后者（codex 在用）。
 * 本层只做帧编解码 + 关联 + 分发；进程 spawn/stdio 管线由
 * interactive/zcode-app-server-driver.ts 持有。
 *
 * 服务端请求超时语义（实测）：create/send 触发的 session/requestRuntimePreferences
 * 15s 无应答则方法调用失败——本层对未注册 handler 的服务端请求立即回空 result
 * 兜底，防挂死；注册了 handler 但 handler 异步拖延的超时由调用方（驱动）负责。
 */

/** 客户端→服务端请求帧。 */
export interface ZcodeOutboundRequest {
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

/** 双向通知帧。 */
export interface ZcodeNotification {
  readonly method: string;
  readonly params?: unknown;
}

/** 服务端→客户端主动请求（id 为字符串，如 "server-1"）。 */
export interface ZcodeServerRequest {
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

/** 服务端→客户端响应（id 对应客户端请求的数字 id）。 */
export interface ZcodeServerResponse {
  readonly id: number;
  readonly result: unknown;
}

/** 错误帧（双向；id 随发起方，本层只消费入站错误）。 */
export interface ZcodeErrorFrame {
  readonly id: number | string;
  readonly error: { code: number; message: string; data?: unknown };
}

/** 结构化协议错误（请求 reject / 协议解析错误共用形状）。 */
export class ZcodeProtocolError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'ZcodeProtocolError';
  }
}

/** 应答服务端请求的回写通道（驱动注入 stdin write）。 */
export interface ZcodeWriteSink {
  write(line: string): void;
}

type ServerRequestHandler = (
  params: unknown,
  reply: (result: unknown) => void,
) => void;

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (err: ZcodeProtocolError) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * ZCode 私有协议信封编解码器（每会话一个实例）。
 *
 * 用法（驱动层装配）：
 *   const env = new ZcodeEnvelope();
 *   env.onNotification(n => ...归一化...);
 *   env.registerServerRequestHandler('session/requestRuntimePreferences', (p, reply) => reply({...}));
 *   child.stdout.on('data', chunk => env.feed(chunk, { write: l => child.stdin.write(l) }));
 *   await env.request('session/create', {...}, l => child.stdin.write(l));
 */
export class ZcodeEnvelope {
  private nextId = 1;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly serverHandlers = new Map<string, ServerRequestHandler>();
  private notificationHandler: ((n: ZcodeNotification) => void) | undefined;
  private protocolErrorHandler: ((err: ZcodeProtocolError) => void) | undefined;
  private buffer = '';

  /** 注册服务端主动请求的分发处理器（按 method 覆盖注册）。 */
  registerServerRequestHandler(method: string, handler: ServerRequestHandler): void {
    this.serverHandlers.set(method, handler);
  }

  /** 注册通知回调（事件流入口，归一化器消费）。 */
  onNotification(handler: (n: ZcodeNotification) => void): void {
    this.notificationHandler = handler;
  }

  /** 注册协议错误回调（非法 JSON / 未知形状帧；不抛出，fail-soft 记录）。 */
  onProtocolError(handler: (err: ZcodeProtocolError) => void): void {
    this.protocolErrorHandler = handler;
  }

  /**
   * 发送请求并等待响应。timeoutMs 默认 30s；超时 reject（timedOut=true）并清理
   * pending（迟到的响应按未知 id 丢弃，不误 resolve）。
   */
  request(
    method: string,
    params: unknown,
    write: (line: string) => void,
    opts: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const id = this.nextId++;
    const frame: ZcodeOutboundRequest =
      params === undefined ? { id, method } : { id, method, params };
    const timeoutMs = opts.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                new ZcodeProtocolError(
                  `zcode 请求超时未响应：${method}（${timeoutMs}ms）`,
                  undefined,
                  undefined,
                  true,
                ),
              );
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer });
      write(encodeFrame(frame));
    });
  }

  /** 发送单向通知。 */
  sendNotification(method: string, params: unknown, write: (line: string) => void): void {
    const frame: ZcodeNotification =
      params === undefined ? { method } : { method, params };
    write(encodeFrame(frame));
  }

  /**
   * 喂入 stdout 原始字节（NDJSON 分帧：按 \n 切行，残行留缓冲拼接）。
   * 每完整行走 handleLine 四分支解复用。
   */
  feed(chunk: string, sink: ZcodeWriteSink): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.handleLine(line, sink);
    }
  }

  /**
   * 处理单行入站帧（四分支解复用：响应 → pending / 错误 → pending reject /
   * 服务端请求 → 分发器 / 通知 → onNotification）。
   */
  handleLine(line: string, sink: ZcodeWriteSink): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.protocolErrorHandler?.(
        new ZcodeProtocolError(`zcode 协议帧 JSON 解析失败：${trimmed.slice(0, 200)}`),
      );
      return;
    }
    if (!isRecord(parsed)) {
      this.protocolErrorHandler?.(
        new ZcodeProtocolError(`zcode 协议帧非对象：${trimmed.slice(0, 200)}`),
      );
      return;
    }

    // 分支 1/2：响应（id + result）——id 为数字，对应客户端请求。
    if (hasProp(parsed, 'id') && hasProp(parsed, 'result') && typeof parsed.id === 'number') {
      const entry = this.pending.get(parsed.id);
      if (entry) {
        this.pending.delete(parsed.id);
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        entry.resolve(parsed.result);
      }
      // 未知 id（超时后迟到）→ 静默丢弃。
      return;
    }

    // 分支 3：错误帧（id + error）。
    if (hasProp(parsed, 'id') && hasProp(parsed, 'error')) {
      const errObj = parsed.error;
      if (isRecord(errObj) && typeof errObj.code === 'number' && typeof errObj.message === 'string') {
        if (typeof parsed.id === 'number') {
          const entry = this.pending.get(parsed.id);
          if (entry) {
            this.pending.delete(parsed.id);
            if (entry.timer !== undefined) clearTimeout(entry.timer);
            entry.reject(
              new ZcodeProtocolError(errObj.message, errObj.code, errObj.data),
            );
          }
          return;
        }
        // id 为字符串的错误帧（服务端主动请求的应答被拒形态）→ 协议错误记录。
        this.protocolErrorHandler?.(
          new ZcodeProtocolError(errObj.message, errObj.code, errObj.data),
        );
        return;
      }
      this.protocolErrorHandler?.(
        new ZcodeProtocolError(`zcode 错误帧形状非法：${trimmed.slice(0, 200)}`),
      );
      return;
    }

    // 分支 4：服务端主动请求（id 字符串 + method）。
    if (hasProp(parsed, 'method') && hasProp(parsed, 'id') && typeof parsed.id === 'string') {
      const method = String(parsed.method);
      const handler = this.serverHandlers.get(method);
      const reply = (result: unknown): void => {
        sink.write(encodeFrame({ id: parsed.id, result }));
      };
      if (handler) {
        try {
          handler(parsed.params, reply);
        } catch (err) {
          // handler 同步抛错 → 回空 result 兜底 + 协议错误记录（不挂死对端）。
          this.protocolErrorHandler?.(
            new ZcodeProtocolError(
              `zcode 服务端请求 handler 异常：${method}（${String(err)}）`,
            ),
          );
          sink.write(encodeFrame({ id: parsed.id, result: {} }));
        }
      } else {
        // 未注册方法 → 回空 result（防 15s 超时挂死会话创建，实测语义）。
        sink.write(encodeFrame({ id: parsed.id, result: {} }));
      }
      return;
    }

    // 分支 5：通知（method 无 id）。
    if (hasProp(parsed, 'method') && !hasProp(parsed, 'id')) {
      this.notificationHandler?.({
        method: String(parsed.method),
        params: parsed.params,
      });
      return;
    }

    this.protocolErrorHandler?.(
      new ZcodeProtocolError(`zcode 协议帧形状未识别：${trimmed.slice(0, 200)}`),
    );
  }

  /** 关闭：清理全部 pending 计时器并 reject（进程退出时调用）。 */
  dispose(): void {
    for (const [, entry] of this.pending) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(
        new ZcodeProtocolError('zcode 信封层已销毁（连接关闭）', undefined, undefined, true),
      );
    }
    this.pending.clear();
  }
}

/** 出站帧编码：JSON + 换行（strict——只序列化显式字段，undefined 键自动省略）。 */
function encodeFrame(frame: object): string {
  return `${JSON.stringify(frame)}\n`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasProp(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
