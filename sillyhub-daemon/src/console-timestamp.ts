/**
 * console-timestamp.ts —— daemon 长驻进程 console 输出时间戳包装。
 *
 * 背景（2026-09-08 temp 投毒排障实证）：daemon.log 行无时间戳（`[daemon.<event>]
 * key=value`），排障只能靠事件计数反推时间线（"nonzero_exit 涨了没"），跨小时的
 * 时间定位非常费劲。daemon 侧输出有两类来源——createLogger（`[daemon.*]` 主格式）
 * 与散布在 spec-sync / task-runner / interactive 等模块的 100+ 处裸 console——逐点
 * 改格式不现实，故在 Daemon.start() 长驻入口对 console 五通道（log/info/warn/
 * error/debug）做一次幂等包装：输出前缀本地时间戳 `[YYYY-MM-DD HH:mm:ss.SSS]`。
 *
 * 刻意约束：
 * - 本地时区而非 ISO UTC——日志读者在本机，UTC 强迫心算 +8 偏移；
 * - 只在 Daemon.start() 安装：CLI 一次性子命令（autostart enable / status 等）
 *   的 UX 输出不加时间戳；测试直调 _sendHeartbeatOnce 等私有方法不经 start()，
 *   既有测试对 console 的 spy/断言零扰动（spy 替换在包装之后，记录的仍是调用点
 *   原始实参）；
 * - 子进程（agent / mcp-server）stdout 各走各的进程，不经本包装，保持原样；
 * - 幂等：重复 install 零效果（console 引用不变），防 start() 多次进入叠加前缀。
 *
 * @module console-timestamp
 */

/** 包装标记挂在 console 对象上（进程内唯一）。 */
const WRAP_FLAG = '__consoleTsWrapped';

/** 本地时间戳格式化：`YYYY-MM-DD HH:mm:ss.SSS`（零填充，本地时区）。 */
export function logTimestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

/**
 * 安装 console 时间戳包装（幂等）。已安装时直接返回，console 各通道引用不变。
 * 包 log/info/warn/error/debug 五通道——debug 是**独立属性**指向 log 的同一底层
 * 函数（Node 运行时 `console.debug === console.log` 为引用相等），只包 log 属性
 * 时 debug 调用仍握着原始函数引用，完全绕过包装（ql-20260911-005 实证：zcode
 * SQLite 回落日志走 console.debug，排障时既无时间戳也不进 daemon.log，定位
 * 靠反编译 bundle 才抓到）；trace/dir/table 等冷门通道仍不动，避免过度侵入。
 */
export function installConsoleTimestamps(): void {
  const flagged = console as unknown as Record<string, unknown>;
  if (flagged[WRAP_FLAG] === true) return;
  flagged[WRAP_FLAG] = true;
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = console[m].bind(console);
    console[m] = ((...args: unknown[]) => {
      orig(`[${logTimestamp()}]`, ...args);
    }) as typeof console[typeof m];
  }
}
