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
