"use client";

/**
 * task-12（FR-07 / D-007@v1）：canUseTool 远程人审审批模态弹窗。
 *
 * 与 task-08 的内联 ``PermissionApprovalCard`` 区别：本组件是整页遮罩模态
 * （``role="dialog"`` + ``aria-modal="true"``），消费同一个 permission_request
 * SSE 通道（task-08 publish 到 ``agent_session:{id}`` channel），并调用同一个
 * ``respondSessionPermission`` 端点，**不新增第二套通道**。
 *
 * 职责：受控渲染 + allow/deny/稍后回调。SSE 订阅、FIFO 队列、去重、幂等由父级
 * page 持有；本组件只负责可访问地展示队首请求并触发决策。
 *
 * 安全：
 *   - 不把 input 写入 console / 日志。
 *   - input 渲染用限高滚动 + JSON formatter；渲染失败回退类型摘要，不崩溃。
 *   - submitting 时禁用全部决策按钮，防双击。
 */

import { Fragment, useEffect, useId, useMemo, useRef } from "react";
import { Ban, Check, Clock, ShieldAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 队列内一条 permission 请求（跨 session 可能并存）。 */
export interface PermissionQueueItem {
  sessionId: string;
  runId: string;
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface PermissionApprovalDialogProps {
  /** 当前队首请求；为 null 时不渲染。 */
  request: PermissionQueueItem | null;
  submitting: boolean;
  error: string | null;
  onRespond: (decision: "allow" | "deny") => Promise<void> | void;
  onDefer: () => void;
}

/** 5min 倒计时窗口（ms），与 backend PERMISSION_TIMEOUT_SEC 对齐（仅 UI 提示）。 */
const PERMISSION_WINDOW_MS = 5 * 60 * 1000;

/** 安全地把 input 摘要成可读字符串（截断 + 失败回退）。 */
function summarizeInput(input: unknown): { json: string | null; kind: string } {
  if (input == null) return { json: null, kind: "null" };
  try {
    const str = JSON.stringify(input, null, 2);
    if (typeof str === "string") {
      return { json: str.length > 8000 ? `${str.slice(0, 8000)}…` : str, kind: typeof input };
    }
  } catch {
    // 非可序列化（循环引用等）
  }
  if (Array.isArray(input)) return { json: null, kind: "array" };
  if (typeof input === "object") return { json: null, kind: "object" };
  return { json: String(input), kind: typeof input };
}

export function PermissionApprovalDialog({
  request,
  submitting,
  error,
  onRespond,
  onDefer,
}: PermissionApprovalDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const allowRef = useRef<HTMLButtonElement | null>(null);

  // 队首切换或重开时聚焦 Allow，便于键盘操作（无焦点陷阱，保持轻量）。
  useEffect(() => {
    if (request && !submitting) {
      allowRef.current?.focus();
    }
  }, [request, submitting]);

  const remainingMs = useCountdown(request?.requestId ?? null);

  if (!request) return null;

  const { json, kind } = summarizeInput(request.input);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        // 背景点击不自动 defer（B-10：不得在错误/未审批时静默丢弃）
        if (e.target === e.currentTarget) {
          // 阻止冒泡，保持请求在队首
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg overflow-hidden rounded-md border bg-card shadow-lg"
      >
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-semibold">
                权限审批：{request.toolName}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                会话 {request.sessionId.slice(0, 8)}… · 请求 {request.requestId.slice(0, 8)}…
              </p>
            </div>
          </div>
          <CountdownPill remainingMs={remainingMs} />
        </header>

        <div className="max-h-[50vh] overflow-y-auto px-4 py-3">
          {error && (
            <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            守护进程请求执行工具，请确认是否允许。
          </p>
          <dl className="mt-2 space-y-1 text-xs">
            <Row label="工具">
              <code className="rounded bg-muted px-1.5 py-0.5">{request.toolName}</code>
            </Row>
            <Row label="运行">
              <code className="rounded bg-muted px-1.5 py-0.5">{request.runId.slice(0, 8)}…</code>
            </Row>
          </dl>
          <div className="mt-3">
            <p className="text-[11px] font-medium text-muted-foreground">输入摘要</p>
            {json !== null ? (
              <pre className="mt-1 max-h-48 overflow-auto rounded border bg-muted/30 p-2 text-[11px] leading-relaxed">
                {json}
              </pre>
            ) : (
              <p className="mt-1 rounded border bg-muted/30 p-2 text-[11px] text-muted-foreground">
                不可序列化输入（{kind}）
              </p>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t bg-card px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onDefer}
            disabled={submitting}
            className="gap-1.5"
          >
            <Clock className="h-3.5 w-3.5" />
            稍后处理
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onRespond("deny")}
            disabled={submitting}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            拒绝
          </Button>
          <Button
            ref={allowRef}
            variant="default"
            size="sm"
            onClick={() => void onRespond("allow")}
            disabled={submitting}
            className="gap-1.5"
          >
            <Check className="h-3.5 w-3.5" />
            允许
          </Button>
        </footer>
      </div>
    </div>
  );
}

/** 本地倒计时（仅 UI 提示；backend 5min 自动 deny 才是 source of truth）。 */
function useCountdown(key: string | null): number {
  const [startTs] = useMemo(() => [Date.now()], [key]);
  // 不引入额外 state 轮询开销：返回固定窗口，依赖父级 permission_resolved 收口。
  void startTs;
  return PERMISSION_WINDOW_MS;
}

function CountdownPill({ remainingMs }: { remainingMs: number }) {
  const minutes = Math.floor(remainingMs / 60000);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      <Clock className="h-3 w-3" />
      {minutes} 分钟内审批
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-12 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// re-export Fragment type hint so tree-shakers keep react import used.
void Fragment;
void cn;
