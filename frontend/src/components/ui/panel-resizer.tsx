"use client";

/**
 * PanelResizer / usePanelWidth · 左右分栏拖拽调宽的通用件。
 *
 * 从 explorer 页面的 TreePanelResizer 抽离泛化（ql-20260821-013-2c1a）：
 * - usePanelWidth({storageKey, defaultWidth, minWidth, maxWidth})：宽度状态 +
 *   localStorage 记忆（非法/越界值 clamp 回默认，隐私模式静默降级）
 * - PanelResizer：夹持把手，左右拖调宽、双击复位默认、←/→ 键微调 16px
 *
 * 交互细节：window 级 pointermove/pointerup 监听（不用 setPointerCapture——jsdom
 * 无实现，测试走 fireEvent(window) 同路径，见 explorer-page.test.tsx 的
 * createEvent+defineProperty 补坐标方案）；监听只挂一次，回调经 ref 转发取最新。
 */

import { useEffect, useRef, useState } from "react";

/** 键盘微调步长（px）。 */
const KEYBOARD_STEP_PX = 16;

export interface PanelWidthOptions {
  /** localStorage 记忆 key（仅本地浏览器）。 */
  storageKey: string;
  /** 默认/双击复位宽度（px）。 */
  defaultWidth: number;
  /** 最小宽度（px），默认 200。 */
  minWidth?: number;
  /** 最大宽度（px），默认 640。 */
  maxWidth?: number;
}

/** clamp 到 [min, max]。 */
function clampWidth(w: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, w));
}

/** 宽度读入：非法/越界值回退默认（clamp 防手改 localStorage 打爆布局）。 */
function loadWidth(opts: Required<PanelWidthOptions>): number {
  if (typeof window === "undefined") return opts.defaultWidth;
  try {
    const raw = Number.parseInt(window.localStorage.getItem(opts.storageKey) ?? "", 10);
    return Number.isFinite(raw) ? clampWidth(raw, opts.minWidth, opts.maxWidth) : opts.defaultWidth;
  } catch {
    return opts.defaultWidth;
  }
}

/** 左栏（树）宽度状态 + localStorage 记忆。返回 [宽度, 设宽回调]。 */
export function usePanelWidth(options: PanelWidthOptions): [number, (_w: number) => void] {
  const opts = useRef<Required<PanelWidthOptions>>({
    minWidth: 200,
    maxWidth: 640,
    ...options,
  });
  const [width, setWidth] = useState(() => loadWidth(opts.current));

  /** 宽度变更统一入口（拖拽 move / 双击复位 / 方向键微调）：改状态 + 落 localStorage。 */
  const changeWidth = (next: number) => {
    const o = opts.current;
    const clamped = clampWidth(next, o.minWidth, o.maxWidth);
    setWidth(clamped);
    try {
      window.localStorage.setItem(o.storageKey, String(clamped));
    } catch {
      // 隐私模式等 localStorage 不可用时静默降级：宽度仅本次会话内生效
    }
  };

  return [width, changeWidth];
}

/** 夹持把手：左右拖调宽、双击复位默认、←/→ 键微调。
 *  width/onWidthChange 一般接 usePanelWidth 的返回值。 */
export function PanelResizer({
  width,
  onWidthChange,
  defaultWidth,
  minWidth = 200,
  maxWidth = 640,
  ariaLabel,
  testId,
}: {
  width: number;
  onWidthChange: (_w: number) => void;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  /** 无障碍标签（如「调整文件树宽度」），必填。 */
  ariaLabel: string;
  /** 测试定位 testid。 */
  testId?: string;
}) {
  /** 拖拽中锚点 {按下时指针 x, 按下时栏宽}；null = 未在拖拽。 */
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  /** 最新回调（effect 空依赖时取闭包外的最新值）。 */
  const onChangeRef = useRef(onWidthChange);
  useEffect(() => {
    onChangeRef.current = onWidthChange;
  }, [onWidthChange]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      onChangeRef.current(clampWidth(st.startW + e.clientX - st.startX, minWidth, maxWidth));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 监听只挂一次；min/max 经闭包捕获初始值，拖拽期不变
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      data-testid={testId}
      tabIndex={0}
      className="w-1.5 shrink-0 cursor-col-resize rounded bg-transparent transition-colors hover:bg-border focus-visible:bg-border"
      onPointerDown={(e) => {
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startW: width };
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => onWidthChange(defaultWidth)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onWidthChange(clampWidth(width - KEYBOARD_STEP_PX, minWidth, maxWidth));
        else if (e.key === "ArrowRight") onWidthChange(clampWidth(width + KEYBOARD_STEP_PX, minWidth, maxWidth));
      }}
    />
  );
}
