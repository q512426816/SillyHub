/**
 * credential —— 本地凭证存储与占位符渲染。
 *
 * 设计参考：design §4.2.3（用户密钥不离开本机）。
 * server 只下发含 `{{USER_*}}` 占位符的配置模板，daemon 在本地解析后
 * 注入 agent 子进程 env。凭证文件 `~/.sillyhub/daemon/credentials.json`，
 * 权限 0600（POSIX）。
 *
 * Python 源对照：sillyhub_daemon/credential.py（127 行，1:1 迁移）。
 * design.md §10 R-05（0600 跨平台）、requirements FR-05。
 *
 * 行号对照（Python credential.py）：
 *   DEFAULT_CREDENTIALS_PATH  L22
 *   __init__ / _load          L35-49
 *   save                       L51-59
 *   get/set/remove/list_keys   L63-79
 *   render_config              L83-112
 *   build_env                  L114-126
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 去除字符串开头的 BOM（﻿）。 */
function stripBOM(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * 默认凭证文件路径：~/.sillyhub/daemon/credentials.json。
 * 对照 Python `DEFAULT_CREDENTIALS_PATH`（L22）：`Path.home() / '.sillyhub/daemon/credentials.json'`。
 */
export const DEFAULT_CREDENTIALS_PATH = path.join(
  os.homedir(),
  '.sillyhub',
  'daemon',
  'credentials.json',
);

/**
 * 判断 value 是否为 `{{USER_*}}` 占位符（整个 value 必须是占位符，非子串）。
 * 等价 Python（L96-100）：`value.startswith('{{USER_') and value.endswith('}}')`。
 *
 * 注意：用显式 startsWith/endsWith 判断，**不用正则**——
 * Python 源就是字符串前后缀判断，正则化会引入转义边界 bug。
 */
function isUserPlaceholder(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('{{USER_') &&
    value.endsWith('}}')
  );
}

/**
 * 本地凭证管理器。
 *
 * 职责：
 *   1. 加载/保存 `~/.sillyhub/daemon/credentials.json`（0600 权限）；
 *   2. CRUD（get/set/remove/listKeys），set/remove 立即持久化；
 *   3. 渲染配置中的 `{{USER_*}}` 占位符（renderConfig）；
 *   4. 转成子进程 env 字典（buildEnv，key 大写，过滤未解析项）。
 *
 * 优先级（与 Python 一致）：credentials.json > process.env > 保留原占位符。
 *
 * 对照 Python `CredentialManager`（L25-126）。
 */
export class CredentialManager {
  private readonly _path: string;
  private _credentials: Record<string, string> = {};

  /**
   * @param credentialsPath 可选，默认 DEFAULT_CREDENTIALS_PATH。单测注入临时路径。
   */
  constructor(credentialsPath?: string) {
    this._path = credentialsPath ?? DEFAULT_CREDENTIALS_PATH;
    this._load();
  }

  // -- persistence -----------------------------------------------------------

  /**
   * 加载凭证文件。
   * - 文件不存在：`_credentials = {}`，记 info 日志，**不抛错**（首次使用正常路径）。
   * - JSON 损坏：抛 SyntaxError（让用户感知配置错误，对照 B-03）。
   *
   * 对照 Python `_load`（L42-49）。
   */
  private _load(): void {
    if (fs.existsSync(this._path)) {
      const raw = fs.readFileSync(this._path, 'utf-8');
      this._credentials = JSON.parse(stripBOM(raw)) as Record<string, string>;
      console.debug(`credentials_loaded count=${Object.keys(this._credentials).length}`);
    } else {
      console.info(`credentials_file_not_found path=${this._path}`);
    }
  }

  /**
   * 保存凭证到文件，设 0600 权限（POSIX）。
   * Windows 或 chmod 失败时降级为警告（R-05 / FR-05），不抛错。
   *
   * 对照 Python `save`（L51-59）：
   *   mkdir(parents=True, exist_ok=True) + json.dump(indent=2)
   *   + os.chmod(S_IRUSR|S_IWUSR) + except OSError: warning
   */
  save(): void {
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    fs.writeFileSync(this._path, JSON.stringify(this._credentials, null, 2), 'utf-8');
    try {
      fs.chmodSync(this._path, 0o600);
    } catch (e) {
      // POSIX 下 chmod 失败属异常（权限/只读 fs），仍降级为警告保证流程不中断。
      // Windows NTFS 无 0600 语义，chmod 抛 EPERM 是预期行为（R-05）。
      console.warn(`credentials_chmod_failed path=${this._path} err=${(e as Error).message}`);
    }
  }

  // -- CRUD ------------------------------------------------------------------

  /**
   * 获取凭证。对照 Python `get`（L63-65）：`self._credentials.get(key)`。
   * Python 返回 None，TS 返回 undefined（dict[k] 不存在）。
   */
  get(key: string): string | undefined {
    return this._credentials[key];
  }

  /**
   * 设置凭证并立即持久化（save）。对照 Python `set`（L67-70）。
   */
  set(key: string, value: string): void {
    this._credentials[key] = value;
    this.save();
  }

  /**
   * 移除凭证并立即持久化。key 不存在不抛错。
   * 对照 Python `remove`（L72-75）：`self._credentials.pop(key, None)`。
   */
  remove(key: string): void {
    delete this._credentials[key];
    this.save();
  }

  /**
   * 列出所有 key。对照 Python `list_keys`（L77-79）：`list(self._credentials.keys())`。
   */
  listKeys(): string[] {
    return Object.keys(this._credentials);
  }

  // -- placeholder rendering -------------------------------------------------

  /**
   * 渲染 config 中的 `{{USER_*}}` 占位符。
   *
   * 解析顺序（与 Python `render_config` 一致，L83-112）：
   *   1. 本地 credentials.json
   *   2. 同名环境变量
   * 两源都无值则**保留原始占位符字符串**（让调用方 buildEnv 过滤掉）。
   *
   * 注意：整个 value 必须是占位符（`{{USER_XXX}}`），**不做子串替换**。
   * key 取出保留 `USER_` 前缀（如 `USER_GITHUB_TOKEN`），不是 `GITHUB_TOKEN`。
   *
   * 优先级用 `||` 短路：与 Python `credentials.get(k) or os.environ.get(k)`
   * 行为一致——空串视为 falsy，跳到下一源。
   *
   * 不修改入参 config（对照 Python test_does_not_mutate_input）。
   */
  renderConfig<T extends Record<string, unknown>>(config: T): Record<string, unknown> {
    const rendered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (isUserPlaceholder(value)) {
        const envVar = value.slice(2, -2); // strip {{ }}，保留 USER_ 前缀
        // Python `creds.get(k) or os.environ.get(k)`：`or` 短路——
        // creds 空串/undefined 均 falsy，会跳到 env；env 也是 falsy/undefined
        // 则整个表达式为该 falsy 值或 undefined。
        // TS 用 `||` 等价：空串/undefined 均 falsy 跳到 env。
        const resolved = this._credentials[envVar] || process.env[envVar];
        // Python：`resolved if resolved is not None else value`——
        // 仅 None（TS undefined）才保留原占位符，空串仍算"已解析"。
        if (resolved !== undefined) {
          rendered[key] = resolved;
          const source = envVar in this._credentials ? 'credentials' : 'env';
          console.debug(`credential_resolved key=${key} source=${source}`);
        } else {
          // 未解析保留原占位符（buildEnv 会过滤）
          rendered[key] = value;
        }
      } else {
        rendered[key] = value;
      }
    }
    return rendered;
  }

  /**
   * 把渲染后的 config 转成子进程 env 字典。
   *
   * 规则（与 Python `build_env` 一致，L114-126）：
   *   1. 先 renderConfig；
   *   2. 过滤掉值仍含 `{{` 的项（未解析占位符不注入 env，避免泄露模板）；
   *   3. key 转大写（subprocess env 约定大写）。
   *
   * 调用点：task-19 TaskRunner 在 spawn agent 前调本方法，
   * 与 process.env 合并后传给子进程。
   *
   * 注意：非 string 值（如 number）也不注入 env（env 必须是 string）。
   */
  buildEnv(config: Record<string, unknown>): Record<string, string> {
    const rendered = this.renderConfig(config);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(rendered)) {
      if (typeof value === 'string' && !value.startsWith('{{')) {
        env[key.toUpperCase()] = value;
      }
    }
    return env;
  }
}
