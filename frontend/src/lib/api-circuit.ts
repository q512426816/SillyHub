/**
 * api-circuit — API 全局熔断（ql-20260917-011）。
 *
 * 背景：部署窗口（容器 recreate）或后端劣化时，页面上的查询重试 + SSE 重连
 * 在浏览器里滚雪球，直到 ERR_INSUFFICIENT_RESOURCES（连接资源耗尽）——即使
 * 服务恢复，该页签也会恶性循环到被关闭。
 *
 * 机制（经典熔断三态）：
 * - closed（正常）：apiFetch 上报成败；连续 N 次系统性失败 → open。
 * - open（熔断）：apiFetch 对非 /api/auth/* 请求直接抛 circuit_open（不发
 *   网络，浏览器连接池不再被占用）；SSE 重连对齐冷却终点；冷却过后自动
 *   进入 half-open。
 * - half-open（半开）：放行请求探测；成功 → closed（清零计数），失败 →
 *   重新 open 计时。
 *
 * 「系统性失败」= 网络错误/超时（ApiError status=0）或 HTTP ≥500——连接层
 * 或服务层不可用；4xx（401/403/404/422…）是业务态，连接本身健康，不计入。
 *
 * 纯模块级单例（页面生命周期一份）；UI（circuit-banner）与 SSE
 * （notifications.ts）经 subscribeCircuit / snapshot 消费。
 */

// 值导入（非 type-only）：isSystemicApiFailure 的 instanceof 需要运行时构造器。
// 与 api.ts 构成 ESM 循环引用，但本模块仅在函数体内使用 ApiError（调用时
// 双方模块均已初始化完成），顶层无求值依赖，安全。
import { ApiError } from "@/lib/api";

/** 连续系统性失败阈值（达到即开闸）。 */
const FAILURE_THRESHOLD = 5;
/** 开闸冷却时长：期间所有非 auth 请求短路，期满自动半开探测。 */
const OPEN_COOLDOWN_MS = 15_000;

export interface CircuitSnapshot {
  /** 是否处于熔断（open；half-open 视为放行探测不算 open）。 */
  open: boolean;
  /** 冷却终点时间戳（ms，Date.now()）；非 open 为 null。SSE 重连对齐用。 */
  retryAt: number | null;
}

type Listener = (_snapshot: CircuitSnapshot) => void;

let consecutiveFailures = 0;
let openedAt: number | null = null;
const listeners = new Set<Listener>();

function snapshot(): CircuitSnapshot {
  const open = openedAt !== null && Date.now() - openedAt < OPEN_COOLDOWN_MS;
  return open ? { open: true, retryAt: openedAt! + OPEN_COOLDOWN_MS } : { open: false, retryAt: null };
}

function notify(): void {
  const s = snapshot();
  for (const cb of listeners) cb(s);
}

/** 系统性失败判定：网络/超时（status=0）或 5xx；4xx 业务态不算。 */
export function isSystemicApiFailure(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 0 || err.status >= 500;
}

/** apiFetch 成功路径上报：任何拿到 HTTP 响应且 <500 的请求都说明链路活着。 */
export function reportApiSuccess(): void {
  if (consecutiveFailures === 0 && openedAt === null) return;
  // 处于熔断周期（open 或冷却已过的 half-open）都算——半开探测成功也要
  // 通知关闸（横幅撤下），不能只看 snapshot().open（半开期它是 false）
  const inCircuitCycle = openedAt !== null;
  consecutiveFailures = 0;
  openedAt = null;
  if (inCircuitCycle) notify();
}

/** apiFetch 失败路径上报：仅系统性失败计数；到阈值开闸（含半开探测失败重开）。 */
export function reportApiFailure(err: unknown): void {
  if (!isSystemicApiFailure(err)) return;
  const wasOpen = snapshot().open;
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD || wasOpen) {
    openedAt = Date.now();
  }
  if (snapshot().open && !wasOpen) notify(); // 新开闸才通知（重开不重复弹）
}

/** 当前是否熔断（open）。half-open（冷却已过）返回 false 放行探测。 */
export function isCircuitOpen(): boolean {
  // 冷却已过但未清零：视为半开，放行；成功/失败上报会把它闭合/重开
  return snapshot().open;
}

/** 当前快照（SSE 重连对齐 retryAt、UI 展示用）。 */
export function circuitSnapshot(): CircuitSnapshot {
  return snapshot();
}

/** 订阅熔断状态变化（开闸/关闸各通知一次）。返回退订函数。 */
export function subscribeCircuit(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 测试辅助：重置模块状态（仅测试文件使用，业务代码禁调）。 */
export function __resetCircuitForTest(): void {
  consecutiveFailures = 0;
  openedAt = null;
  listeners.clear();
}
