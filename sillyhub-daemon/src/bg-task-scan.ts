/**
 * `bg-task-scan.ts` —— 后台任务终态扫描环的纯函数件（2026-10-28-bg-scan-
 * tailread-eviction）。
 *
 * 从 daemon.ts `_bgTaskFinalLoop` 抽出的两个可单测原语：
 * - `readFileTailBytes`：open + 按偏移 read 的尾窗读取——只把文件末尾至多
 *   tailBytes 字节读进内存（对齐 agent-log/liveness/tailer.ts
 *   DefaultFs.readRangeAsync 既有实践；修 readFile 全量读入再 subarray 切片
 *   的内存峰值面）；
 * - `evictUnseenSnapshotPaths`：终态快照表按本轮可见 logPath 集淘汰——内层
 *   非空也可淘汰（修「只删空内层 Map」的空操作清理，消除只增不减）。
 *
 * @module
 */

/**
 * 读取文件末尾至多 `tailBytes` 字节（utf-8 文本）；文件小于窗口时整读。
 *
 * 失败（文件缺失/IO 错误）抛出——由调用方（扫描环）既有 catch→continue
 * 兜住，语义与旧 readFile 实现一致。句柄 try/finally 关闭。尾部截断可能切在
 * 多字节 UTF-8 序列中间（与旧 subarray 切片同等语义，容忍）。
 */
export async function readFileTailBytes(
  logPath: string,
  tailBytes: number,
): Promise<string> {
  const { open } = await import('node:fs/promises');
  const fh = await open(logPath, 'r');
  try {
    const size = (await fh.stat()).size;
    const start = Math.max(0, size - tailBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/**
 * 快照表按本轮可见集淘汰：删除 `seenPaths` 之外的所有键（含内层非空者），
 * 返回淘汰条数（供 debug 观测）。仍在可见集内的条目原样保留——幂等基线
 * 不丢，首扫/同值跳过语义不受影响。
 */
export function evictUnseenSnapshotPaths(
  snapshots: Map<string, Map<string, string>>,
  seenPaths: ReadonlySet<string>,
): number {
  let evicted = 0;
  for (const path of snapshots.keys()) {
    if (!seenPaths.has(path)) {
      snapshots.delete(path);
      evicted += 1;
    }
  }
  return evicted;
}
