import { ApiError } from "@/lib/api";
import { App } from "antd";

/**
 * 从任意错误取出面向用户的中文文案。
 *
 * 规则（按顺序匹配）：
 * 1. ApiError 且 code === "network_error" → 网络层失败的统一中文兜底
 *    （apiFetch catch fetch 异常时抛此 code，见 api.ts:136-141；
 *     err.message 此时是英文 "Failed to fetch"，不能直接展示）。
 * 2. 其它 Error（含 ApiError 业务错误）且 message 非空 → err.message
 *    （后端 AppError.message 已是中文，见 design §1）。
 * 3. 否则 → fallback ?? "操作失败"。
 *
 * 铁律：返回值绝不包含 err.code（英文 HTTP_xxx / 业务码），见 D-006@v1。
 */
export function errMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiError && err.code === "network_error") {
    return "网络连接失败，请检查网络后重试";
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback ?? "操作失败";
}

/**
 * 组件内统一的 antd toast 通知入口。
 *
 * 封装 App.useApp().message + errMessage：调用方传任意错误对象，
 * 内部自动取出中文文案（network 兜底 / err.message / fallback）。
 *
 * 必须在 <AntApp> 内使用 —— dashboard 全局已被 antd-providers.tsx
 * 的 <AntApp> 包裹（R-01 已确认），所有 dashboard 路由均可直接调用。
 *
 * 展示策略规范（design §5）：操作类（删/建/改/启停）走 toast；
 * 加载/列表失败仍用 inline 红条 setError(errMessage(err))，不走本 hook。
 */
export function useNotify(): {
  error: (err: unknown, fallback?: string) => void;
  success: (msg: string) => void;
} {
  const { message } = App.useApp();
  return {
    error: (err, fallback) => message.error(errMessage(err, fallback)),
    success: (msg) => message.success(msg),
  };
}
