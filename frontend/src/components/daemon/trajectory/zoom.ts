/**
 * 轨迹时间轴「视野」（view window）的纯函数 —— 滚轮缩放 / 拖拽平移 / 刻度推导。
 *
 * 为什么单独一个文件：这些数学是**可测的纯逻辑**（无 DOM、无 React、无时间源），
 * 与渲染解耦后才能在 node 环境逐条断言（见 ./__tests__/zoom.test.ts）。
 * `trajectory-timeline.tsx` 只负责把指针坐标换成 `ratio`，再把 `ratio` 交给这里。
 *
 * 坐标系约定（与渲染端一致）：
 *   - `limits` = 整窗 `[windowStart, windowEnd]`，是缩放的**上界**也是平移的**边界**；
 *   - `view`    = 当前视野 `[start, end]`，恒满足 `limits.start <= start < end <= limits.end`；
 *   - 时间轴比值 `ratio = (at - view.start) / (view.end - view.start)`，渲染端
 *     `left% = ratio * 100`。所有换算都只依赖这两个式子，没有第二套坐标。
 *
 * 钳制规则：
 *   - 视野跨度 ∈ [`MIN_VIEW_SPAN_MS`, 整窗跨度]；整窗本身短于 1 分钟时下界退化为整窗
 *     （不允许缩放到比数据还宽）。
 *   - 缩放围绕**指针时间锚点**：锚点在视野内的比例保持不变，因此放大时指针下的
 *     那一刻仍停在指针下（边界处因钳制会滑动，这是预期）。
 *   - 平移只挪起点，跨度不变；越界钳到 `[limits.start, limits.end - span]`。
 */

/** 视野（epoch ms，左闭右开语义但按闭区间渲染）。 */
export interface ViewWindow {
  start: number;
  end: number;
}

/** 可缩放/平移的整窗边界（= `trajectory.windowStart/windowEnd`）。 */
export interface ViewLimits {
  start: number;
  end: number;
}

/** 最近可缩放到 1 分钟；更窄的视野在 856 行的真实数据上没有可读性。 */
export const MIN_VIEW_SPAN_MS = 60_000;

/** 每档滚轮的缩放倍率：>1 表示「一档放大 1.15 倍」。 */
export const ZOOM_STEP = 1.15;

/** 命中带宽度（px）：条本身可能只有 2px，点击目标按 6px 计。 */
export const HIT_BAND_PX = 6;

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** 视野跨度（ms，≥0）。 */
export function viewSpan(view: ViewWindow): number {
  const span = view.end - view.start;
  return Number.isFinite(span) && span > 0 ? span : 0;
}

/** 整窗跨度（ms，≥0）。 */
export function fullWindowSpan(limits: ViewLimits): number {
  const span = limits.end - limits.start;
  return Number.isFinite(span) && span > 0 ? span : 0;
}

/** 视野可用的跨度区间 `[min, max]`；整窗退化时两者相等。 */
export function viewSpanBounds(
  limits: ViewLimits,
  minSpan: number = MIN_VIEW_SPAN_MS,
): { min: number; max: number } {
  const max = fullWindowSpan(limits);
  const min = Math.min(Math.max(1, minSpan), Math.max(1, max));
  return { min, max: Math.max(min, max) };
}

/**
 * 把任意视野夹紧到 `limits` 与跨度区间内（不缩放、不平移，只修正非法值）。
 * 空/非法视野按整窗处理。
 */
export function clampView(
  view: ViewWindow,
  limits: ViewLimits,
  minSpan: number = MIN_VIEW_SPAN_MS,
): ViewWindow {
  const max = fullWindowSpan(limits);
  if (max <= 0) return { start: limits.start, end: limits.start };
  const bounds = viewSpanBounds(limits, minSpan);
  const span = clamp(viewSpan(view) || max, bounds.min, bounds.max);
  const start = clamp(view.start, limits.start, limits.end - span);
  return { start, end: start + span };
}

/**
 * 围绕 `anchorTime` 缩放：`factor > 1` 放大（跨度变小），`factor < 1` 缩小。
 * 锚点在视野里的比例在缩放前后保持一致（被钳制时才滑动）。
 */
export function zoomAt(
  view: ViewWindow,
  anchorTime: number,
  factor: number,
  limits: ViewLimits,
  minSpan: number = MIN_VIEW_SPAN_MS,
): ViewWindow {
  const max = fullWindowSpan(limits);
  if (max <= 0) return { start: limits.start, end: limits.start };
  const bounds = viewSpanBounds(limits, minSpan);
  const span = clamp(viewSpan(view) || bounds.max, bounds.min, bounds.max);
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const nextSpan = clamp(span / safeFactor, bounds.min, bounds.max);
  const ratio = span > 0 ? clamp01((anchorTime - view.start) / span) : 0.5;
  const anchor = Number.isFinite(anchorTime) ? anchorTime : view.start + span * ratio;
  const nextStart = anchor - ratio * nextSpan;
  return clampView({ start: nextStart, end: nextStart + nextSpan }, limits, minSpan);
}

/**
 * 平移视图：正 delta 向未来（右）移，负值向过去（左）移；跨度不变。
 * 越界只把起点钳到边界，不改变跨度。
 */
export function panView(
  view: ViewWindow,
  deltaMs: number,
  limits: ViewLimits,
  minSpan: number = MIN_VIEW_SPAN_MS,
): ViewWindow {
  const max = fullWindowSpan(limits);
  if (max <= 0) return { start: limits.start, end: limits.start };
  const bounds = viewSpanBounds(limits, minSpan);
  const span = clamp(viewSpan(view) || bounds.max, bounds.min, bounds.max);
  const delta = Number.isFinite(deltaMs) ? deltaMs : 0;
  const start = clamp(view.start + delta, limits.start, limits.end - span);
  return { start, end: start + span };
}

/** `ratio`（0–1）→ 绝对时间。 */
export function timeAtRatio(view: ViewWindow, ratio: number): number {
  return view.start + clamp01(ratio) * viewSpan(view);
}

/** 绝对时间 → `ratio`（0–1，视野外夹到边界）。 */
export function ratioAtTime(view: ViewWindow, at: number): number {
  const span = viewSpan(view);
  if (span <= 0) return 0;
  return clamp01((at - view.start) / span);
}

/**
 * 等距刻度时刻：`count` 个点（含两端），首个 = `viewStart`、末个 = `viewEnd`。
 * 视野退化（span ≤ 0）时返回 `count` 个相同的时刻。
 *
 * 拼写说明：规格把它写作 `tickTicks`，此处以 `tickTimes` 为主名（语义更准），
 * 末尾保留 `tickTicks` 别名以免调用面漂移。
 */
export function tickTimes(viewStart: number, viewEnd: number, count: number): number[] {
  const total = Math.max(2, Math.trunc(Number.isFinite(count) ? count : 2));
  const span = viewEnd - viewStart;
  if (!(span > 0)) {
    return Array.from({ length: total }, () => viewStart);
  }
  return Array.from({ length: total }, (_, index) => viewStart + (span * index) / (total - 1));
}

/** 规格拼写别名（见上）。 */
export const tickTicks = tickTimes;

/** 刻度对象：时刻 + 在视野里的比例（渲染端直接 `ratio * 100` 当 left%）。 */
export function axisTicks(
  viewStart: number,
  viewEnd: number,
  count: number,
): Array<{ at: number; ratio: number }> {
  const span = viewEnd - viewStart;
  return tickTimes(viewStart, viewEnd, count).map((at) => ({
    at,
    ratio: span > 0 ? clamp01((at - viewStart) / span) : 0,
  }));
}

/** 已换算成像素区间的条（命中判定用）。 */
export interface SpanBand<T> {
  span: T;
  /** 条左边缘（px，可为负 = 视野外）。 */
  leftPx: number;
  /** 条右边缘（px）；与 leftPx 相等表示零宽事件。 */
  rightPx: number;
}

/**
 * 命中判定：在指针 `x` 处挑一根条。
 *
 * 规则（与「2px 条也可点」+「重叠时取中心最近」两条要求对应）：
 *   1. 候选 = 渲染区间按 `tolerancePx`（默认 3px，即 6px 命中带）向外扩后覆盖 `x` 的条；
 *   2. 先取**真正压在指针下**的候选（宽条整段可点），其中中心离 `x` 最近者胜；
 *   3. 没有压住的，再取扩展带内的候选，同样中心最近者胜；
 *   4. 都没有 → null（点空白不选中）。
 *
 * 复杂度 O(n) 且只在点击/按下时跑一次（415 根 tool 条也就几微秒），
 * 因此不需要为每根条生成 6px 的隐藏兄弟节点。
 */
export function pickSpanAt<T>(
  bands: SpanBand<T>[],
  x: number,
  tolerancePx: number = HIT_BAND_PX / 2,
): T | null {
  const tolerance = Math.max(0, Number.isFinite(tolerancePx) ? tolerancePx : 0);
  let inside: { item: T; distance: number } | null = null;
  let near: { item: T; distance: number } | null = null;

  for (const band of bands) {
    const low = Math.min(band.leftPx, band.rightPx);
    const high = Math.max(band.leftPx, band.rightPx);
    if (x < low - tolerance || x > high + tolerance) continue;
    const distance = Math.abs((low + high) / 2 - x);
    if (x >= low && x <= high) {
      if (!inside || distance < inside.distance) inside = { item: band.span, distance };
    } else if (!near || distance < near.distance) {
      near = { item: band.span, distance };
    }
  }

  return (inside ?? near)?.item ?? null;
}

/* ───────────────────────── 刻度 / 范围文案 ─────────────────────────
 *
 * 这两条文案规则必须**跟着视野走**，否则缩放后会出现两种错：
 *   1. 只用 `at - windowStart` 再夹到「视野跨度」里 → 缩放后每个刻度都被夹到
 *      同一个上限，7 个刻度全显示同一个时刻（曾在 2 小时视野下复现：全 "13:29"）；
 *   2. 窄视野仍用 `HH:MM` → 7 个刻度落进同一分钟，同样看起来全一样。
 * 因此：整窗 ≥1h 用钟点（视野 <10 分钟自动补秒），短会话用相对**视野起点**的
 * `+mm:ss`；偏移量永不夹到视野跨度里（`time → label` 是纯单调映射）。
 */

const HOUR_MS = 60 * 60 * 1000;
/** 视野窄于 10 分钟时，`HH:MM` 会让多个刻度撞在同一分钟 → 补秒。 */
const SECONDS_PRECISION_BELOW_MS = 10 * 60 * 1000;

function pad2(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
}

/** 本地时区的 `HH:MM`（`withSeconds` 时 `HH:MM:SS`）。 */
export function clockLabel(at: number, withSeconds = false): string {
  const date = new Date(at);
  const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad2(date.getSeconds())}` : base;
}

/** 相对 `origin` 的 `+mm:ss`（≥1 小时时分钟位自然溢出成 `+264:40` 这种形态）。 */
export function offsetLabel(at: number, origin: number): string {
  const totalSeconds = Math.max(0, Math.round((at - origin) / 1000));
  return `+${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`;
}

/** 轴刻度文案（见上方规则）。 */
export function formatTickLabel(at: number, view: ViewWindow, fullSpanMs: number): string {
  if (fullSpanMs >= HOUR_MS) return clockLabel(at, viewSpan(view) < SECONDS_PRECISION_BELOW_MS);
  return offsetLabel(at, view.start);
}

/** hint 行的「当前视野范围」文案（同一套钟点/偏移规则）。 */
export function formatViewRangeLabel(
  view: ViewWindow,
  windowStart: number,
  fullSpanMs: number,
): string {
  if (fullSpanMs >= HOUR_MS) {
    const withSeconds = viewSpan(view) < SECONDS_PRECISION_BELOW_MS;
    return `${clockLabel(view.start, withSeconds)} – ${clockLabel(view.end, withSeconds)}`;
  }
  return `${offsetLabel(view.start, windowStart)} – ${offsetLabel(view.end, windowStart)}`;
}
