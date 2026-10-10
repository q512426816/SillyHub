/**
 * 关联仓本机现状只读快照（2026-10-10-linked-repos-local-echo task-01 / FR-01 / D-005）。
 *
 * 与下行落盘例程（linked-repos-sync.ts，写链路）严格分离：本模块只读——
 * 仅 spawn 两条读命令，零写盘：
 * - `sillyspec workspace status --json`：projects/*.yaml 登记面（name/path/role/state/detail）
 * - `sillyspec config cat --spec-dir <root>`：local.yaml 定位钉住（防父目录漂移）——
 *   只提取 repos: 段（key→path）与 projects: 块（相对路径，R-01 path 兜底源），
 *   其余内容不进快照（R-02 最小面）。
 *
 * 归一：role 空串→null；path "?" / 空→null（backend 侧兜底）；fetched_at ISO。
 * 源级降级：unknown command 输出 → 该源空数组 + skipped 标注（非整体失败）。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveSillySpecBinDefault } from './sillyspec-manager.js';

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const UNKNOWN_COMMAND_RE = /unknown (?:command|subcommand)|unrecognized/i;

export interface SnapshotProjectEntry {
  name: string;
  path: string | null;
  role: string | null;
  state: string | null;
  detail: string | null;
}

export interface SnapshotRepoEntry {
  key: string;
  path: string;
}

export interface LinkedReposSnapshot {
  projects: SnapshotProjectEntry[];
  projects_skipped?: string | null;
  repos: SnapshotRepoEntry[];
  repos_skipped?: string | null;
  fetched_at: string;
}

export interface LinkedReposSnapshotDeps {
  resolveBin?: () => string | null;
  exec?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  timeoutMs?: number;
}

function nullIfBlank(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' || s === '?' ? null : s;
}

/** 解析 local.yaml 文本的 repos: 段（key→path）与 projects: 块（name→相对路径）。 */
export function parseLocalYamlSections(text: string): {
  repos: SnapshotRepoEntry[];
  projects: Array<{ name: string; path: string }>;
} {
  const repos: SnapshotRepoEntry[] = [];
  const projects: Array<{ name: string; path: string }> = [];
  const lines = String(text || '').split('\n');
  let section: 'repos' | 'projects' | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^repos:\s*(?:#.*)?$/.test(line)) {
      section = 'repos';
      continue;
    }
    if (/^projects:\s*(?:#.*)?$/.test(line)) {
      section = 'projects';
      continue;
    }
    // 顶层新键（无缩进、非注释/空行）结束段
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) {
      section = null;
      continue;
    }
    if (section === 'repos') {
      const m = line.match(/^\s+([A-Za-z0-9_.\-]+)\s*:\s*(\S.*)$/);
      if (m && m[1] && m[2]) repos.push({ key: m[1], path: m[2].trim().replace(/^['"]|['"]$/g, '') });
    } else if (section === 'projects') {
      const m = line.match(/^\s+([A-Za-z0-9_.\-]+)\s*:\s*(\S.*)$/);
      if (m && m[1] && m[2]) projects.push({ name: m[1], path: m[2].trim().replace(/^['"]|['"]$/g, '') });
    }
  }
  return { repos, projects };
}

/** 主例程：读两类本地配置归一快照（只读，不写任何文件）。 */
export async function runLinkedReposSnapshot(
  rootPath: string,
  deps: LinkedReposSnapshotDeps = {},
): Promise<LinkedReposSnapshot> {
  const resolveBin = deps.resolveBin ?? resolveSillySpecBinDefault;
  const bin = resolveBin();
  const fetched_at = new Date().toISOString();
  if (!bin) {
    return {
      projects: [],
      projects_skipped: 'sillyspec 未安装',
      repos: [],
      repos_skipped: 'sillyspec 未安装',
      fetched_at,
    };
  }
  const timeoutMs = deps.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const exec =
    deps.exec ??
    (async (a: string[], c: string) => {
      const { stdout, stderr } = await execFileAsync(process.execPath, [bin, ...a], {
        cwd: c,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      });
      return { stdout, stderr };
    });

  const projects: SnapshotProjectEntry[] = [];
  let projects_skipped: string | null = null;
  let projectsFallback: Array<{ name: string; path: string }> = [];

  // ── 源 1：workspace status --json ──
  try {
    const { stdout } = await exec(['workspace', 'status', '--json'], rootPath);
    const parsed = JSON.parse(stdout) as { projects?: Array<Record<string, unknown>> };
    for (const p of parsed.projects ?? []) {
      const name = typeof p.name === 'string' ? p.name : '';
      if (!name || !/^[A-Za-z0-9_.\-]+$/.test(name)) continue;
      projects.push({
        name,
        path: nullIfBlank(p.path),
        role: nullIfBlank(p.role),
        state: nullIfBlank(p.state),
        detail: nullIfBlank(p.detail),
      });
    }
  } catch (e) {
    const err = e as { killed?: boolean; stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`;
    projects_skipped = err.killed
      ? '执行超时'
      : UNKNOWN_COMMAND_RE.test(output)
        ? 'sillyspec 需升级（无 workspace status --json）'
        : '读取失败';
  }

  // ── 源 2：config cat --spec-dir（repos: 段 + projects: 块兜底）──
  const repos: SnapshotRepoEntry[] = [];
  let repos_skipped: string | null = null;
  try {
    const { stdout } = await exec(['config', 'cat', '--spec-dir', rootPath], rootPath);
    const sections = parseLocalYamlSections(stdout);
    repos.push(...sections.repos);
    projectsFallback = sections.projects;
  } catch (e) {
    const err = e as { killed?: boolean; stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`;
    repos_skipped = err.killed
      ? '执行超时'
      : UNKNOWN_COMMAND_RE.test(output)
        ? 'sillyspec 需升级（无 config cat）'
        : '读取失败';
  }

  // R-01 兜底：status 的 path 为 null 且 config projects: 块有同名相对路径 → 填充。
  if (projectsFallback.length > 0) {
    const fallbackByName = new Map(projectsFallback.map((x) => [x.name, x.path]));
    for (const p of projects) {
      if (p.path === null) {
        p.path = fallbackByName.get(p.name) ?? null;
      }
    }
  }

  return { projects, projects_skipped, repos, repos_skipped, fetched_at };
}
