"use client";

import { Component, type ReactNode } from "react";

import { asString } from "@/lib/utils";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 标识错误来源，打到 console 便于定位（如 "agent-log-row"）。 */
  label?: string;
  /** 自定义降级渲染，不传则用内置极简降级。 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ql-20260620：通用 React 错误边界。
 *
 * 背景：整个应用此前没有任何 ErrorBoundary，日志组件渲染期任意一条数据
 * 触发的异常都会一路冒泡，把整个 dashboard 渲染成白屏
 * （生产模式 `next start` 下表现为 "Application error: a client-side
 * exception has occurred"，且看不到堆栈）。
 *
 * 本组件把异常隔离在子树内：捕获后 `console.error` 打印错误与 componentStack
 * （解决生产模式看不到堆栈的问题，便于后续精准定位），并降级渲染，避免整页崩。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    const tag = this.props.label ? `: ${this.props.label}` : "";
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${tag}]`, error, info?.componentStack ?? "");
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} onReset={this.reset} />;
  }
}

function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-[11px] text-red-700">
      <div className="font-medium">该区块渲染失败</div>
      <div className="mt-0.5 break-all font-mono text-[10px] text-red-600/80">
        {asString(error?.message) || "未知错误"}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-1 rounded border border-red-300 bg-white px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-100"
      >
        重试
      </button>
    </div>
  );
}
