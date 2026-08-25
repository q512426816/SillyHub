import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * ql-20260620：把任意值安全转成字符串。
 *
 * 后端日志 `content_redacted` schema 声明为 str|None，但 SSE 流式推送时
 * 偶发出现 number/object 等非字符串类型。日志渲染链路里所有 `.split("\n")`
 * 只靠 `?? ""` 降级——这只防 null/undefined，对 number/object 仍会让
 * `.split` 抛 TypeError，进而整页崩成 client-side exception。
 * 统一用本函数入口归一化，非字符串一律转 string，null/undefined 转 ""。
 */
export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

/* ── 2026-08-25：leading+trailing 去抖（SSE 变更信号 → invalidate 风暴抑制）── */

/** debounceLeadingTrailing 的返回类型：可调用 + cancel 清挂起的 trailing。 */
export type LeadingTrailingDebounced<A extends unknown[]> = ((
  ..._args: A
) => void) & {
  /** 丢弃挂起的 trailing 执行（不影响已执行的 leading）；供卸载清理。 */
  cancel(): void;
};

/**
 * leading+trailing 去抖：窗口开启的首次调用立即执行（leading），窗口期（waitMs）
 * 内的后续调用不立即执行、只记最后一次参数，窗口关闭时补一次 trailing 执行。
 *
 * 语义（对照 lodash debounce {leading:true, trailing:true} 的常用子集）：
 *   - 单次调用 → 只执行一次（leading），无 trailing；
 *   - 窗口期内密集调用 → leading 一次 + 窗口尾 trailing 一次（用最后一次参数）；
 *   - 持续调用 → 每个窗口至多 2 次执行，窗口间由下一次调用重新 leading。
 *
 * 消费点：sessions-portal 的 SSE 会话变更信号 → invalidate ["agentSessions"]
 * （一轮会话活动典型触发 2~3 个哑信号，每个全量重拉 limit=500 列表）。
 */
export function debounceLeadingTrailing<A extends unknown[]>(
  fn: (..._args: A) => void,
  waitMs: number,
): LeadingTrailingDebounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingTrailing = false;
  let lastArgs: A | null = null;
  const debounced = (...args: A): void => {
    lastArgs = args;
    if (timer !== null) {
      // 窗口期内：不立即执行，合并为窗口尾的一次 trailing。
      pendingTrailing = true;
      return;
    }
    // 窗口未开：leading 立即执行并开窗。
    fn(...args);
    timer = setTimeout(() => {
      timer = null;
      if (pendingTrailing && lastArgs) {
        pendingTrailing = false;
        fn(...lastArgs);
      }
    }, waitMs);
  };
  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingTrailing = false;
    lastArgs = null;
  };
  return debounced;
}
