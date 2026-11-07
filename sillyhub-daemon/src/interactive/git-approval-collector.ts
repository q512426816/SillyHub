/**
 * git-approval-collector —— git 审批确认卡的工作区采集器（2026-11-06-session-git-approval task-02）。
 *
 * 职责：对命中工作区只读采集（git status --porcelain=v2 -z --branch + numstat 双口径 +
 * push 态 ahead 提交明细），组装 GitApprovalPayload 数据面（含 task-01 resolveDefaultSelection
 * 预填），按 R-03 容量截断（files>500 仅统计 / 每提交 files>50 截断 / ahead>20 显统计）。
 *
 * 先例与铁律：
 *  - 执行形态对齐 turn-file-changes.ts（GIT_BASE_ARGS 恒带 --no-optional-locks 与
 *    core.quotePath=false；spawn 数组形参不经 shell；execFile 可注入供单测）；
 *  - porcelain v2 的 `1` 条目 path 分隔符是空格不是 \t（知识库实证坑）——本实现用
 *    `-z` NUL 终止条目 + 固定前缀字段数（slice(8).join(" ") 取 path），空格/中文路径天然安全；
 *  - rename（`2` 条目）取 new 路径归 renamed 状态（-z 下 origPath 是随后的独立 NUL 段，跳过）；
 *  - ESM import 带 .js；只读采集不抛裸错（失败面由调用方 task-03 收口）。
 */
import { execFile } from "node:child_process";

import {
  resolveDefaultSelection,
  type GitCommandIntent,
  type WorkspaceStatus,
} from "./git-command-guard.js";

/* ───────────── 类型（GitApprovalPayload 数据面，design 接口定义冻结） ───────────── */

export type GitApprovalFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitApprovalFile {
  path: string;
  status: GitApprovalFileStatus;
  /** 是否在暂存区（agent 已 git add）。 */
  staged: boolean;
  /** 增行数（staged 取 --cached 口径，未暂存取工作区口径）。 */
  addLines: number;
  delLines: number;
}

export interface GitApprovalAheadCommit {
  sha: string;
  subject: string;
  author: string;
  date: string;
  files: { path: string; status: GitApprovalFileStatus; addLines: number; delLines: number }[];
  /** 该提交文件明细被截断（>50）时 true，卡片显示统计行。 */
  filesTruncated?: boolean;
  fileCount?: number;
}

export interface GitApprovalPayload {
  operation: "commit" | "push";
  command: string;
  worktree: string;
  branch: string;
  message: string;
  /** push：remote/ref 展示串（缺省 origin + 当前分支）。 */
  remoteTarget?: string;
  runner?: "git" | "sillyspec";
  /** push：目标分支为 main/master 时 true（D-006 警示数据）。 */
  protectedBranch?: boolean;
  /** push：待推送提交明细（≤20 条；ahead>20 时 aheadTruncated=true）。 */
  aheadCommits?: GitApprovalAheadCommit[];
  aheadTruncated?: boolean;
  aheadCount?: number;
  files: GitApprovalFile[];
  /** 工作区文件清单被截断（>500）时 true——files 仅样本、fileCount 为全量数，卡片显示统计。 */
  filesTruncated?: boolean;
  fileCount?: number;
  /** 采集降级标记（task-03 fail-closed 降级面：采集失败时最小 payload 携带的提示文案）。 */
  collectError?: string;
  defaultSelected: string[];
}

/** 可注入执行器（先例 turn-file-changes.ts defaultExecFile 同方言；测试注入 fixture）。 */
export interface GitApprovalExecFile {
  (args: string[], opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export interface CollectGitApprovalCtx {
  cwd: string;
  sessionId?: string;
  execFile?: GitApprovalExecFile;
  signal?: AbortSignal;
  /** 单条 git 子命令超时（默认 8s）。 */
  timeoutMs?: number;
}

/* ───────────── 常量（先例 GIT_BASE_ARGS 同款） ───────────── */

const GIT_BASE_ARGS = [
  "-c",
  "core.preloadIndex=true",
  "-c",
  "core.quotePath=false",
  "--no-optional-locks",
] as const;

const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

/** R-03 容量截断三档。 */
const MAX_WORKSPACE_FILES = 500;
const MAX_COMMIT_FILES = 50;
const MAX_AHEAD_COMMITS = 20;
/** 采样条数（截断态仍给前端少量样本渲染形态）。 */
const TRUNCATED_SAMPLE_SIZE = 50;

/** push 保护分支（D-006：警示不硬拦）。 */
const PROTECTED_BRANCHES = new Set(["main", "master"]);

/* ───────────── 默认执行器（禁 shell，数组形参） ───────────── */

const defaultExecFile: GitApprovalExecFile = (args, opts) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        signal: opts.signal,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(Object.assign(error, { stderr }));
          return;
        }
        resolvePromise({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

/* ───────────── porcelain v2 -z --branch 解析 ───────────── */

export interface ParsedStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: { path: string; status: GitApprovalFileStatus; staged: boolean; renameFrom?: string }[];
}

/**
 * 解析 `git status --porcelain=v2 -z --branch` 输出。
 * 条目 NUL 终止；`2`（rename）条目的 origPath 是随后的独立 NUL 段（取 new 路径，orig 跳过）。
 */
export function parsePorcelainV2Z(stdout: string): ParsedStatus {
  const segments = stdout.split("\0").filter((s) => s.length > 0);
  const result: ParsedStatus = { branch: "", ahead: 0, behind: 0, files: [] };
  let skipNext = false;
  for (const seg of segments) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (seg.startsWith("# branch.head ")) {
      result.branch = seg.slice("# branch.head ".length);
      continue;
    }
    if (seg.startsWith("# branch.ab ")) {
      const m = /# branch\.ab \+(\d+) -(\d+)/.exec(seg);
      if (m) {
        result.ahead = Number(m[1]);
        result.behind = Number(m[2]);
      }
      continue;
    }
    if (seg.startsWith("# ")) continue; // 其余 header 行（oid/upstream）忽略
    if (seg.startsWith("? ")) {
      result.files.push({ path: seg.slice(2), status: "untracked", staged: false });
      continue;
    }
    if (seg.startsWith("! ")) continue; // ignored 不采集（v1 卡片不含忽略组）
    if (seg.startsWith("1 ") || seg.startsWith("2 ")) {
      const isRename = seg.startsWith("2 ");
      // 固定前缀字段数：1/2 条目均为 8 个空格分隔字段（`<N> XY sub mH mI mW hH hI <path>`），
      // path 从第 9 列起原样拼（空格分隔实证坑的正确解法）。
      const cols = seg.split(" ");
      const xy = cols[1] ?? "..";
      const path = cols.slice(8).join(" ");
      if (!path) continue;
      const staged = xy.length > 0 && xy[0] !== ".";
      const flag = (staged ? xy[0] : xy[1]) ?? "M";
      const status: GitApprovalFileStatus =
        flag === "A" || flag === "C"
          ? "added"
          : flag === "D"
            ? "deleted"
            : flag === "R"
              ? "renamed"
              : "modified";
      const entry: ParsedStatus["files"][number] = { path, status, staged };
      if (isRename) skipNext = true; // 下一个 NUL 段是 origPath（取 new 路径，orig 跳过）
      result.files.push(entry);
      continue;
    }
    if (seg.startsWith("u ")) continue; // unmerged v1 简化跳过（罕见态，卡片以 git-log 页全量兜底）
  }
  return result;
}

/* ───────────── numstat 解析（tab 三列；binary `-`；缺省 0） ───────────── */

export function parseNumstat(stdout: string): Map<string, { addLines: number; delLines: number }> {
  const map = new Map<string, { addLines: number; delLines: number }>();
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const a = cols[0];
    const d = cols[1];
    const path = cols.slice(2).join("\t");
    map.set(path, {
      addLines: a === "-" || a === undefined ? 0 : Number(a) || 0,
      delLines: d === "-" || d === undefined ? 0 : Number(d) || 0,
    });
  }
  return map;
}

/* ───────────── ahead 提交明细解析（name-status 与 numstat 按 sha join） ───────────── */

const FIELD_SEP = "\x1f";

/** 解析 `git log --format=\0<sha>\x1f<subject>\x1f<author>\x1f<date> --name-status`（--max-count=21 探边）。 */
export function parseLogNameStatus(stdout: string): Map<string, {
  sha: string;
  subject: string;
  author: string;
  date: string;
  files: { path: string; status: GitApprovalFileStatus; addLines?: number; delLines?: number }[];
}> {
  const commits = new Map<string, { sha: string; subject: string; author: string; date: string; files: { path: string; status: GitApprovalFileStatus; addLines?: number; delLines?: number }[] }>();
  let current: { sha: string; subject: string; author: string; date: string; files: { path: string; status: GitApprovalFileStatus }[] } | null = null;
  for (const seg of stdout.split("\0")) {
    for (const line of seg.split("\n")) {
      if (!line) continue;
      if (line.includes(FIELD_SEP)) {
        const [sha = "", subject = "", author = "", date = ""] = line.split(FIELD_SEP);
        current = { sha, subject, author, date, files: [] };
        commits.set(sha, current);
        continue;
      }
      if (!current) continue;
      // name-status 行：`M\tpath` / `R100\told\tnew`（tab 分隔；rename 取 new 路径）
      const cols = line.split("\t");
      const raw = cols[0] ?? "";
      if (raw.length === 0) continue;
      const kind = raw[0];
      if (kind === "R" || kind === "C") {
        const newPath = cols[2];
        if (newPath !== undefined) {
          current.files.push({ path: newPath, status: kind === "R" ? "renamed" : "added" });
        }
        continue;
      }
      const path = cols.slice(1).join("\t");
      if (!path) continue;
      const status: GitApprovalFileStatus =
        kind === "A" ? "added" : kind === "D" ? "deleted" : "modified";
      current.files.push({ path, status });
    }
  }
  return commits;
}

/** 解析 `git log --format=\0<sha> --numstat`，为 parseLogNameStatus 的结果回填增删行数。 */
export function applyLogNumstat(stdout: string, commits: Map<string, { files: { path: string; addLines?: number; delLines?: number }[] }>): void {
  let current: { files: { path: string; addLines?: number; delLines?: number }[] } | null = null;
  for (const seg of stdout.split("\0")) {
    for (const line of seg.split("\n")) {
      if (!line) continue;
      if (!line.includes("\t")) {
        current = commits.get(line) ?? null;
        continue;
      }
      if (!current) continue;
      const cols = line.split("\t");
      const a = cols[0];
      const d = cols[1];
      const path = cols.slice(2).join("\t");
      const file = current.files.find((f) => f.path === path);
      if (file) {
        file.addLines = a === "-" || a === undefined ? 0 : Number(a) || 0;
        file.delLines = d === "-" || d === undefined ? 0 : Number(d) || 0;
      }
    }
  }
}

/* ───────────── 主函数 ───────────── */

/** 只读采集并组装 GitApprovalPayload（R-03 三档截断内建）。 */
export async function collectGitApprovalPayload(
  intent: GitCommandIntent,
  ctx: CollectGitApprovalCtx,
): Promise<GitApprovalPayload> {
  const run = ctx.execFile ?? defaultExecFile;
  const cwd = intent.workDir ?? ctx.cwd;
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const opts = { cwd, timeoutMs, signal: ctx.signal };

  const statusOut = await run([...GIT_BASE_ARGS, "status", "--porcelain=v2", "-z", "--branch"], opts);
  const parsed = parsePorcelainV2Z(statusOut.stdout);

  // numstat 双口径：未暂存（工作区 vs index）/ 已暂存（index vs HEAD）。
  const unstagedOut = await run([...GIT_BASE_ARGS, "diff", "--numstat"], opts);
  const stagedOut = await run([...GIT_BASE_ARGS, "diff", "--cached", "--numstat"], opts);
  const unstagedNum = parseNumstat(unstagedOut.stdout);
  const stagedNum = parseNumstat(stagedOut.stdout);

  const allFiles: GitApprovalFile[] = parsed.files.map((f) => {
    const num = f.staged ? stagedNum.get(f.path) : unstagedNum.get(f.path);
    return {
      path: f.path,
      status: f.status,
      staged: f.staged,
      addLines: num?.addLines ?? 0,
      delLines: num?.delLines ?? 0,
    };
  });

  // 预填勾选（D-012 四分支，基于未截断全量状态计算）。
  const workspaceStatus: WorkspaceStatus = {
    files: parsed.files.map((f) => ({
      path: f.path,
      status: f.status === "renamed" ? "modified" : f.status,
      staged: f.staged,
    })),
  };
  const selected = resolveDefaultSelection(intent, workspaceStatus);

  // R-03 截断①：工作区 files>500 → 仅样本 + 统计。
  const filesTruncated = allFiles.length > MAX_WORKSPACE_FILES;
  const files = filesTruncated ? allFiles.slice(0, TRUNCATED_SAMPLE_SIZE) : allFiles;

  const payload: GitApprovalPayload = {
    operation: intent.operation,
    command: intent.command,
    worktree: cwd,
    branch: parsed.branch,
    message: intent.message,
    files,
    defaultSelected: [...selected],
  };
  if (filesTruncated) {
    payload.filesTruncated = true;
    payload.fileCount = allFiles.length;
  }

  if (intent.operation === "push") {
    const remote = intent.pushTarget.remote ?? "origin";
    const ref = intent.pushTarget.ref ?? parsed.branch;
    payload.remoteTarget = `${remote}/${ref}`;
    payload.runner = intent.runner;
    payload.protectedBranch = PROTECTED_BRANCHES.has(ref) || PROTECTED_BRANCHES.has(ref.split("/").pop() ?? "");
    payload.aheadCount = parsed.ahead;

    // ahead 明细（≤20 条；21 条探边显统计）。无上游分支（@{u} 不存在）→ 明细空。
    // git --format 转义语言：NUL/US 分别写 %x00/%x1f（JS 字面 \0 是真实控制字符，
    // 传 execFile 会抛 invalid argument，且 git 不认 JS 转义）。
    const logArgs = (diffArgs: string[]) => [
      ...GIT_BASE_ARGS,
      "log",
      "@{u}..HEAD",
      "--max-count=21",
      ...diffArgs,
    ];
    try {
      const nsOut = await run(
        logArgs(["--format=%x00%H%x1f%s%x1f%an%x1f%ad", "--name-status"]),
        opts,
      );
      const commits = parseLogNameStatus(nsOut.stdout);
      const numOut = await run(logArgs(["--format=%x00%H", "--numstat"]), opts);
      applyLogNumstat(numOut.stdout, commits);
      const list = [...commits.values()];
      payload.aheadTruncated = list.length > MAX_AHEAD_COMMITS;
      payload.aheadCommits = list.slice(0, MAX_AHEAD_COMMITS).map((c) => {
        // R-03 截断②：每提交 files>50 → 截断样本 + 统计。
        const truncated = c.files.length > MAX_COMMIT_FILES;
        const files = (truncated ? c.files.slice(0, TRUNCATED_SAMPLE_SIZE) : c.files).map((f) => ({
          path: f.path,
          status: f.status,
          addLines: f.addLines ?? 0,
          delLines: f.delLines ?? 0,
        }));
        return {
          sha: c.sha,
          subject: c.subject,
          author: c.author,
          date: c.date,
          files,
          ...(truncated ? { filesTruncated: true, fileCount: c.files.length } : {}),
        };
      });
    } catch {
      // 无上游分支等场景：明细缺省（卡片显示 aheadCount 统计），不阻断审批卡。
      payload.aheadCommits = [];
    }
  }

  return payload;
}
