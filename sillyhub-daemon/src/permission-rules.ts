/**
 * CC（claude-code）permission rules 生成器 —— 按 allowed_roots 构建写入沙箱。
 *
 * 2026-06-29-runtime-allowed-roots-config task-05：
 * - 读自由（Read/Grep/Bash 等不配 deny）
 * - 写受限（Write/Edit 白名单内 allow、白名单外 deny）
 *
 * 生成 CC `--settings` JSON 的 `permissions` 部分。CC permission 优先级：
 * allow（具体路径）覆盖 deny（通配 `**`）。
 *
 * @module permission-rules
 */

import { homedir } from 'node:os';

/** 受限的写入工具（CC 文件修改类工具）。 */
const WRITE_TOOLS = ['Write', 'Edit'] as const;

/**
 * 展开 `~` 为 homedir，规范化路径（统一正斜杠）。
 * daemon 侧的 `~/.sillyhub` 占位在此展开为实际 homedir 路径。
 */
function expandRoot(root: string): string {
  const expanded = root.replace(/^~(?=$|[/\\])/, homedir());
  // 统一正斜杠（CC permission 路径模式用 / 分隔）
  return expanded.replace(/\\/g, '/');
}

/**
 * 按 allowed_roots 生成 CC permission rules（读自由 + 写白名单）。
 *
 * @param allowedRoots daemon 本地 config.allowed_roots（含 homedir 兜底）
 * @returns `{allow, deny}` — CC settings permissions 部分
 *
 * 语义：
 * - allow: 每个白名单 root × 每个写工具（`Write(root/**)` + `Write(root)`）
 * - deny: 写工具通配（`Write(**)`），allow 具体路径覆盖
 * - 读工具不配（读自由）
 */
export function buildWritePermissionRules(allowedRoots: string[]): {
  allow: string[];
  deny: string[];
} {
  const roots = [...new Set(allowedRoots.map(expandRoot))];
  const allow: string[] = [];
  for (const root of roots) {
    for (const tool of WRITE_TOOLS) {
      allow.push(`${tool}(${root}/**)`);
      allow.push(`${tool}(${root})`);
    }
  }
  const deny: string[] = WRITE_TOOLS.map((t) => `${t}(**)`);
  return { allow, deny };
}

/**
 * 生成 CC `--settings` JSON 字符串（permissions allow/deny）。
 *
 * daemon 启动 CC 时传 `--settings '<json>'`，CC 加载该 permissions 配置。
 */
export function buildCcSettingsJson(allowedRoots: string[]): string {
  const { allow, deny } = buildWritePermissionRules(allowedRoots);
  return JSON.stringify({ permissions: { allow, deny } });
}
