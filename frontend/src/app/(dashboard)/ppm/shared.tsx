"use client";

/**
 * PPM 页面共享的小工具:输入框样式、日期格式化、状态标签、Toast。
 * 不依赖额外 npm 包,统一中文化。
 *
 * 注:文件扩展名为 .tsx,因含 JSX(<Toast /> 组件)。
 */
import { useEffect, useState } from "react";

export const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** ISO/任意时间字符串 → 本地化展示 (zh-CN)。 */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("zh-CN");
  } catch {
    return s;
  }
}

/** 仅日期展示 (用于工时日期)。 */
export function fmtDay(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return s;
  }
}

/** 取今天 yyyy-MM-dd。 */
export function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** PlanTask / TaskExecute 状态中文标签 + 颜色。
 *
 * 兼容两套状态语义:
 * - PlanTask.status 存中文(未开始/进行中/已完成,见 ppm_plan_task 模型);
 * - TaskExecute.status 存数字(10/20/30/90,见 service STATUS_*)。
 * 中文 case 放在数字 case 之后,switch 精确匹配互斥,不影响数字用法。
 */
export function taskStatusTag(status: string): {
  text: string;
  color: string;
} {
  switch (status) {
    case "10":
      return { text: "待执行", color: "default" };
    case "20":
      return { text: "执行中", color: "processing" };
    case "30":
      return { text: "待验证", color: "warning" };
    case "40":
      return { text: "已完成", color: "success" };
    case "50":
      return { text: "已关闭", color: "default" };
    // PlanTask 中文状态(ppm_plan_task.status)
    case "未开始":
      return { text: "未开始", color: "default" };
    case "进行中":
      return { text: "进行中", color: "processing" };
    case "已完成":
      return { text: "已完成", color: "success" };
    default:
      return { text: status || "未知", color: "default" };
  }
}

export interface ToastState {
  ok: boolean;
  text: string;
}

/** 一个极简 Toast 钩子,3 秒后自动消失。 */
export function useToast(): {
  toast: ToastState | null;
  showToast: (ok: boolean, text: string) => void;
} {
  const [toast, setToast] = useState<ToastState | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const showToast = (ok: boolean, text: string) => setToast({ ok, text });
  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      className={`rounded border px-3 py-2 text-xs ${
        toast.ok
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-destructive/30 bg-red-50 text-destructive"
      }`}
    >
      {toast.text}
    </div>
  );
}

/** 解析工时字符串 (如 "0.5"/"2d") 为数字小时数,失败返回 null。 */
export function parseHours(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isNaN(n) && n >= 0) return n;
  return null;
}
