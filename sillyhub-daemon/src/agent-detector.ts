/**
 * agent-detector.ts —— 12 provider CLI 探测（Python agent_detector.py 的 1:1 Node 迁移）。
 *
 * 职责：
 *   启动时探测本机 12 种 coding agent CLI（claude/codex/copilot/opencode/openclaw/hermes/
 *   gemini/pi/cursor/kimi/kiro/antigravity）。按优先级 `env 覆盖 → PATH which → 不可用`
 *   解析每个 provider 的二进制路径，执行 `<bin_path> --version` 取版本，调用 task-14 的
 *   checkMinVersion 校验最低版本。为 daemon（task-20）注册阶段提供可用 agent 列表。
 *
 * Python 源对照：
 *   sillyhub_daemon/agent_detector.py:37-46   AgentDef dataclass
 *   sillyhub_daemon/agent_detector.py:48-58   DetectedAgent dataclass
 *   sillyhub_daemon/agent_detector.py:98-174  AGENT_DEFS（12 provider）
 *   sillyhub_daemon/agent_detector.py:180-185 detect_all（串行）
 *   sillyhub_daemon/agent_detector.py:187-195 detect_one
 *   sillyhub_daemon/agent_detector.py:197-207 is_available
 *   sillyhub_daemon/agent_detector.py:224-243 _resolve_bin_path（env → which → None）
 *   sillyhub_daemon/agent_detector.py:245-272 _detect_version（subprocess + 10s timeout）
 *   sillyhub_daemon/agent_detector.py:274-299 _detect_single
 *
 * 设计约束：
 *   - G-05 零依赖：仅用 Node 内置 child_process / fs / path，不引 which 库。
 *   - G-01 功能等价：与 Python 版行为 1:1（探测优先级、--version 解析、版本校验）。
 *
 * @see design.md §6（agent-detector.ts 文件清单）/ FR-07（12 provider 探测）
 */

import { execFile, exec } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkMinVersion } from './version.js';
import { resolveCursorVersionEntry } from './cursor-version.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/**
 * 5 种 agent 协议字面量（对齐 task-11 PROTOCOL_PROVIDERS 的 key）。
 */
export type AgentProtocol =
  | 'stream_json'
  | 'json_rpc'
  | 'jsonl'
  | 'ndjson'
  | 'text';

/**
 * provider 定义形状（对应 Python AgentDef dataclass）。
 * 每个 entry 描述一种 agent CLI 的探测元信息。
 */
export interface AgentProviderSpec {
  /** 二进制可执行名（不含路径），用于 PATH 查找（如 'claude' / 'cursor-agent' / 'agy'）。 */
  readonly bin: string;
  /** 环境变量名（如 'SILLYHUB_CLAUDE_PATH'），优先级最高，覆盖 PATH 查找结果。 */
  readonly envPath: string;
  /** 版本正则。对 --version 的 stdout+stderr 合并输出 exec 取首个匹配的捕获组 1。 */
  readonly versionPattern: RegExp;
  /** 协议名（用于注册时上报 backend）。 */
  readonly protocol: AgentProtocol;
  /** 最低版本要求字符串（如 '2.0.0'）；undefined 表示该 provider 无版本要求。 */
  readonly minVersion?: string;
}

/**
 * 探测结果（对应 Python DetectedAgent dataclass）。
 * 字段命名调整：bin_path → path / available:bool → status 字面量 / 新增 reason / runtimeId。
 */
export interface DetectedAgent {
  /** provider 名（'claude' / 'codex' / ... 之一）。 */
  readonly provider: string;
  /** 解析出的二进制绝对路径；不可用时为空串 ''。 */
  readonly path: string;
  /** 版本字符串（来自 --version 解析）；未探测到或解析失败为 undefined。 */
  readonly version: string | undefined;
  /** 协议名（来自 PROVIDER_SPECS，固定值）。 */
  readonly protocol: AgentProtocol;
  /** 状态：'available'（找到二进制且 --version 执行了，无论版本是否达标）/ 'unavailable'。 */
  readonly status: 'available' | 'unavailable';
  /** 不可用原因（仅 status === 'unavailable' 时有值）：'not-found' / 'env-path-invalid'。 */
  readonly reason?: string;
  /** 版本警告文本（来自 checkMinVersion）；null 表示无要求 / 达标 / 无法解析。 */
  readonly versionWarning: string | null;
  /**
   * 注册成功后回填的 runtime_id（由 backend 在 register 响应中下发）。
   * 探测器输出时始终为 undefined；task-20 Daemon 注册成功后写入。
   * 见任务说明「runtime_id 关键澄清」。
   */
  runtimeId?: string;
}

// ---------------------------------------------------------------------------
// 12 provider 探测表（对齐 Python AGENT_DEFS，agent_detector.py:98-174）
// ---------------------------------------------------------------------------

/**
 * 12 provider 探测表。顺序：claude / codex / copilot / opencode / openclaw /
 * hermes / gemini / pi / cursor / kimi / kiro / antigravity。
 *
 * 注意：claude 的 versionPattern 支持「Claude Code X.Y.Z」前缀和「X.Y.Z (Claude Code)」
 * 后缀两种格式（对应 Python agent_detector.py:102-103 的 raw string）。
 */
export const PROVIDER_SPECS = {
  claude: {
    bin: 'claude',
    envPath: 'SILLYHUB_CLAUDE_PATH',
    versionPattern: /(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?/,
    protocol: 'stream_json' as const,
    minVersion: '2.0.0',
  },
  codex: {
    bin: 'codex',
    envPath: 'SILLYHUB_CODEX_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
    minVersion: '0.100.0',
  },
  copilot: {
    bin: 'copilot',
    envPath: 'SILLYHUB_COPILOT_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'jsonl' as const,
    minVersion: '1.0.0',
  },
  opencode: {
    bin: 'opencode',
    envPath: 'SILLYHUB_OPENCODE_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'ndjson' as const,
  },
  openclaw: {
    bin: 'openclaw',
    envPath: 'SILLYHUB_OPENCLAW_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'ndjson' as const,
  },
  hermes: {
    bin: 'hermes',
    envPath: 'SILLYHUB_HERMES_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
  },
  gemini: {
    bin: 'gemini',
    envPath: 'SILLYHUB_GEMINI_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'stream_json' as const,
  },
  pi: {
    bin: 'pi',
    envPath: 'SILLYHUB_PI_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'ndjson' as const,
  },
  cursor: {
    bin: 'cursor-agent',
    envPath: 'SILLYHUB_CURSOR_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'stream_json' as const,
  },
  kimi: {
    bin: 'kimi',
    envPath: 'SILLYHUB_KIMI_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
  },
  kiro: {
    bin: 'kiro-cli',
    envPath: 'SILLYHUB_KIRO_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'json_rpc' as const,
  },
  antigravity: {
    bin: 'agy',
    envPath: 'SILLYHUB_ANTIGRAVITY_PATH',
    versionPattern: /(\d+\.\d+\.\d+)/,
    protocol: 'text' as const,
  },
} as const;

/** provider 名联合类型（'claude' | 'codex' | ... 共 12 个字面量）。 */
export type ProviderName = keyof typeof PROVIDER_SPECS;

// ---------------------------------------------------------------------------
// AgentDetector
// ---------------------------------------------------------------------------

/**
 * Windows 上 PATH 查找尝试追加的可执行后缀。
 *
 * ql-20260616-001 修复：移除空扩展名 ''。之前为了兼容纯 git-bash 环境保留了 '',
 * 但实测会让 findOnPath 在 .exe/.cmd/.bat/.ps1 都不存在时返回 npm 生成的无扩展名
 * sh wrapper（如 C:\nvm4w\nodejs\claude），该文件 Node spawn 不走 shell 时无法
 * CreateProcess → ENOENT（task-runner.ts 的 isWindowsCmdWrapper 正则只匹配 .cmd/.bat）。
 * 现在仅返回真正可执行的扩展名；如某机器只有 sh wrapper 而无 .cmd 等价物，
 * findOnPath 返回 null，daemon 注册时该 provider 标记 unavailable，比静默 ENOENT 更明确。
 */
const WINDOWS_EXTS = ['.exe', '.cmd', '.bat', '.ps1'];

/**
 * 探测本机 12 种 coding agent CLI。
 *
 * 单实例无状态（Python 版同样每次 daemon 启动 new 一个）。
 * 子进程执行 / PATH 查找 / env 读取都在实例方法内，便于单测 mock（覆写 protected 方法）。
 */
export class AgentDetector {
  /**
   * 探测全部 12 个 provider，返回 DetectedAgent[]（顺序与 PROVIDER_SPECS 一致）。
   *
   * 串行执行（对齐 Python detect_all，agent_detector.py:180-185）——非 Promise.all 并发，
   * 避免瞬时 12 个子进程 + 与 Python 行为偏离。
   */
  async detectAgents(): Promise<DetectedAgent[]> {
    const results: DetectedAgent[] = [];
    for (const name of Object.keys(PROVIDER_SPECS) as ProviderName[]) {
      const spec = PROVIDER_SPECS[name];
      results.push(await this.detectSingle(name, spec));
    }
    return results;
  }

  /**
   * 探测单个 provider。
   *
   * @param name provider 名（必须是 PROVIDER_SPECS 的 key 之一）
   * @returns DetectedAgent；未知 provider 返回 null（对齐 Python detect_one，agent_detector.py:187-195）
   */
  async detectOne(name: string): Promise<DetectedAgent | null> {
    const spec = (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name];
    if (spec === undefined) {
      return null;
    }
    return this.detectSingle(name as ProviderName, spec);
  }

  /**
   * 同步快速检查某 provider 是否可用（仅 PATH 解析，不执行 --version）。
   *
   * 对齐 Python is_available，agent_detector.py:197-207。用于注册前的快速预筛（虽然
   * detectAgents 已含版本探测，但某些场景只需「存在性」而不需要版本）。
   *
   * @param name provider 名；未知返回 false
   */
  isAvailable(name: string): boolean {
    const spec = (PROVIDER_SPECS as Record<string, AgentProviderSpec>)[name];
    if (spec === undefined) {
      return false;
    }
    return this.resolveBinPath(spec) !== null;
  }

  // -------------------------------------------------------------------------
  // 内部方法（protected，可被单测覆写以 mock PATH/exec/existsSync）
  // -------------------------------------------------------------------------

  /**
   * 解析二进制路径。优先级：env 覆盖（file exists）→ PATH 查找 → null。
   * 对齐 Python _resolve_bin_path，agent_detector.py:224-243。
   */
  protected resolveBinPath(spec: AgentProviderSpec): string | null {
    const envVal = process.env[spec.envPath];
    if (envVal) {
      if (existsSync(envVal)) {
        return envVal;
      }
      // env 指向不存在路径 → 降级到 PATH 查找（对齐 Python：fallback to which）。
    }
    return this.findOnPath(spec.bin);
  }

  /**
   * 在 PATH 上查找二进制。跨平台兼容（POSIX 冒号 / Windows 分号 + 后缀尝试）。
   *
   * 不引第三方 which 库（design.md G-05）。封装为 protected 方法便于单测覆写。
   */
  protected findOnPath(binName: string): string | null {
    const pathVar = process.env.PATH;
    if (!pathVar) {
      return null;
    }
    const separator = process.platform === 'win32' ? ';' : ':';
    const exts = process.platform === 'win32' ? WINDOWS_EXTS : [''];
    for (const dir of pathVar.split(separator)) {
      if (!dir) continue;
      for (const ext of exts) {
        const candidate = join(dir, binName + ext);
        try {
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          // statSync 抛错（权限/符号链接断裂等）→ 跳过，继续下一个候选。
        }
      }
    }
    return null;
  }

  /**
   * 执行 `<binPath> --version`，用 versionPattern 解析输出，返回版本字符串或 null。
   *
   * 对齐 Python _detect_version，agent_detector.py:245-272：
   *   - timeout 10s（对应 Python asyncio.wait_for(..., timeout=10)）。
   *   - stdout + stderr 合并扫描（对应 Python output = stdout + stderr）。
   *   - versionPattern.exec 取首个匹配的捕获组 1。
   *   - Windows + .cmd/.bat 后缀的 binPath 走 shell exec 分支。
   *   - 任何异常（超时 / ENOENT / OSError）→ 返回 null，不抛错。
   */
  protected detectVersion(
    binPath: string,
    spec: AgentProviderSpec,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      // exec / execFile 的回调签名 err 类型分别是 ExecException / ExecFileException，
      // 两者 code 属性类型不同（number vs string|number|null），直接用任一类型都会导致
      // 另一签名拒绝。这里用泛化的回调类型（Error | null + string stdout/stderr），
      // exec/execFile 的 callback 重载都能接受（ExecException extends Error）。
      const onResult = (
        err: Error | null,
        stdout: string,
        stderr: string,
      ): void => {
        if (err) {
          // 超时 / ENOENT / 其他 OS 错误统一返回 null（对齐 Python except 分支）。
          resolve(null);
          return;
        }
        const output = (stdout || '') + (stderr || '');
        const m = spec.versionPattern.exec(output);
        resolve(m && m[1] ? m[1] : null);
      };

      const isWindowsCmdWrapper =
        process.platform === 'win32' && /\.(cmd|bat)$/i.test(binPath);
      if (isWindowsCmdWrapper) {
        // Windows .cmd/.bat 包装器必须走 shell（对应 Python subprocess.list2cmdline
        // + create_subprocess_shell 分支，agent_detector.py:248-256）。
        const escaped = `"${binPath}" --version`;
        exec(escaped, { timeout: 10_000, windowsHide: true }, onResult);
      } else {
        execFile(
          binPath,
          ['--version'],
          { timeout: 10_000, windowsHide: true },
          onResult,
        );
      }
    });
  }

  /**
   * 完整探测管道（单个 provider）。对齐 Python _detect_single，agent_detector.py:274-299。
   */
  private async detectSingle(
    name: ProviderName,
    spec: AgentProviderSpec,
  ): Promise<DetectedAgent> {
    const binPath = this.resolveBinPath(spec);

    if (binPath === null) {
      return {
        provider: name,
        path: '',
        version: undefined,
        protocol: spec.protocol,
        status: 'unavailable',
        reason: 'not-found',
        versionWarning: null,
        // runtimeId 留 undefined，待 task-20 注册回填。
      };
    }

    let version = await this.detectVersion(binPath, spec);
    // ql-20260620-002-f8c1：cursor 专属版本 fallback。官方 cursor-agent.ps1:48 的版本目录
    // 正则 `^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` 不匹配新版目录命名 YYYY.MM.DD-HH-MM-SS-commit
    // （`-` 后非纯十六进制）→ `cursor-agent --version` 必 exit 1（ps1 "No version directories
    // found"），detectVersion 拿不到版本。绕过 ps1 直接解析 versions/<latest>/ 目录取目录名作
    // 版本号（见 cursor-version.ts）。非 cursor provider 或无 versions 目录 → 保持原 null 行为。
    if (version === null && name === 'cursor') {
      const entry = resolveCursorVersionEntry(binPath);
      if (entry) {
        version = entry.version;
      }
    }
    // 注意：checkMinVersion 来自 ./version.js（task-14），传入 provider 名 + 原始版本字符串。
    // version 为 null 时跳过 checkMinVersion（对齐 Python if version is not None），
    // versionWarning 设为 null（不叠加噪声）。cursor 无 minVersion，目录名作版本时返回 null。
    const versionWarning =
      version !== null ? checkMinVersion(name, version) : null;

    return {
      provider: name,
      path: binPath,
      version: version ?? undefined,
      protocol: spec.protocol,
      status: 'available',
      versionWarning,
      // runtimeId 留 undefined，待 task-20 注册回填。
    };
  }
}
