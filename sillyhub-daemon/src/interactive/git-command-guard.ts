/**
 * git-command-guard —— agent Bash 命令的 git 写操作识别纯函数（2026-11-06-session-git-approval task-01）。
 *
 * 职责：把一段 shell 命令按 && / || / ; / | / 换行拆段，逐段识别 git commit / git push /
 * sillyspec push（推送形态），产出 GitCommandIntent 供挂载点（task-03 permission.ts /
 * task-04 driver-factory.ts）拦截挂起；未命中返回 null 放行原路径（FR-01，R-01/R-09）。
 *
 * 纯函数铁律（task-01 constraints）：不 spawn 子进程、不读盘、不读环境变量、不抛错——
 * 任何解析异常返回 null。逃生阀 SILLYHUB_GIT_APPROVAL 由挂载层判断，不在本模块。
 * ESM 无外部依赖（无 import）；平台无关解析（不假设路径分隔符/工作目录）。
 *
 * 决策依据：D-003（只拦 commit/push）、D-012（预填勾选规则）、D-013（sillyspec push
 * 识别——--dry-run/--no-push/--undo 无推送副作用不拦）、R-01（复合命令拆段防
 * 「git add ... && git commit」前缀绕过，知识库实证坑）。
 */

/** push 的执行载体：裸 git push / sillyspec push CLI（后者确认后原样代执行保留压扁语义）。 */
export type GitRunner = "git" | "sillyspec";

export interface GitPushTarget {
  /** push 目标 remote（位置参数第一个；缺省 null = 默认 origin）。 */
  remote: string | null;
  /** push 目标 ref（位置参数第二个；缺省 null = 当前分支）。 */
  ref: string | null;
}

/** 拆解一段 shell 命令后识别出的 git 写操作意图。 */
export interface GitCommandIntent {
  operation: "commit" | "push";
  runner: GitRunner;
  /** 命中段原始命令文本（供确认卡展示 agent 意图；runner=sillyspec 时代执行原样执行）。 */
  command: string;
  /** commit：解析出的 msg（-m 多段空格拼接 / --message=；无则空串）。push 恒空串。 */
  message: string;
  /** commit：-F/--file 指定的 msg 文件路径（guard 纯函数不读盘，挂载层读取内容填 payload.message）。 */
  messageFile: string | null;
  /** commit：命令显式指定的 pathspec（未指定为 null，配合 allTracked 判定预填）。 */
  pathspec: string[] | null;
  /** commit：是否带 -a/--all（全部 tracked 改动）。 */
  allTracked: boolean;
  /** push：目标 remote/ref（缺省 null → 默认 origin+当前分支）。commit 恒 {remote:null,ref:null}。 */
  pushTarget: GitPushTarget;
  /** git -C <path> 指定的工作目录（无则 null = agent cwd）。 */
  workDir: string | null;
}

/** resolveDefaultSelection 消费的最小工作区状态（task-02 采集产出对齐）。 */
export interface WorkspaceStatusFile {
  path: string;
  status: "added" | "modified" | "deleted" | "untracked";
  /** 是否在暂存区（agent 已 git add）。 */
  staged: boolean;
}

export interface WorkspaceStatus {
  files: WorkspaceStatusFile[];
}

/* ───────────── 拆段（引号感知） ───────────── */

/**
 * 按分隔符把复合命令拆成子命令段：&& / || / ; / | / 换行。
 * 引号（单/双）内的分隔符不拆（如 git commit -m "a && b"）。
 */
export function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  const chars = Array.from(command);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    // 分隔符判定（引号外）：优先匹配双字符 && / ||
    const two = ch + (chars[i + 1] ?? "");
    if (two === "&&" || two === "||") {
      segments.push(current);
      current = "";
      i++; // 跳过第二个字符
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 引号感知的空白分词：带引号参数合并为单 token（值去引号）。导出供 git-executor
 * 复用（sillyspec 原样代执行的 argv 拆分——单一真相，禁止两份 tokenizer 漂移）。 */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  const chars = Array.from(segment);
  for (const ch of chars) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

/** basename（平台无关：/ 与 \ 都认）。 */
function baseName(token: string): string {
  const i = Math.max(token.lastIndexOf("/"), token.lastIndexOf("\\"));
  return i >= 0 ? token.slice(i + 1) : token;
}

/** 可执行名是否为 git（兼容路径形态与 Windows .exe 后缀）。 */
function isGitBinary(token: string): boolean {
  const b = baseName(token);
  return b === "git" || b === "git.exe";
}

/** 可执行名是否为 sillyspec CLI（兼容 .cmd/.exe shim 形态）。 */
function isSillyspecBinary(token: string): boolean {
  const b = baseName(token);
  return b === "sillyspec" || b === "sillyspec.cmd" || b === "sillyspec.exe";
}

/* ───────────── 单段解析 ───────────── */

/** 解析单个 git 段（tokens[0] 为 git 可执行名）；非 commit/push 返回 null。 */
function parseGitSegment(segment: string, tokens: string[]): GitCommandIntent | null {
  let i = 1;
  let workDir: string | null = null;
  // git 全局参数：仅消费 -C <path>（--git-dir/--work-tree 等 v1 忽略，不影响识别）
  for (;;) {
    const t = tokens[i];
    if (t === undefined || !t.startsWith("-")) break;
    if (t === "-C") {
      const v = tokens[i + 1];
      if (v === undefined) break;
      workDir = v;
      i += 2;
      continue;
    }
    if (t.startsWith("--git-dir=") || t.startsWith("--work-tree=") || t === "--no-pager" || t === "--no-replace-objects") {
      i += 1;
      continue;
    }
    break; // 其它 flag 属于子命令域，交给下方解析
  }
  const sub = tokens[i];
  if (sub === undefined || sub === "") return null;
  const rest = tokens.slice(i + 1);
  if (sub === "commit") return parseCommit(segment, rest, workDir);
  if (sub === "push") return parsePush(segment, rest, workDir);
  return null; // add/status/log/diff/merge/rebase/reset/checkout 等一律不拦（D-003）
}

/** git commit 段解析。 */
function parseCommit(segment: string, rest: string[], workDir: string | null): GitCommandIntent | null {
  let message = "";
  let messageFile: string | null = null;
  let allTracked = false;
  const pathspec: string[] = [];
  let j = 0;
  while (j < rest.length) {
    const t = rest[j];
    if (t === undefined) break;
    if (t === "-m" || t === "--message") {
      const v = rest[j + 1];
      if (v !== undefined) {
        message = message ? `${message} ${v}` : v;
        j += 2;
        continue;
      }
      j += 1;
      continue;
    }
    if (t.startsWith("--message=")) {
      const v = t.slice("--message=".length);
      message = message ? `${message} ${v}` : v;
      j += 1;
      continue;
    }
    if (t.startsWith("-m") && t.length > 2) {
      // -m<msg> 连写形态
      const v = t.slice(2);
      message = message ? `${message} ${v}` : v;
      j += 1;
      continue;
    }
    if (t === "-F" || t === "--file") {
      const v = rest[j + 1];
      if (v !== undefined) messageFile = v;
      j += v !== undefined ? 2 : 1;
      continue;
    }
    if (t.startsWith("--file=")) {
      messageFile = t.slice("--file=".length);
      j += 1;
      continue;
    }
    if (t === "-a" || t === "--all") {
      allTracked = true;
      j += 1;
      continue;
    }
    if (t === "--") {
      // pathspec 分隔符：其后全部是 pathspec
      pathspec.push(...rest.slice(j + 1));
      break;
    }
    if (t.startsWith("-")) {
      // 其它 flag（-q/--no-verify/--amend 等）不拦识别，跳过；带值的常见 flag 跳两格防误收位置参数
      const valued = ["--author", "-c", "-S", "--gpg-sign", "-t", "--template", "--cleanup", "-e", "--editor"];
      if (valued.includes(t) && rest[j + 1] !== undefined) {
        j += 2;
        continue;
      }
      j += 1;
      continue;
    }
    pathspec.push(t);
    j += 1;
  }
  return {
    operation: "commit",
    runner: "git",
    command: segment,
    message,
    messageFile,
    pathspec: pathspec.length > 0 ? pathspec : null,
    allTracked,
    pushTarget: { remote: null, ref: null },
    workDir,
  };
}

/** git push 段解析。 */
function parsePush(segment: string, rest: string[], workDir: string | null): GitCommandIntent | null {
  const positional: string[] = [];
  let j = 0;
  while (j < rest.length) {
    const t = rest[j];
    if (t === undefined || t === "--") break;
    // git push --dry-run 是 git 原生 flag（模拟推送不执行，无推送副作用）——
    // 与 sillyspec push --dry-run 同判据不拦（D-013 一致性，task-07 用例锚定）。
    if (t === "--dry-run") return null;
    if (t.startsWith("-")) {
      // pushspec refspec（如 HEAD:main / origin main）以非 flag 位置参数出现；
      // 带值的常见 flag 跳两格（--repo/-u/--recurse-submodules/--receive-pack/-o/--push-option）
      const valued = ["--repo", "-u", "--recurse-submodules", "--receive-pack", "-o", "--push-option", "--exec"];
      if (valued.includes(t) && rest[j + 1] !== undefined) {
        j += 2;
        continue;
      }
      j += 1;
      continue;
    }
    positional.push(t);
    j += 1;
  }
  // `git push <repo> <refspec>`：第一个位置参数 remote（或 pushspec URL），第二个 refspec
  const remote = positional[0] ?? null;
  const ref = positional[1] ?? null;
  return {
    operation: "push",
    runner: "git",
    command: segment,
    message: "",
    messageFile: null,
    pathspec: null,
    allTracked: false,
    pushTarget: { remote, ref },
    workDir,
  };
}

/** sillyspec push 段解析（D-013/R-09：--dry-run/--no-push/--undo 无推送副作用不拦）。 */
function parseSillyspecSegment(segment: string, tokens: string[]): GitCommandIntent | null {
  if (tokens[1] !== "push") return null;
  const rest = tokens.slice(2);
  let remote: string | null = null;
  let ref: string | null = null;
  let j = 0;
  while (j < rest.length) {
    const t = rest[j];
    if (t === undefined) break;
    if (t === "--dry-run" || t === "--no-push" || t === "--undo") {
      return null; // 无推送副作用，放行（D-013）
    }
    if (t === "--remote" && rest[j + 1] !== undefined) {
      remote = rest[j + 1] as string;
      j += 2;
      continue;
    }
    if (t.startsWith("--remote=")) {
      remote = t.slice("--remote=".length);
      j += 1;
      continue;
    }
    if (t === "--branch" && rest[j + 1] !== undefined) {
      ref = rest[j + 1] as string;
      j += 2;
      continue;
    }
    if (t.startsWith("--branch=")) {
      ref = t.slice("--branch=".length);
      j += 1;
      continue;
    }
    j += 1; // 其余 flag（--mode one/--change <名>/--json 等）不影响拦判定
  }
  return {
    operation: "push",
    runner: "sillyspec",
    command: segment,
    message: "",
    messageFile: null,
    pathspec: null,
    allTracked: false,
    pushTarget: { remote, ref },
    workDir: null,
  };
}

/* ───────────── 对外主函数 ───────────── */

/**
 * 识别一段 shell 命令中的 git 写操作意图（复合命令拆段逐段匹配，首个命中段胜出）。
 * 未命中 / 解析异常一律返回 null（放行原路径，零影响）。
 */
export function detectGitWriteIntent(command: string): GitCommandIntent | null {
  try {
    const segments = splitCommandSegments(command);
    for (const seg of segments) {
      const tokens = tokenize(seg);
      if (tokens.length === 0) continue;
      const head = tokens[0];
      if (head === undefined) continue;
      let intent: GitCommandIntent | null = null;
      if (isGitBinary(head)) {
        intent = parseGitSegment(seg, tokens);
      } else if (isSillyspecBinary(head)) {
        intent = parseSillyspecSegment(seg, tokens);
      }
      if (intent) return intent;
    }
    return null;
  } catch {
    return null; // 纯函数不抛错（task-01 constraints）
  }
}

/**
 * 预填勾选规则（D-012 裁决序）：
 * ① 命令带 pathspec → 勾 pathspec（与工作区改动交集）；
 * ② 带 -a → 勾全部 tracked 改动（非 untracked）；
 * ③ 都无 → 勾当前暂存区（staged）文件；
 * ④ 暂存区空 → 勾全部改动。
 */
export function resolveDefaultSelection(
  intent: GitCommandIntent,
  status: WorkspaceStatus,
): Set<string> {
  const files = status.files ?? [];
  if (intent.pathspec && intent.pathspec.length > 0) {
    const wanted = new Set(intent.pathspec);
    return new Set(files.filter((f) => wanted.has(f.path)).map((f) => f.path));
  }
  if (intent.allTracked) {
    return new Set(files.filter((f) => f.status !== "untracked").map((f) => f.path));
  }
  const staged = files.filter((f) => f.staged);
  if (staged.length > 0) {
    return new Set(staged.map((f) => f.path));
  }
  return new Set(files.map((f) => f.path));
}
