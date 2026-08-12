/**
 * local-yaml-writer.ts — 文本级 YAML 顶层段替换工具
 *
 * 复制 sillyspec 仓 sync.js 的段替换算法，用 TS 重写。
 * 注释标注来源行号：findTopLevelSectionRange (81), replaceTopLevelSection (109), writeLocalYamlRaw (132)。
 *
 * 导出契约（design §7.3）：
 * - findTopLevelSectionRange(text, key): {start, end} | null
 * - replaceTopLevelSection(text, key, entries: string | null): string
 * - writeLocalYaml(rootPath, local, serverOrigin): Promise<void>
 */

import { promises as fs } from 'fs';
import { join } from 'path';

/** 段范围（半开区间 [start, end)） */
interface SectionRange {
  start: number;
  end: number;
}

/**
 * 定位顶层 YAML 段（如 platform:/mcp:）的行范围 [start, end)。
 * 来源：sillyspec/src/sync.js:81-99
 *
 * 段 = key 行（行首非空白 + 以 'name:' 开头）+ 后续连续缩进行（以空格/tab 开头）。
 * 遇空行/注释/下一个顶层 key 即段结束——这些行不属于本段，保留不动。
 *
 * split('\n')/join('\n') 操作：CRLF 下 '\r' 留在行尾，重组原样还原（Windows 兼容）。
 *
 * @param text - 原始文件文本
 * @param key - 段名（不含冒号，如 'platform'）
 * @returns 半开区间 {start, end}，不存在返回 null
 */
export function findTopLevelSectionRange(text: string, key: string): SectionRange | null {
  const lines = text.split('\n');
  const prefix = `${key}:`;
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue; // 跳过空行（split 不会产生 undefined，但 TS 认为可能）
    // 顶层 key 行：行首非空白（排除缩进子段）+ 以 'key:' 开头
    if (/^\S/.test(line) && line.startsWith(prefix)) {
      start = i;
      break;
    }
  }

  if (start === -1) return null;

  let end = start + 1;
  while (end < lines.length && /^[ \t]/.test(lines[end]!)) {
    end++;
  }

  return { start, end };
}

/**
 * 文本级定向替换/删除/追加一个顶层 YAML 段，保留文件其余所有字节
 * （注释/空行/其他段/数组/深嵌套/CRLF 全保留）。
 * 来源：sillyspec/src/sync.js:109-129
 *
 * @param text - 原始文件文本
 * @param key - 段名（不含冒号）
 * @param entries - 段体（不含 key 行）；null=删除该段；string=替换或追加
 * @returns 新文本
 */
export function replaceTopLevelSection(text: string, key: string, entries: string | null): string {
  const lines = text.split('\n');
  const range = findTopLevelSectionRange(text, key);

  if (range) {
    // 段存在
    const before = lines.slice(0, range.start);
    const after = lines.slice(range.end);

    if (entries === null) {
      // 删除段：保留 before + after，中间去掉
      return [...before, ...after].join('\n');
    }

    // 替换段：key 行 + 新内容
    const sectionLines = [`${key}:`, ...entries.split('\n')];
    return [...before, ...sectionLines, ...after].join('\n');
  }

  // 段不存在
  if (entries === null) {
    // 删不存在的段，原样返回
    return text;
  }

  // 追加：去尾换行后加空行分隔 + 新段；空文件直接起段
  const stripped = text.replace(/(\r?\n)+$/, '');
  if (stripped === '') {
    return `${key}:\n${entries}\n`;
  }

  return `${stripped}\n\n${key}:\n${entries}\n`;
}

/**
 * 文本级写 local.yaml（确保 .sillyspec 目录存在）。
 * 来源：sillyspec/src/sync.js:132-136
 *
 * @param rootPath - 项目根目录
 * @param text - 要写入的文件文本
 */
async function writeLocalYamlRaw(rootPath: string, text: string): Promise<void> {
  const dir = join(rootPath, '.sillyspec');

  // 确保 .sillyspec 目录存在（不存在则递归创建）
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // mkdir 失败（如权限问题）直接抛错，让 writeFileSync 暴露
  }

  await fs.writeFile(join(rootPath, '.sillyspec', 'local.yaml'), text, 'utf8');
}

/**
 * 写 local.yaml 的 platform 和 mcp 段（init 下发用）。
 * 导出契约：design §7.3，为 task-06 handleInitLease 调用。
 *
 * 行为（对齐 design §5.4 + D-004）：
 * - platform 段：无条件覆盖（url=serverOrigin, token=platform_token）
 * - mcp 段：仅不存在时写入（url=serverOrigin+'/mcp', token=mcp_token）
 * - 文件不存在：创建含两段 + 最小注释
 * - 失败抛错（让 handleInitLease 第4步 catch 转成 ok:false → lease failed）
 *
 * @param rootPath - 项目根目录
 * @param local - { platform_token: string, mcp_token: string }
 * @param serverOrigin - 服务器地址（daemon._serverOrigin() 拼的值）
 */
export async function writeLocalYaml(
  rootPath: string,
  local: { platform_token: string; mcp_token: string },
  serverOrigin: string,
): Promise<void> {
  const localYamlPath = join(rootPath, '.sillyspec', 'local.yaml');

  // 读原文（不存在则空串）
  let text: string;
  try {
    text = await fs.readFile(localYamlPath, 'utf8');
  } catch {
    text = '';
  }

  // platform 段：无条件覆盖
  const platformUrl = serverOrigin.replace(/\/+$/, '');
  const platformEntries = `  url: ${platformUrl}\n  token: ${local.platform_token}`;
  text = replaceTopLevelSection(text, 'platform', platformEntries);

  // mcp 段：仅不存在时写入（D-004：有才留）
  const mcpRange = findTopLevelSectionRange(text, 'mcp');
  if (mcpRange === null) {
    const mcpUrl = `${platformUrl}/mcp`;
    const mcpEntries = `  url: ${mcpUrl}\n  token: ${local.mcp_token}`;
    text = replaceTopLevelSection(text, 'mcp', mcpEntries);
  }

  // 写盘（确保 .sillyspec 目录 + 写入）
  await writeLocalYamlRaw(rootPath, text);
}
