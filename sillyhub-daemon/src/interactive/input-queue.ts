/**
 * interactive/input-queue.ts —— per-session 用户输入队列（task-04 §4.1 + task-01 泛型化）。
 *
 * 职责：为 interactive driver 的 `start(input: AsyncIterable)` 提供长生命周期、
 * 跨多 turn 的 AsyncIterable。driver 订阅一次（spike H2），SessionManager 通过
 * push 喂入用户消息（首 turn + 追问），close() 让 iterator 自然结束 → driver
 * consume 退出 → session ended 语义。
 *
 * task-01（D-009@v1）：从 Claude SDK 专属 `AsyncIterable<SDKUserMessage>` 泛型化为
 * provider-neutral `AsyncIterable<UserTurnInput>`（默认类型参数）。新代码 `new InputQueue()`
 * 即得 provider-neutral 队列；现有 Claude 调用点（session-manager.ts）过渡期显式标注
 * `new InputQueue<SDKUserMessage>()`，真正的 UserTurnInput 化由 task-02 完成。
 * 本文件不再 import Claude Agent SDK（D-009@v1 类型隔离）。
 *
 * 行为要点（spike H2/S1，泛型化后逐行保留 = FR-10 不回退）：
 *   - 单订阅：第二次 [Symbol.asyncIterator] 抛 SessionQueueDoubleSubscribeError
 *     （driver 一次 consume 一个 iterator，spike S1 一次 query 一个 iterator）。
 *   - turn 级串行不靠队列层强制：队列只保证按 push 顺序 yield；"同一 turn 不接受第二条"
 *     由 driver 自身 turn 级语义保证（spike S1：未 result 的 push 自然排队到下一 turn）。
 *   - 不丢消息：close 前已 push 的消息必须全部 yield 完才结束 iterator。
 *   - close 后 push 抛 SessionQueueClosedError。
 *
 * 来源：design.md §7.2 / §7.6；spike-02 §3.7 H2（AsyncIterable 两轮）/ S1（turn 级串行）；
 * task-01 D-009@v1（脱离 SDK）。
 *
 * @module interactive/input-queue
 */

import type { UserTurnInput } from './driver.js';

/** close 后再 push 抛出。code 字段供 SessionManager / daemon 识别。 */
export class SessionQueueClosedError extends Error {
  readonly code = 'SESSION_QUEUE_CLOSED' as const;
  constructor() {
    super('input queue closed; cannot push (SESSION_QUEUE_CLOSED)');
    this.name = 'SessionQueueClosedError';
  }
}

/** 第二次订阅（第二次 [Symbol.asyncIterator]）抛出。SDK 一次 query 一个 iterator。 */
export class SessionQueueDoubleSubscribeError extends Error {
  readonly code = 'SESSION_QUEUE_DOUBLE_SUBSCRIBE' as const;
  constructor() {
    super(
      'input queue already subscribed; SDK queries one iterator per session ' +
        '(SESSION_QUEUE_DOUBLE_SUBSCRIBE)',
    );
    this.name = 'SessionQueueDoubleSubscribeError';
  }
}

/**
 * per-session 用户输入队列。driver `start(input: queue)` 单次订阅。
 *
 * task-01（D-009@v1）：泛型化 `InputQueue<T = UserTurnInput>`。默认类型参数
 * UserTurnInput 使新代码 provider-neutral；现有 Claude 调用点过渡期显式
 * `InputQueue<SDKUserMessage>`（task-02 才真正 UserTurnInput 化 push）。
 *
 * 实现说明（逻辑泛型化后逐行不变 = FR-10）：
 *   - `_buffer` 缓冲已 push 未消费消息（FIFO）。
 *   - `_pending` 是当前等待下一条消息的 consumer resolver（最多一个，因 driver 单订阅）。
 *   - `_closed` close 后置位；iterator 在 yield 完 buffer 后通过 resolve(null) 结束。
 *   - push 时若有 pending resolver，立即 resolve 消息（buffer 不增）；否则入 buffer。
 *   - close 时若有 pending resolver，resolve(null) 让 iterator 立即结束（buffer 已空）。
 */
export class InputQueue<T = UserTurnInput> implements AsyncIterable<T> {
  /** 已 push 但尚未 yield 的消息缓冲（FIFO）。 */
  private readonly _buffer: T[] = [];
  /** 等待下一条消息的 consumer resolver（最多一个）。null = 当前无 waiter。 */
  private _pending: ((msg: T | null) => void) | null = null;
  private _closed = false;
  /** iterator 是否已被创建（防二次订阅）。 */
  private _subscribed = false;

  /**
   * push 一条用户消息。
   *
   * @throws {SessionQueueClosedError} close 后再 push
   */
  push(msg: T): void {
    if (this._closed) {
      throw new SessionQueueClosedError();
    }
    const waiter = this._pending;
    if (waiter !== null) {
      // 有 consumer 在 await，直接交付，不缓冲。
      this._pending = null;
      waiter(msg);
    } else {
      this._buffer.push(msg);
    }
  }

  /** 关闭队列。幂等（多次 close 不抛）。iterator 在 yield 完已 push 消息后结束。 */
  close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    // 若有 consumer 在 await 且 buffer 已空，立即让 iterator 结束。
    // buffer 非空时 iterator 的 next() 会先 yield 完 buffer 再在下次 next() 收到 null 结束。
    if (this._buffer.length === 0) {
      const waiter = this._pending;
      if (waiter !== null) {
        this._pending = null;
        waiter(null);
      }
    }
  }

  /**
   * ql-20260807-002：reload 热切换供应商时重置订阅标记，让新 query 能重新订阅本队列。
   *
   * InputQueue 单订阅（``_subscribed``，第二次 [Symbol.asyncIterator] 抛
   * SessionQueueDoubleSubscribeError）。create 时 SDK 已订阅（``_subscribed=true``）；
   * reloadWithProvider 复用同一 ``state.inputQueue`` 让新 query 吃后续 inject，但新
   * query 订阅会触发二次订阅抛错 → SDK query abort（"Operation aborted"）→ onError →
   * fail → session ended（实测 reload 后会话 ended 的真正根因，非 close 旧 query）。
   * 本方法在 reload driver.start 前调，重置 ``_subscribed`` 让新 query 能合法订阅。
   *
   * 保留 ``_buffer``（reload 期间已 push 的 pending inject 不丢）+ ``_closed``（reload
   * 不 close 队列，保持 false）。
   *
   * ql-20260825-f3#3：在途 waiter 必须 resolve「关闭哨兵」（null），不能只清引用。
   * 旧实现 ``this._pending = null`` 直接丢弃旧 consume 的 next() Promise（永不
   * settle）→ 阻塞在 ``input.next()`` 的旧 consume 协程（如 codex _takeNextTurn
   * 的 await）永久挂起，finally（stdoutLogStream.end()/rl.close()/h.close()）永不
   * 执行 → WriteStream fd 泄漏 + 子进程句柄滞留。resolve(null) 走 next() 的
   * null 契约（msg===null → {done:true}）→ 旧 for-await 干净退出走 finally 完成
   * 清理。新 waiter 由新订阅的 next() 重建。
   */
  resetForResubscribe(): void {
    this._subscribed = false;
    const waiter = this._pending;
    this._pending = null;
    if (waiter !== null) {
      waiter(null);
    }
  }

  /**
   * AsyncIterable 实现：driver `start(input: queue)` 订阅一次。
   *
   * @throws {SessionQueueDoubleSubscribeError} 第二次订阅
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this._subscribed) {
      throw new SessionQueueDoubleSubscribeError();
    }
    this._subscribed = true;

    // iterator 内部：next() 返回 { value, done }。
    // - 若 buffer 有消息：直接 yield 首条。
    // - 否则若已 close：done=true。
    // - 否则 await 下一条 push / close（resolve null）。
    const self = this;
    const next = (): Promise<IteratorResult<T>> => {
      if (self._buffer.length > 0) {
        const value = self._buffer.shift() as T;
        return Promise.resolve({ value, done: false });
      }
      if (self._closed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      // 等待 push / close。
      return new Promise<T | null>((resolve) => {
        self._pending = resolve;
      }).then((msg) =>
        msg === null
          ? { value: undefined, done: true }
          : { value: msg, done: false },
      );
    };

    return {
      next,
      // driver 的 consume 不依赖 return()，但提供 return 让 for-await break 时干净退出。
      return(): Promise<IteratorResult<T>> {
        self._closed = true;
        const waiter = self._pending;
        if (waiter !== null) {
          self._pending = null;
          waiter(null);
        }
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
