/**
 * git-executor —— git 审批批准后的本机代执行引擎（2026-11-06-session-git-approval
 * task-05 / D-002「不交回 agent 重跑」/ D-013 runner 分流 / D-018 精确重整）。
 *
 * commit 流：porcelain v2 取当前暂存集 → 差集精确重整（reset 仅「已暂存但未勾选」、
 * add 仅「勾选但未暂存」，**禁止裸 reset**——共享工作区其他会话的 staged 文件不被代清，
 * 仓纪「不替别人清理」）→ commit（用户改写 msg 单 argv）→ short sha。
 * push 流：runner=git 代执行 git push；runner=sillyspec 原样代执行 intent.command
 * 命中段（保守 tokenizer 拆 argv，零附加参数；Windows .cmd shim 解析 js 入口经
 * process.execPath 执行——execFile 直跑 .cmd 必 EINVAL）。
 * reject 流：零 git 命令执行（不动暂存区），组拒绝文本返回。
 *
 * 先例与铁律：execFile 数组形参不经 shell（host-fs-handler runCmd:598）+ core.quotepath=false
 *（:750 GIT_QUOTEPATH_OFF_ARGS）+ per-invocation identity 注入（:1254 D-008 机制——
 * headless daemon 无全局 git config 也能提交）；结果文本含实际提交文件集（R-04——
 * agent 据此校准暂存区假设）与 stderr 原样（R-05 credential 差异可感知）。
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";

import { parsePorcelainV2Z } from "./git-approval-collector.js";
import { tokenize, type GitCommandIntent } from "./git-command-guard.js";

/* ───────────── 类型（design 接口定义冻结） ───────────── */

export interface GitExecResult {
  ok: boolean;
  /** 回喂 agent 的结果文本（成功含 sha+文件集；失败含 stderr 原样；拒绝含原因）。 */
  text: string;
  /** commit 成功时的 short sha。 */
  sha?: string;
}

/** 前端回传 GitApprovalResult 的 daemon 侧消费形态（W1 契约冻结结构）。 */
export interface GitApprovalResult {
  action: "approve" | "reject";
  /** 用户改后的 commit msg（approve+commit 必填）。 */
  message: string;
  /** approve+commit：最终勾选文件集。 */
  selectedFiles?: string[];
  /** reject：拒绝原因。 */
  reason?: string;
}

export interface GitExecCtx {
  cwd: string;
  sessionId: string;
  /** 可注入执行器（单测 fixture；默认 execFile 数组形参不经 shell）。 */
  execFile?: GitExecExecFile;
  signal?: AbortSignal;
  /** 单条 git 子命令超时（默认 60s——push 可能慢，宽于采集档）。 */
  timeoutMs?: number;
  /** per-invocation git identity（缺省 agent@sillyhub——与 worker 注入同模式，
   * D-008 机制复用；不依赖宿主全局 config）。 */
  identity?: { name: string; email: string };
}

export interface GitExecExecFile {
  (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
/** 路径分批上限（Windows argv 32K 限制，500 文件×长路径需分批）。 */
const PATH_BATCH = 100;
/** 回喂文件清单上限（防超长文本刷屏）。 */
const MAX_LIST_LINES = 50;
/** git identity 缺省（与 host-fs-handler worker 注入同模式，agent 可追溯）。 */
const DEFAULT_IDENTITY = { name: "agent", email: "agent@sillyhub" } as const;

const defaultExecFile: GitExecExecFile = (cmd, args, opts) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      cmd,
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

/* ───────────── 小工具 ───────────── */

function identityArgs(identity: { name: string; email: string }): string[] {
  return ["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`];
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as Error & { stderr?: string }).stderr;
    return stderr && stderr.length > 0 ? stderr : err.message;
  }
  return String(err ?? "unknown error");
}

function listLines(paths: string[]): string {
  const shown = paths.slice(0, MAX_LIST_LINES).map((p) => `- ${p}`);
  if (paths.length > MAX_LIST_LINES) {
    shown.push(`- …（共 ${paths.length} 个文件，已省略 ${paths.length - MAX_LIST_LINES} 条）`);
  }
  return shown.join("\n");
}

/** 分批执行带路径列表的命令（reset/add；argv 长度限制）。 */
async function runPathBatches(
  run: (args: string[]) => Promise<unknown>,
  verb: string,
  paths: string[],
): Promise<void> {
  for (let i = 0; i < paths.length; i += PATH_BATCH) {
    await run(["--", ...paths.slice(i, i + PATH_BATCH)]);
    void verb;
  }
}

/* ───────────── Windows .cmd shim 解析（runner=sillyspec） ───────────── */

/**
 * 解析 npm cmd-shim 指向的 js 入口（Windows：execFile 直跑 .cmd 必 EINVAL/ENOENT）。
 * shim 标准模板含 `"%dp0%\\node_modules\\<pkg>\\...\\.js"` 行——正则抓相对入口，
 * 相对 shim 目录解析绝对路径。找不到返回 null（按失败回喂，不猜）。
 */
export function resolveCmdShimJsEntry(command: string): string | null {
  if (process.platform !== "win32") return null;
  // 仅处理裸命令名（含路径形态不解析——PATH 查找超 v1 边界，失败回喂可感知）。
  if (command.includes("/") || command.includes("\\")) return null;
  const pathEnv = process.env.PATH ?? "";
  const exts = [".cmd", ".CMD"];
  for (const dir of pathEnv.split(";")) {
    if (!dir) continue;
    for (const ext of exts) {
      const shim = pathResolve(dir, command + ext);
      if (!existsSync(shim)) continue;
      try {
        const content = readFileSync(shim, "utf8");
        const m = /node_modules[\\/]([^"'\r\n]+\.js)/i.exec(content);
        if (m) return pathResolve(dirname(shim), "node_modules", m[1]!.replace(/\\/g, "/"));
      } catch {
        // 读失败按未命中继续找
      }
    }
  }
  return null;
}

/* ───────────── 主函数 ───────────── */

/** 代执行入口（task-06 分发调用）。任何失败 ok=false 且 text 含原因（不抛出）。 */
export async function executeGitApproval(
  intent: GitCommandIntent,
  result: GitApprovalResult,
  ctx: GitExecCtx,
): Promise<GitExecResult> {
  const run = ctx.execFile ?? defaultExecFile;
  const cwd = intent.workDir ?? ctx.cwd;
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const opts = { cwd, timeoutMs, signal: ctx.signal };
  const git = (args: string[]) => run("git", ["-c", "core.quotepath=false", "--no-optional-locks", ...args], opts);

  // reject：零 git 命令（不动暂存区，D-007/D-018 拒绝路径）。
  if (result.action === "reject") {
    const opLabel = intent.operation === "commit" ? "提交" : "推送";
    const reason = result.reason && result.reason.length > 0 ? result.reason : "未提供原因";
    return {
      ok: false,
      text: `❌ 用户拒绝了本次${opLabel}：${reason}。暂存区未改动；可调整提交信息或文件范围后重新发起。`,
    };
  }

  try {
    if (intent.operation === "commit") {
      return await executeCommit(intent, result, { run, git, opts, identity: ctx.identity ?? DEFAULT_IDENTITY });
    }
    return await executePush(intent, { run, git, opts, cwd });
  } catch (err) {
    return {
      ok: false,
      text: `❌ git 代执行失败（${intent.operation}）：${errText(err)}`,
    };
  }
}

interface ExecPass {
  run: GitExecExecFile;
  git: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  opts: { cwd: string; timeoutMs: number; signal?: AbortSignal };
}

/** commit 流：精确重整（D-018）→ commit → short sha + 文件集文本（R-04）。 */
async function executeCommit(
  intent: GitCommandIntent,
  result: GitApprovalResult,
  p: ExecPass & { identity: { name: string; email: string } },
): Promise<GitExecResult> {
  const selected = new Set(result.selectedFiles ?? []);

  // 当前暂存集（porcelain v2 -z，与采集器同一解析器——单一真相）。
  const statusOut = await p.git(["status", "--porcelain=v2", "-z"]);
  const parsed = parsePorcelainV2Z(statusOut.stdout);
  const staged = new Set(parsed.files.filter((f) => f.staged).map((f) => f.path));

  // 差集精确重整：reset 仅「已暂存但未勾选」、add 仅「勾选但未暂存」。
  const toUnstage = [...staged].filter((f) => !selected.has(f));
  const toAdd = [...selected].filter((f) => !staged.has(f));
  await runPathBatches((args) => p.git(["reset", "-q", ...args]), "reset", toUnstage);
  await runPathBatches((args) => p.git(["add", ...args]), "add", toAdd);

  // 提交（用户改写 msg 单 argv；identity per-invocation 注入）。
  await p.git([...identityArgs(p.identity), "commit", "-m", result.message]);

  // short sha（提交后采集；失败不阻断成功语义）。
  let sha: string | undefined;
  try {
    const rev = await p.git(["rev-parse", "--short", "HEAD"]);
    sha = rev.stdout.trim();
  } catch {
    sha = undefined;
  }

  const fileList = [...selected];
  return {
    ok: true,
    sha,
    text: `✅ 已提交${sha ? ` ${sha}` : ""}：${result.message}（${fileList.length} 个文件，由用户在确认卡上批准）\n${listLines(fileList)}`,
  };
}

/** push 流：runner 分流（git=显式 push / sillyspec=原样代执行，D-013）。 */
async function executePush(
  intent: GitCommandIntent,
  p: ExecPass & { cwd: string },
): Promise<GitExecResult> {
  if (intent.runner === "sillyspec") {
    // 原样代执行：intent.command 经保守 tokenizer 拆 argv（零附加参数；原命令带
    // --json 回 json 输出，否则人类可读——输出原样回喂）。不经 shell。
    const argv = tokenize(intent.command);
    if (argv.length === 0) {
      return { ok: false, text: "❌ git 代执行失败（push）：无法解析命令" };
    }
    const out = await runSillyspec(p, argv);
    return {
      ok: true,
      text: `✅ 已由平台代执行推送（sillyspec push，压扁语义保留）：\n${out.trim()}`,
    };
  }
  // runner=git：缺省补 origin + 当前分支。
  const remote = intent.pushTarget.remote ?? "origin";
  let ref = intent.pushTarget.ref;
  if (!ref) {
    const rev = await p.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    ref = rev.stdout.trim() || "HEAD";
  }
  const out = await p.git(["push", remote, ref]);
  return {
    ok: true,
    text: `✅ 已推送到 ${remote}/${ref}（由用户在确认卡上批准）${out.stderr ? `\n${out.stderr.trim()}` : ""}`,
  };
}

/** sillyspec 命令执行（Windows .cmd shim → js 入口经 process.execPath）。 */
async function runSillyspec(p: ExecPass, argv: string[]): Promise<string> {
  const head = argv[0]!;
  const rest = argv.slice(1);
  const bare = head.replace(/^.*[\\/]/, "").replace(/\.(cmd|exe)$/i, "");
  if (bare !== "sillyspec") {
    throw new Error(`runner=sillyspec 但命令头非 sillyspec：${head}`);
  }
  if (process.platform === "win32" && !head.toLowerCase().endsWith(".exe")) {
    const jsEntry = resolveCmdShimJsEntry("sillyspec");
    if (!jsEntry) {
      throw new Error("Windows 下未能在 PATH 解析 sillyspec cmd-shim 的 js 入口（.cmd 无法被 execFile 直跑）");
    }
    const r = await p.run(process.execPath, [jsEntry, ...rest], p.opts);
    return r.stdout || r.stderr;
  }
  const r = await p.run(head, rest, p.opts);
  return r.stdout || r.stderr;
}
