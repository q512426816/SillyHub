"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * 会话页悬浮 pill 停靠组（2026-10-16-session-pill-dock-drag）。
 *
 * 待决策 / 变更文件两个 pill 的公共悬浮外壳（用户需求：合成一组竖排、
 * 点击展开、整组可拖动 + 吸附边界；贴边不超出聊天时间线容器范围）：
 * - 竖向排列成组 portal 到 body，fixed 定位不受面板祖先 overflow /
 *   transform 裁剪影响；组内对齐跟随吸附侧（贴左 items-start / 贴右
 *   items-end，与吸附 x 由同一判据产生，2026-10-20-pill-dock-left-align）；
 * - 按住整组在 boundsSelector 指定的边界容器（聊天时间线
 *   turn-timeline-scroll；缺省回落整个视口）范围内拖动——move/up 挂
 *   window 不依赖 pointer capture（jsdom 无实现，同款先例
 *   floating-session-host 悬浮球）；位移 < 阈值视为点击放行，拖拽结束
 *   后 250ms 内残余 click 吞掉，pill 自身点击（antd Popover click 触发）
 *   不受影响；
 * - 松手自动吸附较近的边界容器左右边缘（纵向钳回容器内）；位置
 *   localStorage 持久化（刷新不丢，损坏数据静默回落默认右下位）；
 * - children 全为 null（两 pill 空数据各自渲染 null）时 empty:hidden
 *   整组不占位、不拦点击（对齐 pill 自身 FR 显隐契约）。
 */
/** 判定「拖拽」而非「点击」的位移阈值（px，同悬浮球 DRAG_THRESHOLD）。 */
const DRAG_THRESHOLD = 6;
/** 吸附后与边界左右/下缘留白（px）。 */
const EDGE_GAP = 16;
/** 视口兜底模式的默认位距视口底部留白（px，对齐原 bottom-20 悬浮行）。 */
const DEFAULT_BOTTOM_GAP = 96;
/** 拖拽结束后残余 click 的吞除时间窗（ms，同悬浮球先例：比布尔位稳——
    拖出元素外松手时 click 不触发，布尔位会误吞下一次真点击）。 */
const CLICK_SWALLOW_MS = 250;
/** 位置持久化键（sillyhub: 前缀同悬浮球）。 */
const DOCK_STORAGE_KEY = "sillyhub:session-pill-dock";

/** 停靠组左上角视口坐标（px）；left = 吸附侧标记（true 贴左 → items-start，
    false 贴右 → items-end），由 snapPos 与吸附 x 同判据产生，不入持久化档。 */
type DockPos = { x: number; y: number; left?: boolean };

/** 拖拽/吸附边界矩形（视口坐标）。 */
interface DockBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function viewportBounds(): DockBounds {
  return {
    left: 0,
    top: 0,
    right: typeof window === "undefined" ? 1024 : window.innerWidth,
    bottom: typeof window === "undefined" ? 768 : window.innerHeight,
  };
}

/** 钳制组左上角使整组留在边界内（w/h 为组实际尺寸）。透传 p.left——
    拖拽中间态继承最近吸附态的侧别标记，渲染保持拖拽前对齐方向，松手
    snapPos 重判覆盖。 */
function clampPos(p: DockPos, w: number, h: number, b: DockBounds): DockPos {
  return {
    x: Math.min(Math.max(p.x, b.left), Math.max(b.left, b.right - w)),
    y: Math.min(Math.max(p.y, b.top), Math.max(b.top, b.bottom - h)),
    left: p.left,
  };
}

/** 松手吸附：贴较近的边界左右边缘（留 EDGE_GAP），纵向只钳回边界内。幂等——
    存档值本就是吸附态，重放不漂移；left（吸附侧标记）与 x 由同一判据同时
    产生，供渲染按侧切换对齐。 */
function snapPos(p: DockPos, w: number, h: number, b: DockBounds): DockPos {
  const c = clampPos(p, w, h, b);
  const midX = (b.left + b.right) / 2;
  const left = c.x + w / 2 <= midX;
  const x = left ? b.left + EDGE_GAP : Math.max(b.left, b.right - w - EDGE_GAP);
  return { x, y: c.y, left };
}

/** 悬浮 pill 停靠组：竖排 + 可拖拽 + 边界吸附 + 位置持久化。 */
export function SessionFloatingPillDock({
  children,
  boundsSelector,
}: {
  children: ReactNode;
  /**
   * 拖拽/吸附的边界容器选择器（会话页传聊天时间线
   * [data-testid="turn-timeline-scroll"]，贴边不越过聊天区）。缺省 = 整个
   * 视口；元素未挂载/零尺寸时逐次回落视口（不缓存，元素后挂也自愈）。
   */
  boundsSelector?: string;
}) {
  const [pos, setPos] = useState<DockPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    /** 拖拽起点吸附侧标记——拖拽中间态继承它保持对齐方向，松手 snapPos 重判。 */
    left?: boolean;
    moved: boolean;
  } | null>(null);
  /** 拖拽松手时刻（click 吞除时间窗）。 */
  const lastDragEndRef = useRef(0);
  /** 有无存档位（无存档首帧按实际尺寸落默认右下位，见 settle）。 */
  const hadStoredPosRef = useRef(false);

  /** 每次取数现查边界元素（元素尺寸/位置随布局变化，不缓存）。 */
  const getBounds = useCallback((): DockBounds => {
    if (boundsSelector && typeof document !== "undefined") {
      const r = document.querySelector(boundsSelector)?.getBoundingClientRect();
      if (r && (r.width > 0 || r.height > 0)) {
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
    }
    return viewportBounds();
  }, [boundsSelector]);

  /** 视口兜底模式默认位距底留白更大（聊天区模式的底部即输入条上缘，
      视口模式的底部是窗口底缘，需避让输入条）。 */
  const defaultBottomGap = boundsSelector ? EDGE_GAP : DEFAULT_BOTTOM_GAP;

  const persist = useCallback((p: DockPos) => {
    hadStoredPosRef.current = true;
    try {
      // 存档只写 x/y（left 由吸附判据从坐标幂等重推导，入档属冗余状态）
      window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify({ x: p.x, y: p.y }));
    } catch {
      // 隐私模式写失败不影响功能
    }
  }, []);

  /** 按组实际尺寸收敛：吸附侧 + 钳边界内；无存档首帧默认位距底留白按实际
      高度算（0 尺寸算的 y 会把组压到边界底缘，旧 UI 悬浮行在输入条上方）。 */
  const settle = useCallback(
    (p: DockPos, w: number, h: number): DockPos => {
      const b = getBounds();
      const snapped = snapPos(p, w, h, b);
      if (!hadStoredPosRef.current) {
        snapped.y = Math.max(b.top, b.bottom - h - defaultBottomGap);
      }
      return snapped;
    },
    [getBounds, defaultBottomGap],
  );

  /** 组实际尺寸（jsdom 恒 0×0；未挂载/empty:hidden 时也退化 0 安全）。 */
  const dockSize = () => {
    const rect = dockRef.current?.getBoundingClientRect();
    return { w: rect?.width ?? 0, h: rect?.height ?? 0 };
  };

  // 挂载后读持久化位置（effect 而非初值：SSR/水合一致，同悬浮球先例）；
  // 无存档回落默认右下角（0 尺寸近似值，首帧挂 ref 后 settle 修正）。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Partial<DockPos>;
        if (typeof v.x === "number" && typeof v.y === "number") {
          hadStoredPosRef.current = true;
          // 存档位走 snapPos（幂等，x/y 不变）当场补吸附侧标记，恢复首帧
          // 对齐方向即正确，不依赖后续 settle 收敛补写。
          setPos(snapPos({ x: v.x, y: v.y }, 0, 0, getBounds()));
          return;
        }
      }
    } catch {
      // 损坏数据静默丢弃，回落默认右下角
    }
    const b = getBounds();
    setPos({ x: b.right - EDGE_GAP, y: b.bottom - defaultBottomGap, left: false });
  }, [getBounds, defaultBottomGap]);

  // 首帧挂 ref 后按组实际尺寸收敛（初始/存档位按 0 尺寸计算会溢出右缘；
  // snap 幂等，收敛一次即稳定，拖拽中不打架）。比较含 left：旧档/中间态
  // 缺标记时补写对齐侧。
  useEffect(() => {
    if (!pos || dragging) return;
    const { w, h } = dockSize();
    const settled = settle(pos, w, h);
    if (settled.x !== pos.x || settled.y !== pos.y || settled.left !== pos.left)
      setPos(settled);
  }, [pos, dragging, settle]);

  // 组尺寸与边界容器尺寸变化（pill 显隐 / 侧栏开合收窄聊天区）都重收敛，
  // 防溢出——jsdom 无 ResizeObserver，由上面 [pos,dragging] effect 兜底。
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
    if (boundsSelector && typeof document !== "undefined") {
      const boundsEl = document.querySelector(boundsSelector);
      if (boundsEl) ro.observe(boundsEl);
    }
    return () => ro.disconnect();
  }, [dockMounted, settle, boundsSelector]);

  // 视口缩放：钳回边界内并保持吸附侧（右侧停靠的边界变宽不悬空）。
  useEffect(() => {
    const onResize = () => {
      const { w, h } = dockSize();
      const b = getBounds();
      setPos((p) => (p ? snapPos(p, w, h, b) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [getBounds]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    const { w, h } = dockSize();
    setPos(clampPos({ x: d.baseX + dx, y: d.baseY + dy, left: d.left }, w, h, getBounds()));
  }, [getBounds]);

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
        const snapped = snapPos(p ?? { x: d.baseX, y: d.baseY }, w, h, getBounds());
        persist(snapped);
        return snapped;
      });
    },
    [onPointerMove, getBounds, persist],
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
        left: pos.left,
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
        "fixed z-40 flex select-none flex-col gap-2 print:hidden empty:hidden",
        pos.left ? "items-start" : "items-end",
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
