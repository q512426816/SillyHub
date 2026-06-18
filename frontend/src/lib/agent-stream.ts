import { getApiBaseUrl } from "./api";
import { getAgentRunLogs, type StreamLogEvent } from "./agent";
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

  constructor(workspaceId: string, runId: string) {
    this.workspaceId = workspaceId;
    this.runId = runId;
  }

  async connect(token: string): Promise<void> {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this._setStatus("connecting");

    // 先拉取已持久化日志，避免 SSE 订阅前发布的行丢失（Bootstrap 恢复 / 晚连场景）。
    try {
      const logs = await getAgentRunLogs(this.workspaceId, this.runId);
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

    const base = getApiBaseUrl();
    const url = new URL(
      `${base}/api/workspaces/${this.workspaceId}/agent/runs/${this.runId}/stream`,
    );
    if (this.lastLogId) url.searchParams.set("after", this.lastLogId);
    url.searchParams.set("token", token);

    this.es = new EventSource(url.toString());

    this.es.onmessage = (e: MessageEvent<string>) => {
      try {
        const parsed: StreamLogEvent = JSON.parse(e.data);
        this._emitMessage(parsed);
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
