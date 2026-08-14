/**
 * fetch-sse：用 fetch + ReadableStream 订阅 text/event-stream 的 EventSource 替代品。
 *
 * 为什么不用 EventSource（task-12 / FR-10 / D-002@v1）：浏览器 EventSource 无法
 * 自定义请求头——token 只能拼进 URL query，而 query 会被访问日志原样记录，
 * 等于把 JWT 明文写进日志。本 helper 把 token 放 ``Authorization: Bearer``
 * header（backend auth_deps 已 header-only，见
 * backend/app/core/tests/test_query_token_removed.py）。
 *
 * 接口形状刻意贴近 EventSource（onopen/onmessage/onerror/addEventListener/
 * readyState/close），调用点从 EventSource 迁移时只改构造方式，事件回调逻辑
 * 逐字保留。
 *
 * 与浏览器 EventSource 的**有意差异**（勿误用）：
 *   - 不做自动重连（Last-Event-ID 重连语义不实现）。现三处调用点均容忍断连
 *     并自带查询兜底 / 手动重连；需要重连的调用方在 onerror 里自建
 *     AbortController 之外的连接重建逻辑。本 helper 在流正常结束或出错时只报
 *     onerror 一次并置 readyState=CLOSED。
 *   - 流结束（backend 关闭 SSE）也走 onerror（EventSource 对服务端断开同样
 *     报 error 事件，这里对齐该行为，调用方按现有 onerror 容忍逻辑处理）。
 */

export type FetchSseEvent = {
  /** data 帧拼接后的载荷（多行 data: 以 \n 连接，与 EventSource 规范一致）。 */
  data: string;
  /** ``id:`` 行的值（无则空串，对齐 EventSource MessageEvent.lastEventId）。 */
  lastEventId: string;
};

export interface FetchSseOptions {
  /**
   * Bearer token 放 Authorization header（本 helper 存在的唯一理由）。
   * 空串 / undefined 时不发 Authorization。
   */
  token?: string;
  /** 额外请求头（如 Accept）。Authorization 会被 token 参数覆盖，勿重复传。 */
  headers?: Record<string, string>;
  /** 外部 abort 信号（组件卸载断流）。close() 内部会自动 abort 连接。 */
  signal?: AbortSignal;
}

/** 单帧解析结果：null = 注释行或空帧（应忽略，不分发）。 */
interface ParsedFrame {
  event: string; // 命名事件名；"" = 默认帧（onmessage 通道）
  data: string;
  id: string | null;
}

/**
 * 解析一段以空行分帧的 text/event-stream 文本（可含多个完整帧 + 1 个尾部半帧）。
 *
 * 规范要点（https://html.spec.whatwg.org/multipage/server-sent-events.html）：
 *   - ``data: <text>`` 多行以 \n 拼接成一条消息；
 *   - ``event: <name>`` 命名事件（无则默认 message）；
 *   - ``id: <id>`` 帧标识（EventSource 断线重连用 Last-Event-ID）；
 *   - ``:`` 开头是注释行（backend ``: connected``/``: keepalive`` 心跳），忽略；
 *   - 空行 = 分帧边界，派发积攒的 data；行首单个 BOM/CR 剥离。
 *
 * @returns frames 完整帧列表；rest 未闭合的尾部半帧文本（拼接进下次 chunk，
 *          不丢跨 chunk 断行的帧）。
 */
export function parseSseChunk(chunk: string): { frames: ParsedFrame[]; rest: string } {
  const frames: ParsedFrame[] = [];
  let event = "";
  let dataLines: string[] = [];
  let id: string | null = null;

  const dispatch = (): void => {
    // 无 data 行的帧（纯注释 / 纯 event 行 + 空行）不派发（对齐规范）。
    if (dataLines.length === 0) return;
    frames.push({ event, data: dataLines.join("\n"), id });
    event = "";
    dataLines = [];
    id = null;
  };

  const lines = chunk.split("\n");
  // 尾部若非 \n 结束，最后一段是未完成的半行——留给下一个 chunk。
  const rest = chunk.endsWith("\n") ? "" : (lines.pop() as string);

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      dispatch();
      continue;
    }
    if (line.startsWith(":")) continue; // 注释行 / 心跳
    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1); // 冒号后可选单空格
    }
    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
    // retry / 未知字段：忽略（无自动重连，见文件头注释）。
  }
  return { frames, rest };
}

/** fetch-SSE 连接句柄：形状贴近 EventSource（close/readyState/on* 回调）。 */
export interface FetchSseConnection {
  /** 事件回调。默认帧（无 event: 行）→ onmessage；命名事件走 addEventListener。 */
  onmessage: ((e: FetchSseEvent) => void) | null;
  /**
   * TCP+HTTP 连接建立（fetch resolve 且 response.ok）后立即触发一次——
   * 与 EventSource.onopen 等价时点（agent-stream ql-20260622 依赖它清
   * loading：backend 只发 ``:`` 注释心跳时 onmessage 永不触发，connected
   * 状态只能靠本回调翻转）。
   */
  onopen: (() => void) | null;
  /**
   * 网络错误 / 非 2xx 响应 / 流中断 / 流结束。触发后连接终止（readyState=2），
   * 不自动重连（见文件头「有意差异」）。
   */
  onerror: ((ev: { status?: number }) => void) | null;
  /** 0=CONNECTING 1=OPEN 2=CLOSED（对齐 EventSource readyState 语义）。 */
  readonly readyState: 0 | 1 | 2;
  /** 注册命名事件监听（如 ``event: done`` 帧）。返回解绑函数。 */
  addEventListener(type: string, listener: (e: FetchSseEvent) => void): () => void;
  /** 主动断流（abort 底层 fetch）。幂等。 */
  close(): void;
}

/**
 * 订阅 SSE 流。用法：
 *
 * ```ts
 * const conn = fetchSse(url, {
 *   token,
 *   signal: abortController.signal,
 * });
 * conn.onopen = () => setConnected(true);
 * conn.onmessage = (e) => handle(JSON.parse(e.data));
 * conn.addEventListener("done", (e) => conn.close());
 * conn.onerror = () => { /* 容忍断连，靠查询兜底 *\/ };
 * ```
 *
 * 返回的句柄回调字段与 EventSource 同名同语义，迁移时回调逻辑可逐字保留。
 */
export function fetchSse(
  url: string,
  options: FetchSseOptions = {},
): FetchSseConnection {
  const controller = new AbortController();
  // 外部 signal 触发时联动 abort 底层连接（组件卸载断流）。外部 abort 视为
  // 调用方主动终止：直接置 CLOSED 且不报 onerror（对齐主动 close()）。
  const externalSignal = options.signal;
  let terminatedByCaller = false;
  const onExternalAbort = (): void => {
    if (state === 2) return;
    terminatedByCaller = true;
    state = 2;
    externalSignal?.removeEventListener("abort", onExternalAbort);
    controller.abort();
  };
  externalSignal?.addEventListener("abort", onExternalAbort);

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    ...(options.headers ?? {}),
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  type NamedListener = (e: FetchSseEvent) => void;
  let namedListeners: Record<string, NamedListener[]> = {};
  let lastEventId = "";

  const conn: FetchSseConnection = {
    onmessage: null,
    onopen: null,
    onerror: null,
    get readyState(): 0 | 1 | 2 {
      return state;
    },
    addEventListener(type: string, listener: NamedListener): () => void {
      (namedListeners[type] ??= []).push(listener);
      return () => {
        namedListeners[type] = (namedListeners[type] ?? []).filter(
          (l) => l !== listener,
        );
      };
    },
    close(): void {
      if (state === 2) return;
      state = 2;
      externalSignal?.removeEventListener("abort", onExternalAbort);
      controller.abort();
      namedListeners = {};
    },
  };

  let state: 0 | 1 | 2 = 0;
  // TS 控制流窄化不跨闭包共享（state 在 async IIFE / fail / close 多处被改），
  // 读取统一走本快照函数，避免 2367「无重叠比较」假报。
  const snapshotState = (): 0 | 1 | 2 => state as 0 | 1 | 2;
  const isClosed = (): boolean => snapshotState() === 2;

  const fail = (err: { status?: number }): void => {
    if (state === 2) return;
    state = 2;
    externalSignal?.removeEventListener("abort", onExternalAbort);
    conn.onerror?.(err);
  };

  const dispatchFrame = (frame: ParsedFrame): void => {
    if (frame.id !== null) lastEventId = frame.id;
    const evt: FetchSseEvent = { data: frame.data, lastEventId };
    if (frame.event === "") {
      conn.onmessage?.(evt);
    } else {
      for (const l of namedListeners[frame.event] ?? []) l(evt);
    }
  };

  void (async () => {
    try {
      const resp = await fetch(url, {
        headers,
        signal: controller.signal,
        // SSE 必须禁缓存（EventSource 实现同样带 no-store）。
        cache: "no-store",
      });
      if (!resp.ok || !resp.body) {
        fail({ status: resp.status });
        return;
      }
      if (isClosed()) return; // close() 先于响应到达
      state = 1;
      conn.onopen?.();

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const idx = buffer.lastIndexOf("\n\n");
        // 规范按空行分帧；也容忍 \r\n\r\n（backend 输出统一 \n，防御处理）。
        const crlfIdx = buffer.lastIndexOf("\r\n\r\n");
        let complete: string;
        if (crlfIdx > idx) {
          complete = buffer.slice(0, crlfIdx + 4);
        } else if (idx !== -1) {
          complete = buffer.slice(0, idx + 2);
        } else {
          continue;
        }
        buffer = buffer.slice(complete.length);
        const { frames } = parseSseChunk(complete);
        for (const frame of frames) {
          if (isClosed()) return;
          dispatchFrame(frame);
        }
      }
      // 流正常结束（backend 关闭连接）：对齐 EventSource 行为报 onerror，
      // 调用方按断连处理（本 helper 不自动重连）。
      fail({});
    } catch (err) {
      // close() / 外部 abort 是调用方主动终止，正常收尾不报错。
      if (isClosed()) return;
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        terminatedByCaller
      ) {
        state = 2;
        externalSignal?.removeEventListener("abort", onExternalAbort);
        return;
      }
      fail({});
    }
  })();

  return conn;
}
