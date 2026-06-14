/**
 * version.ts —— semver 解析与最低版本校验（Python version.py 的 1:1 Node 迁移）。
 *
 * 职责：
 *   为 agent-detector（task-16）提供「解析 agent CLI 版本字符串 + 判断是否达最低要求」
 *   的纯函数能力。agent-detector 探测到某 provider 二进制后，调用 `claude --version` 取
 *   stdout，经 parseSemver 提取三元组，再用 checkMinVersion 与 MIN_VERSIONS[provider]
 *   比较，低于则返回警告文本。
 *
 * Python 源对照：
 *   sillyhub_daemon/version.py:1-7   模块 docstring + __all__
 *   sillyhub_daemon/version.py:9     _SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")
 *   sillyhub_daemon/version.py:11-15 MIN_VERSIONS（claude/codex/copilot）
 *   sillyhub_daemon/version.py:18-30 parse_semver（re.search 取首个三元组）
 *   sillyhub_daemon/version.py:33-35 format_semver
 *   sillyhub_daemon/version.py:38-62 check_min_version（三段短路判定）
 *
 * 设计约束：
 *   - G-05 零依赖：不引 semver 库，手写 RegExp + 数值比较。
 *   - G-01 功能等价：与 Python 版行为 1:1（正则、比较、warning 文本格式逐字对齐）。
 *
 * @see design.md §6（version.ts 文件清单）/ §10 R-01（1:1 迁移风险）
 */

/**
 * semver 三元组（major, minor, patch）。readonly 防止 mutation。
 * 对应 Python 的 tuple[int, int, int]。
 */
export type SemVerTuple = readonly [number, number, number];

/**
 * 各 provider 的最低版本要求。
 *
 * 仅 3 个 provider 有版本门槛（其余 provider 无 entry → checkMinVersion 直接返回 null，
 * 即无要求）。新增 provider 的版本限制需在此添加。
 *
 * 对照 Python version.py:11-15：
 *   MIN_VERSIONS = {"claude": (2,0,0), "codex": (0,100,0), "copilot": (1,0,0)}
 */
export const MIN_VERSIONS: Readonly<Record<string, SemVerTuple>> = {
  claude: [2, 0, 0],
  codex: [0, 100, 0],
  copilot: [1, 0, 0],
};

/**
 * 核心正则：匹配 major.minor.patch（无锚定，等价 Python re.search）。
 *
 * 注意：不匹配 prerelease 后缀（如 -rc.1 / -alpha.2）。这是 Python 版的既定行为——
 * `0.118.0-rc.1` 解析为 (0,118,0)，prerelease 部分被正则忽略。Node 版严格保持一致。
 * 模块级常量避免每次调用重新编译（对应 Python 模块级 _SEMVER_RE）。
 */
const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

/**
 * 从任意字符串中提取第一个 semver 三元组。
 *
 * 行为（对齐 Python version.py:18-30 parse_semver）：
 *   1. raw 为 null/undefined/空串 → 返回 null（对应 Python `if not raw: return None`）；
 *   2. SEMVER_RE.exec(raw) 取首个匹配（对应 Python re.search）；
 *   3. 未匹配 → 返回 null；
 *   4. 匹配 → 返回 [Number(m[1]), Number(m[2]), Number(m[3])]。
 *
 * search 语义（非 match）：可处理前导文本，如 "Claude Code 2.1.5" → [2,1,5]、
 * "v2.0.0" → [2,0,0]（v 前缀自然跳过）。
 *
 * @param raw 任意字符串（通常是 `claude --version` 的 stdout）；可为 null/undefined
 * @returns 三元组 [major, minor, patch] 或 null（无法解析）
 */
export function parseSemver(
  raw: string | null | undefined,
): SemVerTuple | null {
  if (!raw) {
    return null;
  }
  const m = SEMVER_RE.exec(raw);
  if (!m) {
    return null;
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * 将 semver 三元组格式化为 "major.minor.patch" 字符串。
 *
 * 对齐 Python version.py:33-35 `f"{triple[0]}.{triple[1]}.{triple[2]}"`。
 * 入参假定合法（由 parseSemver 产出或 MIN_VERSIONS 常量），不做防御性校验。
 *
 * @param tuple 三元组
 * @returns 形如 "2.1.5" / "0.100.0" / "0.0.0" 的字符串
 */
export function formatSemver(tuple: SemVerTuple): string {
  return `${tuple[0]}.${tuple[1]}.${tuple[2]}`;
}

/**
 * 比较两个 semver 三元组（字典序，逐元素）。
 *
 * 内部辅助函数（不导出），供 checkMinVersion 使用。
 * 返回：负数 a<b / 0 a==b / 正数 a>b（与 Python tuple 比较语义一致）。
 */
function compareTuple(a: SemVerTuple, b: SemVerTuple): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/**
 * 判断某 provider 的实际版本是否低于最低要求，低于则返回警告文本。
 *
 * 三段短路判定（顺序严格对齐 Python version.py:38-62）：
 *   1. provider 在 MIN_VERSIONS 中无 entry → 返回 null（无要求）；
 *   2. version 无法 parseSemver → 返回 null（无法比较，不叠加噪声）；
 *   3. parsed < minVer → 返回 warning string；否则返回 null（达标）。
 *
 * warning 文本格式（逐字对齐 Python version.py:57-60）：
 *   `${provider} version ${version} is below minimum required version ${formatSemver(minVer)}`
 *
 * 注意：文本中的 version 用**原始字符串**（非 formatSemver 后的），保留用户传入的形态
 * （如 "v1.5.0" / "Claude Code 1.5.0"），便于排查。对应 Python f-string 中直接用 {version}。
 *
 * @param provider provider 名（如 'claude' / 'codex' / 'copilot'）
 * @param version 版本字符串（如 '2.1.5' / 'Claude Code 2.1.5' / 'v1.5.0'）
 * @returns 警告文本（低于最低版本时）或 null（无要求 / 无法解析 / 达标）
 */
export function checkMinVersion(
  provider: string,
  version: string,
): string | null {
  const minVer = MIN_VERSIONS[provider];
  if (minVer === undefined) {
    return null;
  }

  const parsed = parseSemver(version);
  if (parsed === null) {
    return null;
  }

  if (compareTuple(parsed, minVer) < 0) {
    return (
      `${provider} version ${version} is below minimum`
      + ` required version ${formatSemver(minVer)}`
    );
  }

  return null;
}
