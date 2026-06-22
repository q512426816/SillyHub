import { getApiBaseUrl } from "./api";
import { getAgentRunLogs, type StreamLogEvent } from "./agent";
import {
  parseSessionPermissionEvent,
  type SessionPermissionRequest,
  type SessionPermissionResolved,
} from "./daemon";
import { useSession } from "@/stores/session";

export type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

export interface StreamDoneData {
  status?: string | null;
  exit_code?: number | null;
}

export class AgentRunStreamClient {
  private workspaceId: string;
  private runId: string;
  private status: StreamStatus = "disconnected";
  private es: EventSource | null = null;
  private retryCount = 0;
  private maxRetries = 5;
  private backoffMs = [1000, 2000, 4000, 8000, 16000];
  private seenLogIds = new Set<string>();
  private lastLogId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private messageCallbacks: Array<(event: StreamLogEvent) => void> = [];
  private statusCallbacks: Array<(status: StreamStatus) => void> = [];
  private doneCallbacks: Array<(data: StreamDoneData) => void> = [];
  // ql-20260621：permission_request / permission_resolved 走专用回调，不混入日志流
  // （它们没 timestamp，进 _emitMessage 会被丢弃，导致审批卡片永远不显示）。
  private permissionRequestCallbacks: Array<
    (req: SessionPermissionRequest) => void
  > = [];
  private permissionResolvedCallbacks: Array<
    (resolved: SessionPermissionResolved) => void
  > = [];

  constructor(workspaceId: string, runId: string) {
    this.workspaceId = workspaceId;
    this.runId = runId;
  }

  async connect(token: string): Promise<void> {
    // P1 race guard：并发重入直接跳过。hook 每次 effect new 新实例，正常不触发；
    // 防御 _doReconnect 重连与外部 connect 的并发竞态。
    // 注：不挡 "connected" —— _doReconnect(agent-stream.ts:_doReconnect) 在 onerror 后
    // 重连时 status 仍是 connected，挡了会让重连失效。
    if (this.status === "connecting") return;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this._setStatus("connecting");

    // 先拉取已持久化日志，避免 SSE 订阅前发布的行丢失（Bootstrap 恢复 / 晚连场景）。
    try {
      const logs = await getAgentRunLogs(this.workspaceId, this.runId);
      // P1 race guard：await 期间若已被 disconnect()（status→disconnected），
      // 不再继续创建 EventSource —— 否则 StrictMode 双调用 / 快速重连会产生
      // 无人持有的孤儿 EventSource（cleanup 已 disconnect，但 connect 的后半段
      // 仍 new EventSource 并注册 onmessage/ondone）。
      // 注：`as StreamStatus` 绕过入口 guard 的控制流窄化 —— TS 不跨 _setStatus
      // 方法重置对 this.status 的窄化，断言恢复完整联合类型以允许此比较。
      if ((this.status as StreamStatus) !== "connecting") return;
      for (const log of logs) {
        this._emitMessage({
          channel: log.channel as StreamLogEvent["channel"],
          content: log.content_redacted ?? "",
          timestamp: log.timestamp,
          log_id: log.id,
        });
      }
    } catch {
      /* prefetch 失败不阻断 SSE */
    }

    // 二次复查：emit 链路同步，status 理论不变；防御性再次确认未被外部 abort。
    if ((this.status as StreamStatus) !== "connecting") return;

    const base = getApiBaseUrl();
    const url = new URL(
      `${base}/api/workspaces/${this.workspaceId}/agent/runs/${this.runId}/stream`,
    );
    if (this.lastLogId) url.searchParams.set("after", this.lastLogId);
    url.searchParams.set("token", token);

    this.es = new EventSource(url.toString());

    this.es.onmessage = (e: MessageEvent<string>) => {
      try {
        // ql-20260621：run SSE 已同时订阅 agent_session:{id} 频道，permission_*
        // 事件会复用该连接到达。它们没 timestamp 字段，走 _emitMessage 会被丢弃，
        // 因此先专用解析 → 专用回调，其余才当普通 log 处理。
        const data: unknown = JSON.parse(e.data);
        const permEvt = parseSessionPermissionEvent(data);
        if (permEvt) {
          if ((permEvt as SessionPermissionRequest).tool_name) {
            const req = permEvt as SessionPermissionRequest;
            this.permissionRequestCallbacks.forEach((cb) => cb(req));
          } else {
            const resolved = permEvt as SessionPermissionResolved;
            this.permissionResolvedCallbacks.forEach((cb) => cb(resolved));
          }
          if (this.status === "connecting") this._setStatus("connected");
          return;
        }
        this._emitMessage(data as StreamLogEvent);
        if (this.status === "connecting") this._setStatus("connected");
      } catch {
        /* ignore parse errors */
      }
    };

    this.es.addEventListener("done", (e: MessageEvent<string>) => {
      let data: StreamDoneData = {};
      try {
        data = JSON.parse(e.data);
      } catch {
        /* empty done data is valid */
      }
      this.doneCallbacks.forEach((cb) => cb(data));
      this.disconnect();
    });

    this.es.onerror = () => {
      this._reconnect();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.retryCount = 0;
    this._setStatus("disconnected");
  }

  onMessage(cb: (event: StreamLogEvent) => void): () => void {
    this.messageCallbacks.push(cb);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter((c) => c !== cb);
    };
  }

  onStatusChange(cb: (status: StreamStatus) => void): () => void {
    this.statusCallbacks.push(cb);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((c) => c !== cb);
    };
  }

  onDone(cb: (data: StreamDoneData) => void): () => void {
    this.doneCallbacks.push(cb);
    return () => {
      this.doneCallbacks = this.doneCallbacks.filter((c) => c !== cb);
    };
  }

  /**
   * ql-20260621：注册 permission_request 事件回调。
   * 当 run SSE 收到 `{event:"permission_request",...}`（Claude Code AskUserQuestion
   * 触发 canUseTool 远程人审）时触发。父组件据此渲染审批卡片。
   * 返回取消订阅函数。
   */
  onPermissionRequest(cb: (req: SessionPermissionRequest) => void): () => void {
    this.permissionRequestCallbacks.push(cb);
    return () => {
      this.permissionRequestCallbacks = this.permissionRequestCallbacks.filter(
        (c) => c !== cb,
      );
    };
  }

  /**
   * ql-20260621：注册 permission_resolved 事件回调。
   * backend 在用户决策（manual）或 5min 超时（timeout）后 publish，父组件据此移除卡片。
   */
  onPermissionResolved(
    cb: (resolved: SessionPermissionResolved) => void,
  ): () => void {
    this.permissionResolvedCallbacks.push(cb);
    return () => {
      this.permissionResolvedCallbacks = this.permissionResolvedCallbacks.filter(
        (c) => c !== cb,
      );
    };
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  private _setStatus(s: StreamStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusCallbacks.forEach((cb) => cb(s));
  }

  private _emitMessage(event: StreamLogEvent): void {
    // ql-20260616-003：忽略非 log 类事件（status_changed / messages summary 等）。
    // 后端 SSE 频道复用，会推 status_changed、done、messages 聚合等事件，它们没
    // timestamp 字段，emit 给 UI 会渲染成 Invalid Date 行。
    if (typeof event.timestamp !== "string" || !event.timestamp) return;
    if (event.log_id != null) {
      if (this.seenLogIds.has(event.log_id)) return;
      this.seenLogIds.add(event.log_id);
      this.lastLogId = event.log_id;
    }
    this.messageCallbacks.forEach((cb) => cb(event));
  }

  private _reconnect(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.retryCount >= this.maxRetries) {
      this._setStatus("error");
      return;
    }
    const delay = this.backoffMs[this.retryCount] ?? 16000;
    this.retryCount++;
    this.reconnectTimer = setTimeout(() => {
      void this._doReconnect();
    }, delay);
  }

  private async _doReconnect(): Promise<void> {
    try {
      const { accessToken } = useSession.getState();
      if (!accessToken) {
        this._reconnect();
        return;
      }
      if (this.lastLogId) {
        const logs = await getAgentRunLogs(
          this.workspaceId,
          this.runId,
          this.lastLogId,
        );
        for (const log of logs) {
          this._emitMessage({
            channel: log.channel as StreamLogEvent["channel"],
            content: log.content_redacted ?? "",
            timestamp: log.timestamp,
            log_id: log.id,
          });
        }
      }
      this.connect(accessToken);
    } catch {
      this._reconnect();
    }
  }
}
