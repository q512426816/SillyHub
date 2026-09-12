/**
 * 原子写原语——per-session 供应商配置写盘的事务性基座（D-003@v1）。
 *
 * 语义：写 `<path>.tmp-<pid>-<rand>` → fsync → rename 顶替。任一观察时刻
 * 目标文件要么旧全文要么新全文；进程崩溃最坏残留 tmp（本函数失败路径
 * best-effort 清理，且 tmp 名带随机段、残留不挡后续写入）。rename 在 POSIX
 * 原子；Windows 走 MoveFileEx(REPLACE_EXISTING)，对已存在目标同样顶替
 * （win32 顶替语义由 tests/atomic-write.test.ts 本机锁定）。
 *
 * 适用边界（design 划界）：配置文件写入（auth.json/config.toml/models.json/
 * settings.json/宿主镜像拷贝）；数据搬运（如 rollout thread 拷贝）不适用——
 * 截断只损单条副本且源可重拷，幂等重试可恢复。
 */

import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';

export async function writeFileAtomic(
  path: string,
  data: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<void> {
  const tmpPath = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    const handle = await open(tmpPath, 'w');
    try {
      await handle.writeFile(data, encoding);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, path);
  } catch (e) {
    try {
      await unlink(tmpPath);
    } catch {
      /* best-effort 清理：tmp 可能从未建成（open 即败）或已被并发清走 */
    }
    throw e;
  }
}
