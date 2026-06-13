// tests/helpers.ts
// 测试脚手架辅助：fixture 加载。供所有 adapter 测试复用。
// task-04 只搭骨架，fixture 内容由 task-06~10 从 Python 测试 inline 样本提取落盘。

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** fixture 根目录绝对路径：tests/fixtures/ */
export const FIXTURES_DIR: string = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/**
 * 读取 fixture 文件完整文本。
 *
 * @param relativePath 相对 fixtures/ 的路径，如 "stream-json/claude-assistant-text.jsonl"
 * @returns 文件完整字符串
 * @throws Error 当文件不存在（含明确路径信息，便于排错）
 */
export function loadFixture(relativePath: string): string {
  const abs = join(FIXTURES_DIR, relativePath);
  // readFileSync 在文件不存在时抛 ENOENT，这里包一层让消息更友好
  try {
    return readFileSync(abs, 'utf-8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    throw new Error(
      `loadFixture: fixture not found: ${relativePath} (resolved: ${abs}, code: ${err.code ?? 'unknown'})`,
    );
  }
}

/**
 * 读取 fixture 文件并按行切分数组。
 *
 * - 按 \n 切分。
 * - 丢弃末尾因文件结尾换行产生的空行（保留行间合法空行）。
 *
 * @param relativePath 相对 fixtures/ 的路径
 * @returns 行数组（已去除尾部空行）
 */
export function loadLines(relativePath: string): string[] {
  const raw = loadFixture(relativePath);
  const lines = raw.split('\n');
  // 仅当末行是空串（源于文件结尾 \n）时移除
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}
