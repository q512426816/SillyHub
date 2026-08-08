#!/usr/bin/env node
/**
 * scripts/check-dispatch-allowed-roots.mjs
 *
 * 路径A 部署期 smoke 前置硬校验（design 2026-08-08-dispatch-worker-caller-worktree §10 R-03）。
 *
 * author: qinyi
 * created_at: 2026-08-08 19:12:00
 *
 * 目的
 *   dispatch_worker（路径A）把 worker 派到 caller worktree，daemon 会先在 spawn 阶段
 *   经 `assertWithinAllowedRoots`（sillyhub-daemon/src/file-rpc.ts:70-99）校验 root_path
 *   落在本地 config 的 `allowed_roots` 内。仓根没放行 → `forbidden 'path outside
 *   allowed_roots'`，worker 起不来。本脚本在部署期一次性自检，让 R-03 fail-fast 而非
 *   dispatch 时才报错。
 *
 *   仅覆盖「守卫一」（本地 config → assertWithinAllowedRoots / HostFsHandler）。
 *   「守卫二」（runtime overlay / PolicyEngine 写沙箱，源在 backend DB）不在本脚本范围，
 *   需在 backend / 前端单独确认 daemon 实体 allowed_roots 含仓根。
 *
 * 用法
 *   node scripts/check-dispatch-allowed-roots.mjs [--repo-root <path>] [--server-url <url>] [--config-dir <dir>]
 *
 *   --repo-root    caller 仓根绝对路径（默认 process.cwd()）
 *   --server-url   仅校验连该后端的 daemon 配置（定位单个 config-<hash>.json）
 *   --config-dir   daemon 配置目录（默认 ~/.sillyhub/daemon；测试可注入）
 *
 * 退出码
 *   0  仓根已被所有相关 config 的 allowed_roots 放行
 *   1  未放行 / config 缺失 / allowed_roots 为空 / 解析失败（fail-closed）
 *
 * 语义对照（必须与真实守卫一致，否则 pre-check 失真）
 *   - 比较函数 isUnder 1:1 复刻 file-rpc.ts:81-95：pathResolve + 边界敏感前缀
 *     （`resolved===root` 或 `startsWith(root+sep)`），Windows 盘符 toLowerCase 归一、
 *     POSIX 大小写敏感。task-10.md 字面写「realpath」，但真实守卫用 pathResolve（不做
 *     symlink 解析）；为让本脚本的判定与守卫实际行为一致（pre-check 不应给出比守卫更
 *     乐观的假阳性），同样采用 pathResolve。
 *   - serverHash 复刻 config.ts:94（sha256 前 8 位十六进制）。
 *   - config 文件命名复刻 config.ts:131 PER_SERVER_CONFIG_RE：`config-[0-9a-f]{8}.json`。
 *
 * 纯读 JSON 文件，不启动 / 不依赖 daemon 进程，不连 backend。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import process from 'node:process';

// ── 常量 ────────────────────────────────────────────────────────────────────

/** daemon per-server 配置目录（复刻 config.ts:50 DEFAULT_CONFIG_DIR）。 */
const CONFIG_DIR_DEFAULT = join(homedir(), '.sillyhub', 'daemon');

/** per-server 配置文件名正则（复刻 config.ts:131 PER_SERVER_CONFIG_RE）。 */
const PER_SERVER_CONFIG_RE = /^config-[0-9a-f]{8}\.json$/;

/** server_url hash 长度（复刻 config.ts:83 SERVER_HASH_LENGTH）。 */
const SERVER_HASH_LENGTH = 8;

// ── 复刻 daemon 关键纯函数 ───────────────────────────────────────────────────

/**
 * 计算某 server_url 的本地配置文件 hash 片段（复刻 config.ts:94 serverHash）。
 * sha256 前 8 位十六进制。
 */
function serverHash(serverUrl) {
  return createHash('sha256')
    .update(serverUrl, 'utf-8')
    .digest('hex')
    .slice(0, SERVER_HASH_LENGTH);
}

/**
 * 边界敏感「path 在 root 之下」判定（1:1 复刻 file-rpc.ts:81-95 的 resolve + under）。
 *
 *   - resolved 必须先经 pathResolve（折叠 `..` / 相对段）
 *   - 命中：`resolved === root` 或 `startsWith(root + sep)`（兄弟撞名不误匹配）
 *   - Windows（sep==='\\' 或盘符前缀）走 toLowerCase 归一；POSIX 大小写敏感
 *
 * 注：与 file-rpc.ts 一致，不做 trailing-sep 特判（root 已含尾 sep 时 r+sep 产生双 sep，
 *     仅 exact-equal 命中）。这是真实守卫的行为，本 pre-check 保持一致。
 */
function isUnder(resolved, root) {
  const r = resolve(root);
  const isWin = sep === '\\' || /^[A-Za-z]:[\\/]/.test(resolved);
  const eq = (a, b) => (isWin ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (eq(resolved, r)) return true;
  return isWin
    ? resolved.toLowerCase().startsWith(r.toLowerCase() + sep)
    : resolved.startsWith(r + sep);
}

// ── argv 解析 ────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `\
check-dispatch-allowed-roots.mjs — 路径A daemon allowed_roots 部署期自检

用法:
  node scripts/check-dispatch-allowed-roots.mjs [options]

选项:
  --repo-root <path>   caller 仓根绝对路径（默认 process.cwd()）
  --server-url <url>   仅校验连该后端的 daemon 配置（定位 config-<hash>.json）
  --config-dir <dir>   daemon 配置目录（默认 ~/.sillyhub/daemon）
  -h, --help           显示本帮助

不传 --server-url 时全量扫 config-*.json，任一缺失仓根即判失败（fail-closed）。
退出码：0 = 放行；1 = 未放行 / 缺 config / allowed_roots 空。`;
  process.stdout.write(help + '\n');
}

function parseArgs(argv) {
  const opts = {
    repoRoot: process.cwd(),
    serverUrl: null,
    configDir: CONFIG_DIR_DEFAULT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        process.stderr.write(`错误：${a} 缺少参数值。用 -h 查看用法。\n`);
        process.exit(2);
      }
      return v;
    };
    if (a === '--repo-root') opts.repoRoot = next();
    else if (a === '--server-url') opts.serverUrl = next();
    else if (a === '--config-dir') opts.configDir = next();
    else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    } else {
      process.stderr.write(`错误：未知参数 ${a}。用 -h 查看用法。\n`);
      process.exit(2);
    }
  }
  return opts;
}

// ── 找 config 文件 ───────────────────────────────────────────────────────────

/**
 * 返回要校验的 config 文件绝对路径列表。
 * - 传 serverUrl：仅该 server 对应文件（可能空数组——文件不存在）
 * - 不传：扫 configDir 下所有 config-<8hex>.json（可能空数组——目录不存在 / 无匹配）
 */
function findConfigFiles(configDir, serverUrl) {
  if (!existsSync(configDir)) return [];
  if (serverUrl !== null) {
    const p = join(configDir, `config-${serverHash(serverUrl)}.json`);
    return existsSync(p) ? [p] : [];
  }
  return readdirSync(configDir)
    .filter((n) => PER_SERVER_CONFIG_RE.test(n))
    .map((n) => join(configDir, n))
    .sort();
}

// ── 单 config 校验 ───────────────────────────────────────────────────────────

/**
 * 校验单个 config 是否放行 repoRootResolved。
 * 返回 { ok, reason?, roots, matchedRoot? }。
 * fail-closed：JSON 解析失败 / 缺 allowed_roots / 空数组 → ok:false。
 */
function checkConfig(configPath, repoRootResolved) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    return {
      ok: false,
      reason: `config JSON 解析失败（${e.message}）`,
      roots: [],
    };
  }
  const rootsRaw = raw && Array.isArray(raw.allowed_roots) ? raw.allowed_roots : null;
  if (rootsRaw === null) {
    return {
      ok: false,
      reason: 'config 缺 allowed_roots 字段（fail-closed，不 fallback homedir）',
      roots: [],
    };
  }
  const roots = rootsRaw.filter((p) => typeof p === 'string' && p.length > 0);
  if (roots.length === 0) {
    return {
      ok: false,
      reason: 'allowed_roots 为空或全部为脏数据（fail-closed，不 fallback homedir）',
      roots: [],
    };
  }
  const matched = roots.find((r) => isUnder(repoRootResolved, r));
  if (!matched) {
    return {
      ok: false,
      reason: '仓根不在 allowed_roots 内（边界敏感前缀比较未命中任一 root）',
      roots,
    };
  }
  return { ok: true, roots, matchedRoot: matched };
}

// ── 引导文案 ─────────────────────────────────────────────────────────────────

function printGuidance(repoRootResolved, configDir, serverUrl, files) {
  const targetHint = serverUrl
    ? `~/.sillyhub/daemon/config-${serverHash(serverUrl)}.json（server=${serverUrl}）`
    : '每一个 ~/.sillyhub/daemon/config-<hash>.json（全量校验要求都放行）';
  process.stderr.write(
    `
==================== 修复引导 ====================
仓根未被 daemon 本地配置放行（守卫一：assertWithinAllowedRoots）。

要把仓根追加到：${targetHint}

具体做法：在对应 config-<hash>.json 的 allowed_roots 数组里追加仓根绝对路径，
然后重启 daemon（config 仅在启动时读入内存）。

仓根（已规范化）：
  ${repoRootResolved}

JSON 示例（注意：必须绝对路径，不要写 ~，Windows 盘符保留）：
  {
    "server_url": "http://localhost:8000",
    "allowed_roots": [
      ${JSON.stringify(repoRootResolved)},
      "...其它已放行目录..."
    ]
  }

配置目录（实际）：${configDir}
检测到 ${files.length} 个 per-server config 文件。

⚠️ 还要确认「守卫二」：backend 侧 daemon 实体 / runtime 的 allowed_roots
   （DaemonRuntime.allowed_roots，经心跳/WS 下发到 PolicyEngine 写沙箱）同样含仓根。
   该数据在 backend DB，本脚本不查。详见 docs/integrations/sillyspec-dispatch.md §3.2。
==================================================
`.trimEnd() + '\n',
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRootResolved = resolve(opts.repoRoot);
  const files = findConfigFiles(opts.configDir, opts.serverUrl);

  process.stdout.write(`仓根 (repo-root) ：${repoRootResolved}\n`);
  process.stdout.write(
    `config 目录      ：${opts.configDir}` +
      (opts.serverUrl
        ? `（server=${opts.serverUrl}, hash=${serverHash(opts.serverUrl)}）\n`
        : '（未指定 --server-url，全量扫 config-*.json）\n'),
  );

  if (!existsSync(opts.repoRoot)) {
    process.stderr.write(
      `⚠️ 警告：仓根路径不存在（仍按 pathResolve 做字面校验，因 daemon spawn 时 cwd 可能尚未创建）。\n`,
    );
  }

  if (files.length === 0) {
    const where = opts.serverUrl
      ? `连 ${opts.serverUrl} 的 daemon 配置（config-${serverHash(opts.serverUrl)}.json）`
      : '任何 per-server daemon 配置（config-<hash>.json）';
    process.stderr.write(`\n[FAIL] 未找到${where}。fail-closed：没配置 = 没放行。\n`);
    printGuidance(repoRootResolved, opts.configDir, opts.serverUrl, files);
    process.exit(1);
  }

  let allOk = true;
  for (const f of files) {
    const r = checkConfig(f, repoRootResolved);
    if (r.ok) {
      process.stdout.write(`[OK]   ${f}\n        ↳ 命中 root: ${r.matchedRoot}\n`);
    } else {
      allOk = false;
      process.stderr.write(`[FAIL] ${f}\n        ↳ ${r.reason}\n`);
      if (r.roots.length > 0) {
        process.stderr.write(`        当前 allowed_roots:\n`);
        for (const root of r.roots) {
          process.stderr.write(`          - ${root}\n`);
        }
      }
    }
  }

  if (allOk) {
    process.stdout.write(
      `\n[PASS] 仓根已被上述所有 daemon 配置放行（守卫一：assertWithinAllowedRoots）。\n` +
        `注意：守卫二（runtime overlay / PolicyEngine）需在 backend 单独确认 daemon 实体\n` +
        `      allowed_roots 同样含仓根，本脚本不覆盖。详见 docs/integrations/sillyspec-dispatch.md。\n`,
    );
    process.exit(0);
  }

  printGuidance(repoRootResolved, opts.configDir, opts.serverUrl, files);
  process.exit(1);
}

main();
