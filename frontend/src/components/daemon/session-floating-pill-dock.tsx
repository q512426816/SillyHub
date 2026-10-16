"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * 会话页悬浮 pill 停靠组（2026-10-16-session-pill-dock-drag）。
 *
 * 待决策 / 变更文件两个 pill 的公共悬浮外壳（用户需求：合成一组竖排、
 * 点击展开、整组可拖动 + 吸附边界）：
 * - 竖向排列成组（items-end 右对齐）portal 到 body，fixed 定位不受面板
 *   祖先 overflow / transform 裁剪影响；
 * - 按住整组在 viewport 范围内拖动——move/up 挂 window 不依赖 pointer
 *   capture（jsdom 无实现，同款先例 floating-session-host 悬浮球）；
 *   位移 < 阈值视为点击放行，拖拽结束后 250ms 内残余 click 吞掉，pill
 *   自身点击（antd Popover click 触发）不受影响；
 * - 松手自动吸附较近的左右边界（纵向只钳回窗内）；位置 localStorage
 *   持久化（刷新不丢，损坏数据静默回落默认右下位）；
 * - children 全为 null（两 pill 空数据各自渲染 null）时 empty:hidden
 *   整组不占位、不拦点击（对齐 pill 自身 FR 显隐契约）。
 */
/** 判定「拖拽」而非「点击」的位移阈值（px，同悬浮球 DRAG_THRESHOLD）。 */
const DRAG_THRESHOLD = 6;
/** 吸附后与视口左右边缘留白（px）。 */
const EDGE_GAP = 16;
/** 默认（无持久化）停靠位距视口底部留白（px，对齐原 bottom-20 悬浮行）。 */
const DEFAULT_BOTTOM_GAP = 96;
/** 拖拽结束后残余 click 的吞除时间窗（ms，同悬浮球先例：比布尔位稳——
    拖出元素外松手时 click 不触发，布尔位会误吞下一次真点击）。 */
const CLICK_SWALLOW_MS = 250;
/** 位置持久化键（sillyhub: 前缀同悬浮球）。 */
const DOCK_STORAGE_KEY = "sillyhub:session-pill-dock";

/** 停靠组左上角视口坐标（px）。 */
type DockPos = { x: number; y: number };

function viewport() {
  return {
    vw: typeof window === "undefined" ? 1024 : window.innerWidth,
    vh: typeof window === "undefined" ? 768 : window.innerHeight,
  };
}

/** 钳制组左上角使整组留在视口内（w/h 为组实际尺寸）。 */
function clampPos(p: DockPos, w: number, h: number): DockPos {
  const { vw, vh } = viewport();
  return {
    x: Math.min(Math.max(p.x, 0), Math.max(vw - w, 0)),
    y: Math.min(Math.max(p.y, 0), Math.max(vh - h, 0)),
  };
}

/** 松手吸附：贴较近的左右边缘（留 EDGE_GAP），纵向只钳回窗内。幂等——
    存档值本就是吸附态，重放不漂移。 */
function snapPos(p: DockPos, w: number, h: number): DockPos {
  const { vw } = viewport();
  const x =
    clampPos(p, w, h).x + w / 2 <= vw / 2 ? EDGE_GAP : Math.max(vw - w - EDGE_GAP, EDGE_GAP);
  return { x, y: clampPos(p, w, h).y };
}

/** 悬浮 pill 停靠组：竖排 + 可拖拽 + 边缘吸附 + 位置持久化。 */
export function SessionFloatingPillDock({ children }: { children: ReactNode }) {
  const [pos, setPos] = useState<DockPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);
  /** 拖拽松手时刻（click 吞除时间窗）。 */
  const lastDragEndRef = useRef(0);
  /** 有无存档位（无存档首帧按实际尺寸落默认右下位，见 settle）。 */
  const hadStoredPosRef = useRef(false);

  /** 组实际尺寸（jsdom 恒 0×0；未挂载/empty:hidden 时也退化 0 安全）。 */
  const dockSize = () => {
    const rect = dockRef.current?.getBoundingClientRect();
    return { w: rect?.width ?? 0, h: rect?.height ?? 0 };
  };

  const persist = useCallback((p: DockPos) => {
    hadStoredPosRef.current = true;
    try {
      window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(p));
    } catch {
      // 隐私模式写失败不影响功能
    }
  }, []);

  /** 按组实际尺寸收敛：吸附侧 + 钳窗内；无存档首帧默认位距底留白按实际
      高度算（0 尺寸算的 y 会把组压到视口底缘，旧 UI 悬浮行在输入条上方）。 */
  const settle = useCallback((p: DockPos, w: number, h: number): DockPos => {
    const snapped = snapPos(p, w, h);
    if (!hadStoredPosRef.current) {
      const { vh } = viewport();
      snapped.y = Math.max(vh - h - DEFAULT_BOTTOM_GAP, 0);
    }
    return snapped;
  }, []);

  // 挂载后读持久化位置（effect 而非初值：SSR/水合一致，同悬浮球先例）；
  // 无存档回落默认右下角（0 尺寸近似值，首帧挂 ref 后 settle 修正）。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<DockPos>;
        if (typeof v.x === "number" && typeof v.y === "number") {
          hadStoredPosRef.current = true;
          setPos(clampPos({ x: v.x, y: v.y }, 0, 0));
          return;
        }
      }
    } catch {
      // 损坏数据静默丢弃，回落默认右下角
    }
    const { vw, vh } = viewport();
    setPos({ x: vw - EDGE_GAP, y: vh - DEFAULT_BOTTOM_GAP });
  }, []);

  // 首帧挂 ref 后按组实际尺寸收敛（初始/存档位按 0 尺寸计算会溢出右缘；
  // snap 幂等，收敛一次即稳定，拖拽中不打架）。
  useEffect(() => {
    if (!pos || dragging) return;
    const { w, h } = dockSize();
    const settled = settle(pos, w, h);
    if (settled.x !== pos.x || settled.y !== pos.y) setPos(settled);
  }, [pos, dragging, settle]);

  // 组尺寸后续变化（pill 空数据显隐 / 数量增减）按新尺寸收敛，防止右缘
  // 溢出——jsdom 无 ResizeObserver，由上面 [pos,dragging] effect 兜底。
  const dockMounted = pos != null;
  useEffect(() => {
    if (!dockMounted || typeof ResizeObserver === "undefined") return;
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setPos((p) => (p && !dragRef.current ? settle(p, rect.width, rect.height) : p));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [dockMounted, settle]);

  // 视口缩放：钳回窗内并保持吸附侧（右侧停靠的窗口变宽不悬空）。
  useEffect(() => {
    const onResize = () => {
      const { w, h } = dockSize();
      setPos((p) => (p ? snapPos(p, w, h) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    const { w, h } = dockSize();
    setPos(clampPos({ x: d.baseX + dx, y: d.baseY + dy }, w, h));
  }, []);

  const endDrag = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      dragRef.current = null;
      setDragging(false);
      if (!d || e.pointerId !== d.pointerId || !d.moved) return;
      lastDragEndRef.current = Date.now();
      // 松手吸附较近边缘并持久化（只在拖拽结束写，拖动过程不刷 localStorage）。
      const { w, h } = dockSize();
      setPos((p) => {
        const snapped = snapPos(p ?? { x: d.baseX, y: d.baseY }, w, h);
        persist(snapped);
        return snapped;
      });
    },
    [onPointerMove, persist],
  );

  const onPointerUp = endDrag;
  const onPointerCancel = endDrag;

  const onDockPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !pos) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: pos.x,
        baseY: pos.y,
        moved: false,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    },
    [pos, onPointerMove, onPointerUp],
  );

  // 拖拽尾音吞除（捕获阶段拦在 pill 按钮的 click 之前）。
  const onDockClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastDragEndRef.current < CLICK_SWALLOW_MS) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // pos 未定（SSR/水合首帧）不渲染；createPortal 仅在客户端执行。
  if (pos == null || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={dockRef}
      data-testid="session-pill-dock"
      onPointerDown={onDockPointerDown}
      onClickCapture={onDockClickCapture}
      className={cn(
        "fixed z-40 flex select-none flex-col items-end gap-2 print:hidden empty:hidden",
        dragging ? "cursor-grabbing" : "cursor-grab",
        dragging ? "" : "transition-[left,top] duration-200 ease-out",
      )}
      style={{ left: pos.x, top: pos.y, touchAction: "none" }}
    >
      {children}
    </div>,
    document.body,
  );
}
