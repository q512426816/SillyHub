import { getApiBaseUrl } from "./api";
import { getAgentRunLogs, type StreamLogEvent } from "./agent";
import { useSession } from "@/stores/session";

export type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

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
  private doneCallbacks: Array<() => void> = [];

  constructor(workspaceId: string, runId: string) {
    this.workspaceId = workspaceId;
    this.runId = runId;
  }

  connect(token: string): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this._setStatus("connecting");

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

    this.es.addEventListener("done", () => {
      this.doneCallbacks.forEach((cb) => cb());
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

  onDone(cb: () => void): () => void {
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
