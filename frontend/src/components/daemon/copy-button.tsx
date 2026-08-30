"use client";

import { memo, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** 复制反馈时长（ms）：成功「✓ 已复制」/ 失败「复制失败」显示窗口，到点复位。 */
const FEEDBACK_RESET_MS = 1200;

type CopyStatus = "idle" | "done" | "failed";

export interface CopyButtonProps {
  /** 静态纯文本（与 getText 二选一，同传时 getText 优先）；空串/null 整钮不渲染。 */
  text?: string;
  /**
   * 点击时惰性取值（如用户气泡剥离附件标记后的文本——与显示同源）。组件不在
   * 渲染期调用以保持惰性，空值判否归调用方（渲染处已有 parsed.text 可复用）。
   */
  getText?: () => string | null;
  /** aria-label 兜底（缺省「复制」；复制成功窗口期自动切「已复制」）。 */
  ariaLabel?: string;
  /** 透传类（与默认右下角定位类经 tailwind-merge 合并，可覆盖 right/bottom）。 */
  className?: string;
}

/**
 * task-11（2026-08-31-session-queue-ux / FR-07 / R-06）：消息复制小按钮，
 * 三处气泡复用（TextSegmentView / ThinkingRowView 展开正文 / turn-timeline
 * 用户气泡）。交互对齐原型 prototype-session-queue-ux.html `.copy-btn`：
 *
 *   - 常驻隐藏，父容器（需带 `group` 类 + relative）hover 或自身 focus 浮出
 *     ——纯 CSS `:hover` 零状态（design Phase 3），不占外层组件任何 state；
 *   - 定位默认气泡右下角外侧下方（原型 right:6px / bottom:-22px；用户气泡
 *     原型为 right:0 / bottom:-24px，经 className 覆盖），不遮正文；
 *   - 点击 `navigator.clipboard?.writeText` 写纯文本，成功文案「✓ 已复制」
 *     1.2s 后复位（本地 useState + setTimeout，卸载清理定时器）；
 *   - clipboard 不可用（http 局域网非安全上下文）/ 写入失败 → console.warn
 *     静默降级 + 短暂「复制失败」（R-06：不阻塞聊天，禁 alert/notify 弹层）；
 *   - 反馈 state 内聚于本组件——外层 memo 段组件浅比较不受影响（NG-05：
 *     ToolRowView 既有工具行复制先例不动）。
 */
export const CopyButton = memo(function CopyButton({
  text,
  getText,
  ariaLabel = "复制",
  className,
}: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 卸载清理：气泡重挂载/折叠收起时不留悬挂复位回调（setState on unmounted）。 */
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  /* text 传参路径的空值门槛（getText 路径保持点击期惰性，判否归调用方）。 */
  if (!getText && !(text && text.length > 0)) return null;

  const scheduleReset = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setStatus("idle");
    }, FEEDBACK_RESET_MS);
  };

  const handleCopy = (): void => {
    const value = getText ? getText() : (text ?? "");
    if (value == null || value.length === 0) return;
    const fail = (err: unknown): void => {
      console.warn("[CopyButton] 复制失败（R-06 静默降级，不阻塞聊天）", err);
      setStatus("failed");
      scheduleReset();
    };
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        throw new Error("navigator.clipboard 不可用（非安全上下文？）");
      }
      void clipboard
        .writeText(value)
        .then(() => {
          setStatus("done");
          scheduleReset();
        })
        .catch(fail);
    } catch (err) {
      fail(err);
    }
  };

  const done = status === "done";
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={done ? "已复制" : ariaLabel}
      className={cn(
        // 原型 .copy-btn：气泡右下角外侧浮出，11px 小字、muted 色、透明底
        "absolute -bottom-[22px] right-1.5 z-10 inline-flex cursor-pointer items-center gap-[3px] rounded-[5px] px-[5px] py-[2px] text-[11px] text-muted-foreground transition-colors",
        // 常驻隐藏：父容器 group hover / 自身 focus 浮出（纯 CSS 零状态）
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        "hover:bg-muted hover:text-foreground",
        // done 态品牌色（原型 .copy-btn.done 常显语义阶）；失败态 destructive
        done && "text-brand-600 opacity-100",
        status === "failed" && "text-destructive opacity-100",
        className,
      )}
    >
      {done ? "✓ 已复制" : status === "failed" ? "复制失败" : "⧉ 复制"}
    </button>
  );
});
