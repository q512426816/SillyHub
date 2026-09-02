/**
 * `host_fs.*` RPC handler —— daemon 端宿主文件系统操作委托（task-03 / FR-02 + task-02 P3 run_command）。
 *
 * 实现 design §5.2 的 daemon 侧 host_fs handler：接收 backend 经 per-daemon WS
 * （DaemonWsHub.send_rpc）转发的 `host_fs.<method>` 请求，在宿主（Windows / Linux / macOS）
 * 执行 stat / read_file / list_dir / git_apply / git_rev_parse / pollution_archive /
 * read_package_json / read_local_yaml / run_command / read_agent_log_messages 十方法，
 * 返回结构化结果。
 *
 * **职责定位**：
 *   - 本模块是 host_fs 业务层，由 daemon.ts 包装成 RpcHandler 注册到 WsClient
 *     （与 file-rpc.ts:listDir 同模式）。
 *   - ws-client.ts 只收发分发，不内嵌 fs/git 逻辑（design 职责分离）。
 *   - complete_lease 收尾的 3 个宿主操作（apply_patch / post_scan / stage_callback）
 *     经 backend HostFsDelegate（task-01）+ ws_rpc（task-02）调到本 handler。
 *
 * **每方法统一骨架**（task-03 implementation 第 2 点）：
 *   1. `assertWithinAllowedRoots` 白名单守卫（复用 file-rpc.ts，防 path 穿越到宿主敏感路径）。
 *   2. 执行宿主操作（fs / git child_process）。
 *   3. `toRpcError` 兜底（fs 错误码 → 稳定 RpcError code；git 命令失败结构化回传不抛）。
 *
 * **复用关系**（spike-01 选型 + task-03 constraints 第 7 条）：
 *   - `assertWithinAllowedRoots`：直接 import file-rpc.ts（白名单校验，D-002 穿越防护）。
 *   - `listDir`：直接 import file-rpc.ts 并 re-export 到 HostFsHandler.list_dir 契约
 *     （已实现 + 有测试，零行为变更）。
 *   - `toRpcError`：file-rpc.ts 内为模块私有（未 export），本模块本地实现一份等价映射
 *     （fs 错误码 → RpcError code，逻辑与 file-rpc.ts:196-209 字符级对齐），不污染
 *     file-rpc.ts 的单一职责（list_dir 专属）。
 *
 * **D-008 幂等契约**（task-03 constraints 第 1 条 / 支撑 task-04 patch_id 去重）：
 *   git_apply 先跑 `git apply --check`：
 *     - check 通过 + patch 已含于工作树（再 apply 会报错）→ `skipped:true` 不重复 apply。
 *     - check 通过 + 需写入 → 跑 `git apply`。
 *     - check 失败 + use_3way → `git apply --3way` 兜底。
 *     - 仍失败 → `{ok:false, conflict_detail:<stderr>}`，**不抛**（结构化回传让 backend
 *       判定 PatchConflictError）。
 *
 * **跨平台路径**（task-03 constraints 第 3 条）：
 *   - assertWithinAllowedRoots 内部已做 Windows 盘符大小写归一 + 反斜杠处理（file-rpc.ts:82-95）。
 *   - git 命令用 `execFile`（非 shell）+ `cwd:workdir`，不依赖 shell，防注入。
 *
 * **task-01（2026-08-25-workspace-git-log）git 只读四方法**：gitLog / gitRefs /
 *   gitShow / gitDiffFile（design §5.2 四方法命令表 + §7.2 RPC 契约）。实现同骨架
 *   （assertWithinAllowedRoots 白名单守卫 → runCmd('git', args) 独立 argv → 失败
 *   结构化回传不抛），但经 daemon.ts **平名注册**（git_log / git_refs / git_show /
 *   git_diff_file，不走 host_fs. 前缀通道，CC-02），供 backend git_log 模块直连消费。
 *   全部只读子命令（log / for-each-ref / show / rev-parse），空仓库捕获转空态（CC-17）。
 *
 * **task-01（2026-08-26-workspace-git-status）git_status 第 5 个平名 git 方法**
 *   （Grill CC-11 更正计数）：十四字段只读状态（branch/detached/upstream/ahead/
 *   behind/dirty 三计数/head_short/empty + fetch 降级双字段 + error，design §5.2 /
 *   §7.2）。骨架同上（root 唯一入参 + 只读子命令 fetch/remote/status/diff 独立
 *   argv）；差异仅 fetch：runCmd 超时丢弃 killed/signal 无法判超时 → 改用本文件
 *   runCommand 同款局部 execFile（15s 超时，Grill CC-02），失败记 fetch_error
 *   不阻断后续采集。
 *
 * **非目标**：
 *   - 不做权限精细化裁决（per-runtime PolicyEngine 是 list_dir 专属；host_fs 走 daemon
 *     实体级 allowed_roots，与 list_dir RPC handler 等价）。
 *   - 不做 patch_id 去重本身（task-04 D-008 职责；本 handler 只提供 skipped 信号）。
 *   - 不做 RPC 协议匹配（rpc_id 匹配由 task-02 backend 侧 + ws-client.ts:_dispatchRpc 负责）。
 *
 * @module host-fs-handler
 */

import { lstat, readFile, readdir, rename, mkdir } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve as pathResolve } from 'node:path';
import yaml from 'js-yaml';
import { RpcError } from './ws-client.js';
import {
  assertWithinAllowedRoots,
  listDir,
  toRpcError,
  type ListDirResult,
} from './file-rpc.js';
import { getAgentLogParser, type AgentLogMessagesResult } from './agent-log/registry.js';
import { DEFAULT_MAX_CONTENT_BYTES } from './agent-log/parse-zcode-model-io.js';

// ── 类型定义（与 backend HostFsDelegate / design §7 三端对齐）─────────────────

/** stat 返回结构：`{ exists, is_dir, size }`（不存在 → `{exists:false}`，不抛）。 */
export interface StatResult {
  exists: boolean;
  is_dir: boolean;
  size: number;
}

/** git_apply 返回结构：`{ ok, conflict_detail, skipped }`（D-008 幂等 + task-04 消费）。 */
export interface GitApplyResult {
  /** apply 是否成功（含 skipped 场景算成功：幂等目标已达成）。 */
  ok: boolean;
  /** 冲突详情（check/3way 失败时的 stderr；成功时为空串）。 */
  conflict_detail: string;
  /** 是否跳过实际 apply（patch 已含于工作树，幂等命中）。 */
  skipped: boolean;
}

// ── task-02 worktree 三方法返回结构（design §7 RPC 表 + §7.5 契约表）──────────────

/**
 * 单个冲突文件描述（git_merge 解析 `git diff --name-only --diff-filter=U` 输出 +
 * 读冲突标记行数 `<<<<<<< / ======= / >>>>>>>`，喂主 agent LLM 解决）。
 */
export interface MergeConflict {
  /** 冲突文件相对路径（git diff --name-only 输出的相对路径，原样回传）。 */
  file: string;
  /** 文件内冲突标记行数（<<<<<<< / ======= / >>>>>>> 总行数，≥2 才算真冲突）。 */
  marker_lines: number;
}

/**
 * git_worktree_add 返回结构（design §7：`{ ok, worktree_path, error }`）。
 *
 *   - 成功：`{ ok:true, worktree_path: <sibling_path>, error: undefined }`。
 *   - 失败（git exit 非 0）：`{ ok:false, worktree_path: undefined, error: <stderr> }`
 *     （**不抛**，结构化回传让 backend 标 worker run failed，不崩 mission）。
 */
export interface GitWorktreeAddResult {
  ok: boolean;
  /** 成功时的副本绝对路径；失败时缺省。 */
  worktree_path?: string;
  /** 失败时的 git stderr 文案；成功时缺省。 */
  error?: string;
}

/**
 * git_merge 返回结构（design §7：`{ ok, conflicts, merged_files, error }`）。
 *
 *   - 成功：`{ ok:true, conflicts:[], merged_files?: [...] }`。
 *   - 冲突（exit 1 + 冲突文件）：`{ ok:false, conflicts:[{file,marker_lines}], merged_files:[] }`。
 *
 * `merged_files` 字段对齐 design §7 返回结构；当前实现不解析（git merge --no-ff 成功
 * 时 stdout 非结构化），缺省回空数组，留 backend consume 时降级用 conflicts 判定。
 */
export interface GitMergeResult {
  ok: boolean;
  /** 冲突文件列表（成功为 []，失败且无冲突识别也为 []）。 */
  conflicts: MergeConflict[];
  /** 成功合并的文件列表（当前实现回 []，留扩展）。 */
  merged_files: string[];
  /** 失败时的错误文案；成功时缺省。 */
  error?: string;
}

/**
 * git_worktree_remove 返回结构（design §7：`{ ok, error }` + ql-20260902-001 分支删除结果）。
 *
 *   - 成功：`{ ok:true }`；带 branch 参时 `{ ok:true, branch_deleted:true/false }`。
 *   - 失败：`{ ok:false, error: <stderr> }`（不抛，结构化回传；backend cleanup 路径
 *     失败仅记 warning，不阻塞 mission 收尾，对齐 design §9 兼容策略）。
 *   - `branch_deleted:false`：目录已删（ok=true）但 `git branch -D` 失败，error 带
 *     失败文案——分支残留不影响清理主体，仅记日志。
 */
export interface GitWorktreeRemoveResult {
  ok: boolean;
  /** 失败 / branch_deleted:false 时的 git stderr 文案。 */
  error?: string;
  /** 带 branch 参时回传：true=分支已删；false=best-effort 删除失败（目录已删）。 */
  branch_deleted?: boolean;
}

/** git_rev_parse 返回结构：`{ commit, error }`（非 git 仓库 → commit=null + error 文案）。 */
export interface GitRevParseResult {
  /** HEAD commit hash；非 git 仓库 / git 不可用时为 null。 */
  commit: string | null;
  /** 失败原因代号（not_git_repo / git_timeout / git_not_found / <exception str>）；成功为 null。 */
  error: string | null;
}

// ── task-01（2026-08-25-workspace-git-log）git 只读四方法返回结构（design §7.2）──

/** git_log / git_show 共用的单条 commit 记录（%x00 分隔 8 字段的解析产物）。 */
export interface GitLogCommit {
  /** 全长哈希（%H）。 */
  hash: string;
  /** 短哈希（%h）。 */
  short: string;
  /** 父提交哈希列表（%P 按空格切分；根提交为 []）。 */
  parents: string[];
  /** 作者名（%an）。 */
  author_name: string;
  /** 作者邮箱（%ae）。 */
  author_email: string;
  /** 作者时间 ISO 8601（%aI）。 */
  author_date: string;
  /** 提交者时间 ISO 8601（%cI）。 */
  committer_date: string;
  /** message 全文（%B，内部多行保留、去尾部换行）。 */
  message: string;
}

/** git_log 返回结构：`{ commits, truncated, error }`（design §7.2）。 */
export interface GitLogResult {
  /** 提交列表（新→旧，git log 输出序）。 */
  commits: GitLogCommit[];
  /** true = 达到 -n 上限（可能还有更多提交）或存在解析跳过（结果不完整）。 */
  truncated: boolean;
  /** 失败文案；成功 / 空仓库空态为 null。 */
  error: string | null;
}

/** git_refs 单条 ref 记录（for-each-ref 解析产物）。 */
export interface GitRefEntry {
  /** 完整 ref 名（refs/heads/main 等）。 */
  name: string;
  /** 短名（%(refname:short)，如 main / origin/main / v1.0.0）。 */
  short: string;
  /** 指向的 commit sha（annotated tag 取 peeled，CC-04）。 */
  sha: string;
  /** ref 类别（按 refname 前缀判定）。 */
  kind: 'branch' | 'remote' | 'tag';
}

/** git_refs 返回结构：`{ refs, head, error }`（design §7.2）。 */
export interface GitRefsResult {
  refs: GitRefEntry[];
  /** HEAD commit sha；空仓库 / 解析失败为 null（CC-17 空态）。 */
  head: string | null;
  /** 失败文案；成功 / 空仓库空态为 null。 */
  error: string | null;
}

/** git_show 单个变更文件（--numstat 行解析产物）。 */
export interface GitShowFileEntry {
  /** 仓库相对路径（numstat 原样保留，含空格；特殊字符保持 git C 引号形态）。 */
  path: string;
  /** 新增行数；二进制为 null。 */
  add: number | null;
  /** 删除行数；二进制为 null。 */
  del: number | null;
  /** 是否二进制文件（numstat `-` 行）。 */
  binary: boolean;
}

/** git_show 返回结构：`{ commit, files, error }`（design §7.2）。 */
export interface GitShowResult {
  /** 提交详情；命令失败为 null。 */
  commit: GitLogCommit | null;
  files: GitShowFileEntry[];
  /** 失败文案；成功为 null。 */
  error: string | null;
}

/** git_diff_file 返回结构：`{ diff, truncated, binary, error }`（design §7.2）。 */
export interface GitDiffFileResult {
  /** unified diff 文本（git show 原样 stdout；超限截断）。 */
  diff: string;
  /** true = 超 64KB 截断（CC-05 独立选定上限）。 */
  truncated: boolean;
  /** true = 二进制文件（stdout 含 "Binary files"）。 */
  binary: boolean;
  /** 失败文案；成功为 null。 */
  error: string | null;
}

// ── task-01（2026-08-26-workspace-git-status）git_status 返回结构（design §7.2 十四字段）──

/**
 * git_status 返回结构：十四字段与 design §7.2 逐字一致
 * （branch/detached/upstream/ahead/behind/files_changed/additions/deletions/
 * untracked_count/head_short/empty/fetch_performed/fetch_error/error）。
 *
 * 空仓库（branch.oid == "(initial)"）空态：empty=true，branch/upstream/ahead/
 * behind/files_changed/additions/deletions/untracked_count/head_short 全 null
 * （前端空态提示「仓库还没有任何提交」，design §5.2）。
 */
export interface GitStatusResult {
  /** 当前分支名；detached HEAD 时为 head_short（§5.2 detached 形态）；空仓库/失败为 null。 */
  branch: string | null;
  /** 是否 detached HEAD（porcelain `# branch.head (detached)`）。 */
  detached: boolean;
  /** upstream 跟踪名（如 origin/main）；无 upstream / 空仓库为 null。 */
  upstream: string | null;
  /** 未推送提交数（`# branch.ab +A`）；无 upstream / 空仓库为 null。 */
  ahead: number | null;
  /** 远程新提交数（`# branch.ab -B`，fetch 后新鲜）；无 upstream / 空仓库为 null。 */
  behind: number | null;
  /** 未提交改动文件数（≡ numstat 行数，CC-05 单源）；空仓库 / diff 失败为 null。 */
  files_changed: number | null;
  /** 未提交新增行数（numstat 求和，二进制 `-` 行不计）；空仓库 / diff 失败为 null。 */
  additions: number | null;
  /** 未提交删除行数（numstat 求和，二进制 `-` 行不计）；空仓库 / diff 失败为 null。 */
  deletions: number | null;
  /** untracked 文件数（porcelain `? ` 条目，CC-05 单源化后唯一职责）；空仓库 / 失败为 null。 */
  untracked_count: number | null;
  /** HEAD 短哈希（`# branch.oid` 前 8 位截断，CC-04）；空仓库为 null。 */
  head_short: string | null;
  /** 空仓库判据（branch.oid == "(initial)"，兼作 CC-07 diff 容错语境）。 */
  empty: boolean;
  /** fetch 是否实际执行成功（D-001 自动 fetch 语义）。 */
  fetch_performed: boolean;
  /** fetch 失败代号：fetch_timeout | fetch_failed | no_remote | null（失败不阻断其余字段）。 */
  fetch_error: string | null;
  /** 整体失败文案（porcelain / numstat 真失败）；成功 / 空态为 null。 */
  error: string | null;
}

/** pollution_archive 返回结构（对齐 backend post_scan_validator._archive_and_clean_pollution）。 */
export interface PollutionArchiveResult {
  /** 是否成功归档（source 不存在 / 空也算 false，但不抛）。 */
  archived: boolean;
  /** 归档目标路径；未归档时为 null。 */
  archive_path: string | null;
  /** 归档文件数（source 下 .sillyspec 树的文件总数）。 */
  file_count: number;
  /** 归档失败时的错误文案；成功时缺省。 */
  error?: string;
}

/** read_package_json / read_local_yaml 返回 dict | null（不存在 → null）。 */
export type ReadDictResult = Record<string, unknown> | null;

/**
 * run_command 返回结构（task-02 / design §7 + backend HostFsDelegate.run_command 契约，
 * 三端字段级对齐）。
 *
 *   - `exit_code`：子进程 exit code（0=成功 / 124=超时 / 126=命令被白名单拒绝 / 命令自身退出码）。
 *   - `stdout` / `stderr`：子进程标准输出/错误（utf8 字符串）。
 *   - `duration_ms`：从方法入口到 callback 回来的墙钟耗时（Date.now 差值）。
 *
 * **不抛**：白名单拒绝、超时、子进程非 0 退出都结构化回传（让 backend 记审计/决策，
 * 与 git_apply D-008 不抛语义一致）。cwd 越界是安全守卫，仍抛 forbidden（RpcError）。
 */
export interface RunCommandResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

/** run_command 入参（对齐 design §7 / task-01 backend HostFsDelegate.run_command 契约）。 */
export interface RunCommandParams {
  /** 可执行命令（白名单只允 `sillyspec`）。 */
  command: string;
  /** 命令参数（白名单约束为 gate 模板形状）。 */
  args: string[];
  /** 工作目录（先过 assertWithinAllowedRoots 防穿越）。 */
  cwd: string;
  /** execFile 超时（ms，透传调用方值，不写死；超时 → exit_code 124）。 */
  timeout: number;
  /** 环境变量覆盖（合并到 process.env 之上，不清空 PATH）；null/空走默认环境。 */
  env: Record<string, string> | null;
}

/**
 * HostFsHandler 构造参数：daemon 实体级 allowed_roots（与 list_dir RPC handler 同源，
 * 取自 DaemonConfig.allowed_roots）。每方法调 assertWithinAllowedRoots 时透传。
 */
export interface HostFsHandlerOptions {
  rootsProvider: () => string[];
}

// ── toRpcError（本地实现，逻辑与 file-rpc.ts:196-209 等价）─────────────────────
//
// spike-01 / task-03 蓝图说复用 file-rpc.ts:toRpcError，但该函数在 file-rpc.ts 是
// 模块私有（未 export，仅服务 listDir）。本模块为 host_fs 九方法的 fs 错误兜底，
// 复制一份等价映射（fs errno → RpcError code），保持 file-rpc.ts 单一职责不被破坏。
// 映射规则与 file-rpc.ts:196-209 / listDir 错误码语义字符级对齐，确保跨模块一致。

/**
 * 把 fs 错误映射成稳定的 RpcError code（task-03 验收：tsc 严格类型 + 不抛 unknown）。
 *
 *   - ENOENT / ENOTDIR → `not_found`
 *   - EACCES / EPERM   → `internal`（message 统一 "permission denied"，不泄漏详情）
 *   - 其他              → `internal`（原 message 透传，便于排查）
 *
 * `where` 前缀（如 `'stat.lstat'`）便于日志定位。
 * DA-13（2026-08-20 审计）：本地复制实现删除，直接复用 file-rpc.ts 的导出
 * （原注释自述「复制一份等价映射…字符级对齐」——任何一侧改动即漂移）。
 */

// ── run_command 命令白名单（task-02 / R3 / AC-8）─────────────────────────────
//
// 现有 8 方法靠 assertWithinAllowedRoots（路径白名单）防穿越；run_command 要在宿主
// 跑命令，需命令白名单（design §5.3「命令白名单安全层」新抽象）。判定规则与 task-01
// backend 侧 delegate.py:_enforce_command_whitelist **字符级对齐**（同一 gate 模板
// 复制两份，双端必须一致否则 backend 放行的 args daemon 侧被拒 → gate 永远跑不了）：
//
//   只允 command === 'sillyspec' 且 args 头部精确匹配
//     `['gate', 'verify', '--change', <changeName>, '--json']`（changeName 任意非空，
//     字符集不约束——gate 任务已对 change_id 做来源校验，白名单只守结构，与 backend
//     delegate.py:792 `or not head[3]` 一致），尾部可追加白名单 flag（当前仅 `--stage`，
//     必须成对 flag+value，value 字符集不约束，与 backend delegate.py:799-815 一致）。
//
// execFile 非 shell（host-fs-handler 内调用）是第二道防线：即便白名单漏放，也无法
// 经 shell 拼接注入（命令与参数分立传递）。backend 层是第一道防线（RPC 前拦截）。

/** gate verify 模板头部固定前缀长度（= `["gate","verify","--change",<name>,"--json"]`）。 */
const GATE_VERIFY_PREFIX_LEN = 5;

/**
 * gate verify 尾部允许的 flag 白名单（design §5.3：stage 枚举等已知 flag）。
 * 新增 gate 模板参数需在此登记，否则 run_command 拒绝（R3 防任意命令注入）。
 * 与 backend delegate.py:684 `_GATE_VERIFY_TAIL_FLAG_WHITELIST` 字符级对齐。
 */
const GATE_VERIFY_TAIL_FLAG_WHITELIST: ReadonlySet<string> = new Set(['--stage']);

/**
 * 判定 run_command 请求是否命中 gate 模板白名单（task-02 / R3 / AC-8）。
 *
 * **与 task-01 backend delegate.py:_enforce_command_whitelist 字符级对齐**：
 *   - command 必须严格等于 `'sillyspec'`（不允许带路径，防 `../evil/sillyspec`）。
 *   - args 长度 >= 5（前缀 5 + 尾部成对 flag+value）。
 *   - 头部 5 元素精确匹配：`['gate', 'verify', '--change', <非空 changeName>, '--json']`
 *     （changeName 任意非空字符串，字符集不约束，与 backend `or not head[3]` 一致）。
 *   - 尾部 args 成对消费：每个 flag 必须在 GATE_VERIFY_TAIL_FLAG_WHITELIST 内且必须
 *     带值（flag + value 成对，无值则拒），value 字符集不约束（与 backend delegate.py:799-815 一致）。
 *
 * 非命中（rm / ls / sillyspec derive / 乱序 flag / 未知 flag / 缺值 flag）→ false，
 * 由 runCommand 返回 exit_code 126（不执行，结构化回传）。
 */
export function isGateCommand(command: string, args: string[]): boolean {
  if (command !== 'sillyspec') return false;
  if (!Array.isArray(args)) return false;
  if (args.length < GATE_VERIFY_PREFIX_LEN) return false;

  // 头部结构精确匹配：args[0..2] + args[4] 固定 token，args[3] 为任意非空 changeName
  //（与 backend delegate.py:787-793 一致——changeName 只守非空，不约束字符集）。
  if (
    args[0] !== 'gate' ||
    args[1] !== 'verify' ||
    args[2] !== '--change' ||
    args[4] !== '--json' ||
    !args[3]
  ) {
    return false;
  }

  // 尾部 flag 必须在白名单内且成对 flag+value（与 backend delegate.py:800-815 一致）。
  const tail = args.slice(GATE_VERIFY_PREFIX_LEN);
  let i = 0;
  while (i < tail.length) {
    const flag = tail[i];
    if (typeof flag !== 'string' || !GATE_VERIFY_TAIL_FLAG_WHITELIST.has(flag)) {
      return false;
    }
    // 白名单 flag 需带值（--stage <value>）——成对消费，无值则拒。
    if (i + 1 >= tail.length) return false;
    // value（tail[i+1]）字符集不约束（与 backend 一致，gate 任务负责值校验）。
    i += 2;
  }
  return true;
}

// ── execFile 封装 + git 命令统一执行器 ────────────────────────────────────────
//
// 不用 promisify(execFile)：@types/node 对 promisify 重载的返回类型推断在 Buffer/string
// 分支上不够精确（stdout/stderr 类型导致 .toString('utf8') 报 "Expected 0 arguments"）。
// 直接用 callback 形式，类型显式可控。

/** execFile 超时——轻量 git 命令（rev-parse / apply 等，对齐 backend post_scan_validator 的 10s + patch/service.py 子进程语义）。 */
const GIT_TIMEOUT_MS = 10_000;

/**
 * worktree 级重命令超时（add 全量检出 / merge / remove 批量删档）。
 * ql-20260902-001：大仓库全量检出是 IO 型操作，Windows 冷缓存 + 杀毒实时扫描下
 * 10s 必杀（F:\WorkNew\SillyHub 7705 文件实证 worktree add 10.0s 被杀 → 分身
 * worktree_create_failed 派发必败，git stderr 只剩进度条无 fatal 行）。轻命令维持
 * GIT_TIMEOUT_MS，仅 worktree 三命令抬到 120s。
 */
const GIT_WORKTREE_TIMEOUT_MS = 120_000;

/** execFile 调用结果（buffer 自行 toString，类型显式）。 */
interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * 执行一条命令（execFile 非 shell，防注入），喂 stdin + 收 stdout/stderr。
 * 超时 / exit!=0 → ok:false（不抛，由调用方判定结构化返回）。
 */
function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout)
          ? stdout.toString('utf8')
          : stdout ?? '';
        const errOut = Buffer.isBuffer(stderr)
          ? stderr.toString('utf8')
          : stderr ?? '';
        if (err) {
          resolve({ ok: false, stdout: out, stderr: errOut });
        } else {
          resolve({ ok: true, stdout: out, stderr: errOut });
        }
      },
    );
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        /* EPIPE if child exited before reading stdin — ignore, exit code captures it. */
      });
      child.stdin.end(opts.input);
    }
  });
}

/**
 * git apply 子命令统一执行器（对齐 backend patch/service.py:144-161 _run_git_apply）。
 *
 * @param workdir     工作目录（cwd，execFile 非 shell，防注入）。
 * @param args        git 子命令参数（如 `['apply', '--check']`）。
 * @param patchData   stdin 输入（unified diff）。
 * @returns `{ ok, stderr }`——ok=exit code 0；stderr 去首尾空白。
 */
async function runGitApply(
  workdir: string,
  args: string[],
  patchData: string,
): Promise<{ ok: boolean; stderr: string }> {
  const r = await runCmd('git', args, {
    cwd: workdir,
    timeout: GIT_TIMEOUT_MS,
    input: patchData,
  });
  return { ok: r.ok, stderr: r.stderr.trim() };
}

/**
 * git rev-parse HEAD（对齐 backend post_scan_validator._get_source_commit）。
 *
 * 含 safe.directory dubious ownership 重试：detected 时跑 `git config --global --add
 * safe.directory <root>` 再重试一次 rev-parse（与 Python 等价）。
 */
async function runGitRevParse(
  root: string,
  ref: string = 'HEAD',
): Promise<{ commit: string | null; error: string | null }> {
  async function tryOnce(): Promise<{
    commit: string | null;
    error: string | null;
    stderr: string;
  }> {
    const r = await runCmd(
      'git',
      ['-C', root, 'rev-parse', ref],
      { timeout: GIT_TIMEOUT_MS },
    );
    if (r.ok) {
      const commit = r.stdout.trim();
      if (commit) return { commit, error: null, stderr: r.stderr };
      return { commit: null, error: 'not_git_repo', stderr: r.stderr };
    }
    // exit code / 错误映射（对齐 Python FileNotFoundError → git_not_found / TimeoutExpired → git_timeout）。
    if (/ENOENT|spawn [^ ]+ ENOENT/i.test(r.stderr)) {
      return { commit: null, error: 'git_not_found', stderr: r.stderr };
    }
    if (/timed out|ETIMEDOUT/i.test(r.stderr)) {
      return { commit: null, error: 'git_timeout', stderr: r.stderr };
    }
    return { commit: null, error: 'not_git_repo', stderr: r.stderr };
  }

  const first = await tryOnce();
  if (first.commit) return { commit: first.commit, error: null };

  // dubious ownership 重试（对齐 Python：stderr 含 "dubious" 时加 safe.directory 再跑）。
  if (/dubious/i.test(first.stderr)) {
    await runCmd(
      'git',
      ['config', '--global', '--add', 'safe.directory', root],
      { timeout: 5_000 },
    ).catch(() => undefined);
    const retry = await tryOnce();
    if (retry.commit) return { commit: retry.commit, error: null };
    return { commit: null, error: retry.error ?? 'not_git_repo' };
  }

  return { commit: first.commit, error: first.error ?? 'not_git_repo' };
}

// ── task-01（2026-08-25-workspace-git-log）git 只读四方法：常量 + 入参守卫 + 解析 ──
//
// design §5.2 四方法命令表 + §7.2 RPC 契约 + R-01 安全约束 / R-03 解析边界。
// 与既有 git 方法的差异：只读子命令（log / for-each-ref / show / rev-parse），
// daemon.ts 平名注册（不走 host_fs. 前缀，CC-02），空仓库捕获转空态（CC-17）。

/** git 只读命令超时：对齐 design §5.3 backend 侧 log/show/diff 30s 超时——daemon 不先于 backend 失败，否则 504 语义错位。 */
const GIT_READ_TIMEOUT_MS = 30_000;

/** git_log -n 条数硬上限（R-02：backend skip≤2000 + limit≤200 + lookahead 50，此处放宽到 5000 留余量）。 */
const GIT_LOG_MAX_COUNT = 5_000;

/** git_log / git_show 共用 pretty 格式：%x00 字段分隔 + %x1e 记录分隔，不按行切（R-03）。 */
const GIT_LOG_PRETTY_FORMAT =
  '%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B%x1e';

/** git_diff_file 输出字节上限（64KB，design §5.2 CC-05 独立选定——diff 按行渲染的合理量级，非对齐 explorer 读文件 10MB）。 */
const GIT_DIFF_MAX_BYTES = 64 * 1024;

/** sha 白名单（R-01）：4~40 位十六进制（短哈希前缀与全长哈希均可查）。 */
const GIT_SHA_RE = /^[0-9a-fA-F]{4,40}$/;

/** branch 白名单（R-01 / CC-09）：首字符禁 `-`（防 git 把 -n/-O 当选项劫持语义），其余限字母数字 . _ / -。 */
const GIT_BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** branch 最大长度（R-01）。 */
const GIT_BRANCH_MAX_LEN = 200;

/** author 最大长度（R-01）。 */
const GIT_AUTHOR_MAX_LEN = 120;

/** author 拒控制字符（R-01「可打印」：C0 控制符与 DEL 全拒，含换行/制表）。 */
const GIT_AUTHOR_CTRL_RE = /[\u0000-\u001f\u007f]/;

/** 校验 sha（R-01）：非 4~40 位十六进制（含空串）→ forbidden。 */
function assertGitSha(sha: string): void {
  if (!GIT_SHA_RE.test(sha)) {
    throw new RpcError('forbidden', `invalid git sha: ${sha.slice(0, 24)}`);
  }
}

/** 校验 branch（R-01 / CC-09）：超 200 字符 / 首字符 `-` / 白名单外字符 → forbidden。 */
function assertGitBranch(branch: string): void {
  if (branch.length > GIT_BRANCH_MAX_LEN || !GIT_BRANCH_RE.test(branch)) {
    throw new RpcError('forbidden', 'invalid git branch');
  }
}

/** 校验 author（R-01）：超 120 字符或含控制字符 → forbidden。 */
function assertGitAuthor(author: string): void {
  if (author.length > GIT_AUTHOR_MAX_LEN || GIT_AUTHOR_CTRL_RE.test(author)) {
    throw new RpcError('forbidden', 'invalid git author');
  }
}

/** 校验 pathspec（R-01）：空串 / `:(` 开头的 pathspec magic → forbidden。 */
function assertGitPathspec(path: string): void {
  if (path.length === 0) {
    throw new RpcError('forbidden', 'path is empty');
  }
  if (path.startsWith(':(')) {
    throw new RpcError('forbidden', 'pathspec magic not allowed');
  }
}

/**
 * 解析一条 `%x00` 分隔的 commit 记录（git_log / git_show 共用，R-03）。
 *
 * 字段序 = GIT_LOG_PRETTY_FORMAT：%H / %h / %P / %an / %ae / %aI / %cI / %B。
 * 字段数不足 8 或 %H 为空 → null（调用方跳过该条并计数，不整页失败）。
 * message（%B）去尾部换行：git 对象消息必以 \n 收尾，保留会污染下游渲染。
 */
function parseGitLogRecord(rec: string): GitLogCommit | null {
  const fields = rec.split('\x00');
  const hash = fields[0] ?? '';
  if (fields.length < 8 || hash.length === 0) return null;
  const parentField = fields[2] ?? '';
  return {
    hash,
    short: fields[1] ?? '',
    parents:
      parentField.length > 0
        ? parentField.split(' ').filter((p) => p.length > 0)
        : [],
    author_name: fields[3] ?? '',
    author_email: fields[4] ?? '',
    author_date: fields[5] ?? '',
    committer_date: fields[6] ?? '',
    message: (fields[7] ?? '').replace(/\n+$/, ''),
  };
}

// ── task-01（2026-08-26-workspace-git-status）git_status 常量 + fetch 局部 execFile ──
//
// design §5.2 / §7.2 十四字段契约 + D-001 fetch 降级语义（Grill CC-02 / CC-07）。
// git_status 为第 5 个平名 git 方法，骨架对齐既有四方法（assertWithinAllowedRoots →
// 只读子命令独立 argv → 失败结构化回传不抛）；差异仅 fetch：runCmd 超时把 killed/
// signal 丢弃且 --quiet 下 stderr 为空串，无法判别「超时」与「失败」——改用本文件
// runCommand 同款局部 execFile 读 err.killed/signal 判超时（Grill CC-02）。

/** git fetch 超时（D-001：15s；独立于 GIT_READ_TIMEOUT_MS——网络慢只降级 fetch 不拖垮 ②③ 采集）。 */
const GIT_FETCH_TIMEOUT_MS = 15_000;

/**
 * 空仓库下 `git diff HEAD` 的 128 族失败文案（HEAD 不存在）——容错转空态不走红
 * 通道（Grill CC-07）。porcelain 已把 "(initial)" 判为 empty，此处只兜底退出码。
 */
const GIT_DIFF_HEAD_MISSING_RE =
  /ambiguous argument 'HEAD'|unknown revision|bad revision|does not have any commits yet/i;

/**
 * `git -C <root> fetch --quiet` 单独执行（design §5.2 D-001 / Grill CC-02）。
 *
 * **不经 runCmd**：runCmd 把超时（err.killed/signal）混入 ok:false 且 stderr 为空串
 * 无法判别——改用 runCommand 同款局部 execFile，从 err.killed / err.signal 判超时。
 * stdout/stderr **不外发**（--quiet 本就近静默），只回传三态代号。
 *
 * @returns `'ok'`（成功）/ `'fetch_timeout'`（err.killed 或 signal=SIGTERM）/
 *          `'fetch_failed'`（其余非零退出）。
 */
function runGitFetch(
  root: string,
): Promise<'ok' | 'fetch_timeout' | 'fetch_failed'> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', root, 'fetch', '--quiet'],
      { timeout: GIT_FETCH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        void stdout;
        void stderr; // 不外发（design §5.2：fetch 输出只判三态代号）
        if (err !== null && typeof err === 'object') {
          // execFile 超时：Node 自动 SIGTERM，err.signal === 'SIGTERM' / err.killed === true
          //（与 runCommand :1519 同款判定，读 killed/signal 而非 stderr 文案）。
          const timedOut =
            ('signal' in err && (err as { signal?: string }).signal === 'SIGTERM') ||
            ('killed' in err && (err as { killed?: boolean }).killed === true);
          resolve(timedOut ? 'fetch_timeout' : 'fetch_failed');
          return;
        }
        resolve('ok');
      },
    );
  });
}

// ── HostFsHandler：十方法宿主实现 ─────────────────────────────────────────────

/**
 * daemon 侧 host_fs handler 业务层（task-03 八方法 + task-02 P3 run_command
 * 第九方法 + task-02 agent-log 第十方法 read_agent_log_messages）。
 *
 * 十方法 1:1 对齐 design §5.1 / §5.3 / backend HostFsDelegate 签名（跨任务契约锁死）。
 * 由 daemon.ts:_registerHostFsRpcHandler 包装成 RpcHandler 注册到 WsClient。
 *
 * 另含 task-01（2026-08-25-workspace-git-log）git 只读四方法 gitLog / gitRefs /
 * gitShow / gitDiffFile——由 daemon.ts:_registerGitLogRpcHandler 平名注册
 * （git_log 等，不走 host_fs. 前缀通道，design §5.2 CC-02）。
 * 及 task-01（2026-08-26-workspace-git-status）gitStatus——同一注册器第 5 个平名
 * 方法 git_status（design §5.2 / §7.2 十四字段契约）。
 */
export class HostFsHandler {
  private readonly _rootsProvider: () => string[];

  constructor(opts: HostFsHandlerOptions) {
    this._rootsProvider = opts.rootsProvider;
  }

  // ── stat ──────────────────────────────────────────────────────────────────

  /**
   * `stat(path) → { exists, is_dir, size }`（fs/promises.lstat）。
   *
   * 不存在返回 `{exists:false}` 而非抛（区分「文件不存在」与「读失败」，
   * 对齐 backend stat 语义；前端/校验逻辑靠 exists 字段判定）。
   */
  async stat(path: string): Promise<StatResult> {
    assertWithinAllowedRoots(path, this._rootsProvider());
    const abs = pathResolve(path);
    try {
      const info = await lstat(abs);
      return {
        exists: true,
        is_dir: info.isDirectory(),
        size: info.size,
      };
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code: string }).code
          : '';
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { exists: false, is_dir: false, size: 0 };
      }
      throw toRpcError(e, 'host_fs.stat.lstat');
    }
  }

  // ── read_file ─────────────────────────────────────────────────────────────

  /**
   * `read_file(path) → string`（fs/promises.readFile utf8）。
   *
   * 越界抛 `forbidden`（assertWithinAllowedRoots）；不存在抛 `not_found`（toRpcError）。
   */
  async readFile(path: string): Promise<string> {
    assertWithinAllowedRoots(path, this._rootsProvider());
    const abs = pathResolve(path);
    try {
      return await readFile(abs, 'utf8');
    } catch (e) {
      throw toRpcError(e, 'host_fs.read_file');
    }
  }

  // ── list_dir ──────────────────────────────────────────────────────────────

  /**
   * `list_dir(path) → ListDirResult`（直接复用 file-rpc.ts:listDir，零行为变更）。
   *
   * task-03 constraints 第 7 条：list_dir 复用不重写。listDir 已落地 + 有测试，
   * 本方法只 re-export 到 HostFsHandler 契约（policyEngine=null 走 fallback_roots
   * 分支，与 daemon.ts:_registerListDirRpcHandler 同模式）。
   */
  async listDir(path: string): Promise<ListDirResult> {
    return listDir(path, null, '', this._rootsProvider());
  }

  // ── git_apply（D-008 幂等契约核心）─────────────────────────────────────────

  /**
   * `git_apply({ workdir, patch_data, use_3way }) → { ok, conflict_detail, skipped }`。
   *
   * 三路径（对齐 backend patch/service.py:48-161 + 新增 D-008 skipped 幂等信号）：
   *
   *   1. `git apply --check` 预检：
   *      - check 通过 + 紧跟 `git apply` 若报 "already applied" / 无变化 → `skipped:true`。
   *      - check 通过 + apply 成功 → `ok:true, skipped:false`。
   *   2. check 失败 + use_3way → `git apply --3way` 兜底：
   *      - 成功 → `ok:true`。
   *      - 失败 → `ok:false, conflict_detail:<3way stderr>`。
   *   3. check 失败 + !use_3way → `ok:false, conflict_detail:<check stderr>`。
   *
   * **不抛**（结构化回传让 backend 判定 PatchConflictError / PatchApplyError）。
   *
   * skipped 判定：check 通过但 `git apply` 实际跑时 exit!=0 且 stderr 含
   * "already applied" / "no changes" → 视为幂等命中（patch 已含于工作树）。
   */
  async gitApply(params: {
    workdir: string;
    patch_data: string;
    use_3way: boolean;
  }): Promise<GitApplyResult> {
    assertWithinAllowedRoots(params.workdir, this._rootsProvider());
    const workdir = pathResolve(params.workdir);

    // 1. git apply --check 预检（D-008 幂等铺垫）。
    const check = await runGitApply(workdir, ['apply', '--check'], params.patch_data);

    if (check.ok) {
      // 2a. check 通过 → 跑真实 apply。
      const apply = await runGitApply(workdir, ['apply'], params.patch_data);
      if (apply.ok) {
        return { ok: true, conflict_detail: '', skipped: false };
      }
      // apply 失败：若语义是「已 applied / 无变化」→ skipped（D-008 幂等命中）。
      const detail = apply.stderr.toLowerCase();
      if (
        detail.includes('already applied') ||
        detail.includes('no changes') ||
        detail.includes('nothing to commit')
      ) {
        return { ok: true, conflict_detail: apply.stderr, skipped: true };
      }
      // check 通过但 apply 失败且非幂等 → 异常路径（对齐 backend PatchApplyError 语义，
      // 但本 handler 不抛，结构化回传 ok:false）。
      return { ok: false, conflict_detail: apply.stderr, skipped: false };
    }

    // 2b. check 失败。
    if (!params.use_3way) {
      return { ok: false, conflict_detail: check.stderr, skipped: false };
    }

    // 3. check 失败 + use_3way → 3way 兜底。
    const threeWay = await runGitApply(
      workdir,
      ['apply', '--3way'],
      params.patch_data,
    );
    if (threeWay.ok) {
      return { ok: true, conflict_detail: '', skipped: false };
    }
    // 3way 也失败：冲突详情合并 check + 3way stderr（对齐 backend PatchConflictError.details）。
    const merged = [check.stderr, threeWay.stderr].filter(Boolean).join('\n---\n');
    return { ok: false, conflict_detail: merged, skipped: false };
  }

  // ── git_worktree_add（task-02 / design §7 / D-008 默认 identity）─────────────

  /**
   * `git_worktree_add({ workdir, sibling_path, branch, base_ref }) → { ok, worktree_path, error }`。
   *
   * task-02（2026-07-12-worker-worktree-isolation）三方法之一：在 workspace root 之外
   * 创建 sibling worktree 副本（per-worker 隔离，D-001@v1），跑：
   *
   *   `git -C <workdir> -c user.name=worker -c user.email=worker@sillyhub
   *      worktree add <sibling_path> -b <branch> <base_ref>`
   *
   * **D-008 默认 identity（R-08）**：透传 `-c user.name=worker -c user.email=worker@sillyhub`
   * 让 worker 在副本 `git commit` 时不依赖宿主机全局 git config（worker 进程无 identity 会
   * commit 失败）。`-c` 是 per-invocation override，不污染宿主全局 / 副本 .git/config 之外
   * 的状态（merge / remove 不重复传，因为 worker commit 已完成，副本 identity 已就位）。
   *
   * **base_ref 空兜底**（X-001）：`ws.default_branch` 为空时兜底 `HEAD`（execution.py:106
   * 同款可空语义），避免 `git worktree add <path> -b <branch> `（空 ref 报错）。
   *
   * **不抛**：git exit 非 0 → `{ ok:false, error: <stderr> }`（结构化回传让 backend 标
   * worker run failed，不崩 mission，对齐 design §9 兼容策略 + gitApply D-008 不抛语义）。
   *
   * **安全守卫**：workdir + sibling_path 都过 `assertWithinAllowedRoots`（防 sibling 写到
   * 宿主敏感位置如 /etc/<runid>，与 gitApply :479 同款 forbidden 抛出）。
   *
   * **execFile 非 shell**（防注入，与 runCmd:268 同模式）：参数走 runCmd 的 args 数组，
   * branch / base_ref 即便含 shell 元字符也无法注入（命令与参数分立传递）。
   */
  async gitWorktreeAdd(params: {
    workdir: string;
    sibling_path: string;
    branch: string;
    base_ref: string;
  }): Promise<GitWorktreeAddResult> {
    assertWithinAllowedRoots(params.workdir, this._rootsProvider());
    assertWithinAllowedRoots(params.sibling_path, this._rootsProvider());
    const workdir = pathResolve(params.workdir);
    const siblingPath = pathResolve(params.sibling_path);
    // base_ref 空 → 兜底 HEAD（X-001：ws.default_branch 可空）。
    const baseRef =
      params.base_ref && params.base_ref.length > 0 ? params.base_ref : 'HEAD';

    const r = await runCmd(
      'git',
      [
        '-C',
        workdir,
        '-c',
        'user.name=worker',
        '-c',
        'user.email=worker@sillyhub',
        'worktree',
        'add',
        siblingPath,
        '-b',
        params.branch,
        baseRef,
      ],
      { timeout: GIT_WORKTREE_TIMEOUT_MS },
    );
    if (r.ok) {
      return { ok: true, worktree_path: siblingPath };
    }
    const error = r.stderr.trim() || r.stdout.trim() || 'git worktree add failed';
    return { ok: false, error };
  }

  // ── git_merge（task-02 / design §7 / §7.5 converge 事件）────────────────────

  /**
   * `git_merge({ workdir, worker_branch }) → { ok, conflicts, merged_files, error }`。
   *
   * task-02 三方法之二：把 worker_branch 合并到 workspace root 当前 HEAD（converge 收敛，
   * design §7.5 第 4 行），跑：
   *
   *   `git -C <workdir> merge --no-ff <worker_branch>`
   *
   * **解析冲突**（design §7.5 第 5 行 / R-02）：merge exit 1 时跑
   * `git -C <workdir> diff --name-only --diff-filter=U` 拿冲突文件列表，逐个 readFile
   * 数冲突标记行（`<<<<<<< / ======= / >>>>>>>`），回传 `conflicts:[{file, marker_lines}]`
   * 让 backend converge_mission tool 喂主 agent LLM 自动解决（D-004@v1）。
   *
   * **不重复传 identity**（R-08 注释）：merge 用 worker 副本已配的 identity（git_worktree_add
   * 已带 -c user.name/email 创建副本，commit 时 identity 已落到副本 .git/config 之外的
   * per-invocation 上下文；merge --no-ff 产生 merge commit 需要 committer，但 worktree
   * 副本从父仓库继承全局 config 或共享 .git/config，worker commit 时已就位）。
   *
   * **不抛**：merge 失败（含冲突）→ `{ ok:false, conflicts:[...], merged_files:[] }`；
   * 读冲突文件失败（race / 已被外部清理）→ 跳过该文件 marker_lines 计数（不崩）。
   *
   * **marker_lines 计数语义**：`<<<<<<<`/`=======`/`>>>>>>>` 总行数。≥2 才算真冲突
   * （单标记行通常意味着文件被外部篡改非真冲突，但仍计入让 caller 决策）。
   */
  async gitMerge(params: {
    workdir: string;
    worker_branch: string;
  }): Promise<GitMergeResult> {
    assertWithinAllowedRoots(params.workdir, this._rootsProvider());
    const workdir = pathResolve(params.workdir);

    const merge = await runCmd(
      'git',
      ['-C', workdir, 'merge', '--no-ff', params.worker_branch],
      { timeout: GIT_WORKTREE_TIMEOUT_MS },
    );

    if (merge.ok) {
      // 成功路径：conflicts 空，merged_files 当前回空数组（stdout 非结构化，留 backend 降级）。
      return { ok: true, conflicts: [], merged_files: [] };
    }

    // 失败：拉冲突文件列表（git diff --name-only --diff-filter=U）。
    const conflictFiles = await this._listConflictFiles(workdir);
    const conflicts: MergeConflict[] = [];
    for (const file of conflictFiles) {
      const abs = pathResolve(workdir, file);
      const markerLines = await this._countConflictMarkers(abs).catch(() => 0);
      conflicts.push({ file, marker_lines: markerLines });
    }

    const error =
      merge.stderr.trim() || merge.stdout.trim() || 'git merge failed';
    return { ok: false, conflicts, merged_files: [], error };
  }

  /**
   * 跑 `git -C <workdir> diff --name-only --diff-filter=U` 拿冲突文件相对路径列表。
   * 失败 / 空输出 → 空数组（不让冲突列举失败阻塞 merge 错误回传）。
   */
  private async _listConflictFiles(workdir: string): Promise<string[]> {
    const r = await runCmd(
      'git',
      ['-C', workdir, 'diff', '--name-only', '--diff-filter=U'],
      { timeout: GIT_WORKTREE_TIMEOUT_MS },
    );
    if (!r.ok) return [];
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /**
   * 数文件内冲突标记行（`<<<<<<<`/`=======`/`>>>>>>>`）。读失败 → 0（让 caller 判定）。
   */
  private async _countConflictMarkers(absPath: string): Promise<number> {
    let content: string;
    try {
      content = await readFile(absPath, 'utf8');
    } catch {
      return 0;
    }
    let count = 0;
    for (const line of content.split('\n')) {
      if (
        line.startsWith('<<<<<<<') ||
        line.startsWith('=======') ||
        line.startsWith('>>>>>>>')
      ) {
        count += 1;
      }
    }
    return count;
  }

  // ── git_worktree_remove（task-02 / design §7 / §7.5 cleanup 事件）────────────

  /**
   * `git_worktree_remove({ workdir, sibling_path, branch? }) → { ok, error, branch_deleted? }`。
   *
   * task-02 三方法之三：合并后清理 worker 副本（design §7.5 第 8 行），跑：
   *
   *   `git -C <workdir> worktree remove --force <sibling_path>`
   *
   * `--force`：副本可能有未提交改动（worker 异常退出残留），强删避免 `git worktree remove`
   * 拒绝（design §5.1：合并成功路径立即清理，副本价值已被 merge 消化）。
   *
   * **branch 可选参（ql-20260902-001）**：`git worktree remove` 只删目录 + 注册元数据，
   * **不删 `workers/<id>` 分支**——此前全链路无任何 branch -D 调用，workers/* 分支永久
   * 堆积。调用方（backend execution 创建失败收残 / finalizer converge 清理）确认该分支
   * 已无保留价值时传入，remove 成功后 best-effort `git branch -D`；删除失败不改变 ok
   * 语义（目录已删即清理主体成功），经 `branch_deleted:false` + `error` 回传供记日志。
   *
   * **不抛**：失败 → `{ ok:false, error: <stderr> }`（backend cleanup 路径失败仅记 warning，
   * 不阻塞 mission 收尾，对齐 design §9 兼容策略；merge 失败回退时副本保留供人工排查）。
   *
   * **安全守卫**：workdir + sibling_path 都过 `assertWithinAllowedRoots`（防删宿主敏感目录）。
   */
  async gitWorktreeRemove(params: {
    workdir: string;
    sibling_path: string;
    branch?: string;
  }): Promise<GitWorktreeRemoveResult> {
    assertWithinAllowedRoots(params.workdir, this._rootsProvider());
    assertWithinAllowedRoots(params.sibling_path, this._rootsProvider());
    const workdir = pathResolve(params.workdir);
    const siblingPath = pathResolve(params.sibling_path);

    const r = await runCmd(
      'git',
      ['-C', workdir, 'worktree', 'remove', '--force', siblingPath],
      { timeout: GIT_WORKTREE_TIMEOUT_MS },
    );
    if (!r.ok) {
      const error =
        r.stderr.trim() || r.stdout.trim() || 'git worktree remove failed';
      return { ok: false, error };
    }
    // ql-20260902-001：分支删除（可选，best-effort）。用 -D 不用 -d——调用方传分支
    // 即已判定无保留价值（失败收残场景分支无独有提交；converge 场景已 merge 消化），
    // -d 会因「not fully merged」误拒（merge --no-ff 后 -d 判定正常，但收残场景
    // 分支可能指向 base 提交之外的中间态，统一 -D 语义最稳）。
    if (params.branch && params.branch.length > 0) {
      const del = await runCmd(
        'git',
        ['-C', workdir, 'branch', '-D', params.branch],
        { timeout: GIT_TIMEOUT_MS },
      );
      if (del.ok) {
        return { ok: true, branch_deleted: true };
      }
      const delError =
        del.stderr.trim() || del.stdout.trim() || 'git branch -D failed';
      return { ok: true, branch_deleted: false, error: delError };
    }
    return { ok: true };
  }

  // ── git_rev_parse ─────────────────────────────────────────────────────────

  /**
   * `git_rev_parse({ root }) → { commit, error }`（对齐 backend _get_source_commit）。
   *
   * 非 git 仓库 / git 不可用 / 超时 → commit=null + error 代号（不抛，backend 降级 warning）。
   * safe.directory dubious ownership 自动重试。
   */
  async gitRevParse(params: {
    root: string;
    ref?: string;
  }): Promise<GitRevParseResult> {
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);
    return runGitRevParse(root, params.ref && params.ref.length > 0 ? params.ref : 'HEAD');
  }

  // ── git_log / git_refs / git_show / git_diff_file（task-01 2026-08-25-workspace-git-log）──

  /**
   * `git_log({ root, branch?, author?, count }) → { commits, truncated, error }`
   * （design §5.2 / §7.2；backend git_log 模块平名 RPC 直连消费，task-04）。
   *
   * 命令：`git -C <root> log (--all | <branch>) [--author=<v>] -n <count>
   * --date=iso-strict --pretty=format:<%x00/%x1e 分隔>`（--all 与分支过滤互斥）。
   *
   * 解析（R-03）：%x1e 分记录、%x00 分字段，**不按行切**（中文 message / 引号 /
   * 多行 body 天然安全）；单条解析失败跳过并计数，不整页失败。
   *
   * truncated 语义：达到 -n 上限（可能还有更多提交，backend 据此判 has_more）
   * 或存在解析跳过（结果不完整）。
   *
   * 空仓库（CC-17）：exit 128 且 stderr 含 "does not have any commits yet" →
   * `{commits: [], truncated: false, error: null}` 空态（不走红通道）；其余失败
   * （非 git 目录 / 超时 / 分支不存在）→ commits 空表 + error 文案（不抛）。
   *
   * **不抛**（对齐 gitApply 语义）；仅 root 越界与入参非法走 RpcError forbidden。
   */
  async gitLog(params: {
    root: string;
    branch?: string;
    author?: string;
    count: number;
  }): Promise<GitLogResult> {
    // 1. 白名单守卫（与既有方法同款）+ 入参校验（R-01；非法入参走 forbidden 红通道）。
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);
    const branch = params.branch ?? '';
    const author = params.author ?? '';
    const count = params.count;
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > GIT_LOG_MAX_COUNT
    ) {
      throw new RpcError('forbidden', `invalid git_log count: ${String(count)}`);
    }
    if (branch.length > 0) assertGitBranch(branch);
    if (author.length > 0) assertGitAuthor(author);

    // 2. 独立 argv 构造（execFile 不经 shell；branch/author 只作单 argv，R-01 无注入面）。
    const args: string[] = ['-C', root, 'log'];
    args.push(branch.length > 0 ? branch : '--all');
    if (author.length > 0) args.push(`--author=${author}`);
    args.push(
      '-n',
      String(count),
      '--date=iso-strict',
      `--pretty=format:${GIT_LOG_PRETTY_FORMAT}`,
    );

    const r = await runCmd('git', args, { timeout: GIT_READ_TIMEOUT_MS });
    if (!r.ok) {
      if (/does not have any commits yet/i.test(r.stderr)) {
        return { commits: [], truncated: false, error: null };
      }
      return {
        commits: [],
        truncated: false,
        error: r.stderr.trim() || r.stdout.trim() || 'git log failed',
      };
    }

    // 3. %x1e 记录分隔 / %x00 字段分隔解析（git 在相邻记录间补 \n，剥掉后再切字段）。
    let skipped = 0;
    const commits: GitLogCommit[] = [];
    for (const raw of r.stdout.split('\x1e')) {
      const rec = raw.replace(/^\n+/, '');
      if (rec.trim().length === 0) continue; // %x1e 之后的尾部残余空段
      const commit = parseGitLogRecord(rec);
      if (commit === null) {
        skipped += 1; // 解析失败条目跳过并计数（R-03），不整页失败
        continue;
      }
      commits.push(commit);
    }
    return {
      commits,
      truncated: commits.length >= count || skipped > 0,
      error: null,
    };
  }

  /**
   * `git_refs({ root }) → { refs, head, error }`（design §5.2 / §7.2）。
   *
   * 命令：`git -C <root> for-each-ref --format=%(refname)%00%(objectname)%00%(*objectname)%00%(refname:short)
   * refs/heads refs/remotes refs/tags` + `git -C <root> rev-parse HEAD`。
   *
   * tag 的 sha 取 `%(*objectname)`（annotated tag peeled 到 commit sha，CC-04——
   * tag 对象的 objectname ≠ commit sha），无 peeled（轻量 tag / 分支 / 远程）回退
   * `%(objectname)`；kind 按 refname 前缀映射 branch / remote / tag。
   *
   * 空仓库（CC-17）：for-each-ref 对无 ref 仓库 exit 0 输出空 → refs:[]；
   * rev-parse 失败 → head:null（空态，不走红通道）。其余失败 → error 文案（不抛）。
   *
   * rev-parse 不复用 runGitRevParse：其 dubious ownership 重试会写
   * `git config --global`（落宿主状态），违反本方法严格只读约束（D-003）。
   */
  async gitRefs(params: { root: string }): Promise<GitRefsResult> {
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);

    const r = await runCmd(
      'git',
      [
        '-C',
        root,
        'for-each-ref',
        '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(refname:short)',
        'refs/heads',
        'refs/remotes',
        'refs/tags',
      ],
      { timeout: GIT_READ_TIMEOUT_MS },
    );
    if (!r.ok) {
      return {
        refs: [],
        head: null,
        error: r.stderr.trim() || 'git for-each-ref failed',
      };
    }

    const refs: GitRefEntry[] = [];
    for (const line of r.stdout.split('\n')) {
      if (line.trim().length === 0) continue;
      const fields = line.split('\x00');
      const name = fields[0] ?? '';
      const peeled = fields[2] ?? '';
      if (fields.length < 4 || name.length === 0) continue; // 畸形行跳过（防御）
      let kind: GitRefEntry['kind'];
      if (name.startsWith('refs/heads/')) kind = 'branch';
      else if (name.startsWith('refs/remotes/')) kind = 'remote';
      else if (name.startsWith('refs/tags/')) kind = 'tag';
      else continue; // 查询 pattern 只含三种前缀，此处防御兜底
      refs.push({
        name,
        short: fields[3] ?? '',
        // annotated tag 的 objectname 是 tag 对象 sha ≠ commit sha：peeled 优先（CC-04）。
        sha: peeled.length > 0 ? peeled : fields[1] ?? '',
        kind,
      });
    }

    // rev-parse HEAD：空仓库 / 非 git 目录失败 → head:null（CC-17 空态），error 不因此置位。
    const head = await runCmd('git', ['-C', root, 'rev-parse', 'HEAD'], {
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return {
      refs,
      head: head.ok ? head.stdout.trim() || null : null,
      error: null,
    };
  }

  /**
   * `git_show({ root, sha }) → { commit, files, error }`（design §5.2 / §7.2）。
   *
   * 命令：`git -C <root> show <sha> --numstat --no-renames --pretty=format:<同 git_log>`。
   *
   * 分区解析（可靠性设计）：pretty 记录以 %x1e 收尾，其后整段即 numstat 区——
   * 以 stdout 中第一个 %x1e 切两段（commit 记录 / numstat 行），不猜行数；numstat
   * 行 `^<add>\t<del>\t<path>` 为文本变更，`-\t-\t<path>` 表二进制（binary:true，
   * add/del:null）；非 numstat 形状的行（pretty 与 numstat 间的分隔空行等）跳过。
   *
   * 失败（sha 不存在 / 非 git 目录）→ `{commit: null, files: [], error}`（不抛）。
   */
  async gitShow(params: { root: string; sha: string }): Promise<GitShowResult> {
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);
    assertGitSha(params.sha);

    const r = await runCmd(
      'git',
      [
        '-C',
        root,
        'show',
        params.sha,
        '--numstat',
        '--no-renames',
        `--pretty=format:${GIT_LOG_PRETTY_FORMAT}`,
      ],
      { timeout: GIT_READ_TIMEOUT_MS },
    );
    if (!r.ok) {
      return {
        commit: null,
        files: [],
        error: r.stderr.trim() || r.stdout.trim() || 'git show failed',
      };
    }

    const sepIdx = r.stdout.indexOf('\x1e');
    const commit =
      sepIdx >= 0 ? parseGitLogRecord(r.stdout.slice(0, sepIdx)) : null;
    const numstatZone = sepIdx >= 0 ? r.stdout.slice(sepIdx + 1) : '';

    const files: GitShowFileEntry[] = [];
    for (const line of numstatZone.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (m === null) continue; // 空行 / 分隔噪声行
      const binary = m[1] === '-' && m[2] === '-';
      files.push({
        // 匹配成功时三捕获组必在（noUncheckedIndexedAccess 下 ?? '' 兜底类型）。
        path: m[3] ?? '',
        add: binary ? null : Number(m[1]),
        del: binary ? null : Number(m[2]),
        binary,
      });
    }
    if (commit === null) {
      return { commit: null, files, error: 'git show parse failed' };
    }
    return { commit, files, error: null };
  }

  /**
   * `git_diff_file({ root, sha, path }) → { diff, truncated, binary, error }`
   * （design §5.2 / §7.2 / R-06）。
   *
   * 命令：`git -C <root> show <sha> --pretty=format: --unified=3 --no-color -- <path>`
   * （`--pretty=format:` 空 pretty 去 commit 头——stdout 即纯 unified diff，前端
   * 消费无 author/message 前导噪声；主代理批准的 design §5.2 勘误，2026-08-25。
   * `--` 后 path 为独立 argv pathspec，assertGitPathspec 拒 `:(` magic 后无注入面）。
   *
   * stdout 含 "Binary files" → binary:true；超 64KB（CC-05 独立上限）按字节截断标
   * truncated:true（边界处多字节字符可能出现替换符，前端已按 truncated 提示截断）。
   *
   * 失败（sha 不存在 / path 无匹配 / 非 git 目录）→ error 文案（不抛）。
   */
  async gitDiffFile(params: {
    root: string;
    sha: string;
    path: string;
  }): Promise<GitDiffFileResult> {
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);
    assertGitSha(params.sha);
    assertGitPathspec(params.path);

    const r = await runCmd(
      'git',
      [
        '-C',
        root,
        'show',
        params.sha,
        '--pretty=format:',
        '--unified=3',
        '--no-color',
        '--',
        params.path,
      ],
      { timeout: GIT_READ_TIMEOUT_MS },
    );
    if (!r.ok) {
      return {
        diff: '',
        truncated: false,
        binary: false,
        error: r.stderr.trim() || r.stdout.trim() || 'git show diff failed',
      };
    }

    const binary = r.stdout.includes('Binary files');
    const bytes = Buffer.from(r.stdout, 'utf8');
    if (bytes.length <= GIT_DIFF_MAX_BYTES) {
      return { diff: r.stdout, truncated: false, binary, error: null };
    }
    return {
      diff: bytes.subarray(0, GIT_DIFF_MAX_BYTES).toString('utf8'),
      truncated: true,
      binary,
      error: null,
    };
  }

  // ── git_status（task-01 2026-08-26-workspace-git-status，第 5 个平名 git 方法）──

  /**
   * `git_status({ root }) → 十四字段`（design §5.2 / §7.2 逐字契约）。
   *
   * 三步采集（§5.1 数据流 ①②③，root 唯一入参，全部只读子命令独立 argv）：
   *
   *   ① `git remote` 预检（空输出 → fetch_error='no_remote' 不执行 fetch——无 remote
   *      时 `fetch --quiet` 静默 exit 0 探测不到，Grill CC-07）+ 局部 execFile 跑
   *      `git fetch --quiet`（15s 超时读 err.killed/signal 判 fetch_timeout，非零
   *      退出 fetch_failed，Grill CC-02 不经 runCmd）；失败仅记 fetch_error，
   *      **不阻断 ②③**（behind 基于 stale tracking 数据，backend 标 degraded）。
   *   ② `git status --porcelain=v2 --branch --no-show-stash`（runCmd 只读采集）：
   *      branch.head（"(detached)" → detached=true 且 branch=head_short）/
   *      branch.upstream（缺失 → null）/ branch.ab（缺失 → ahead/behind=null）/
   *      "? " 条目计 untracked_count（CC-05 单源化后 porcelain 仅负责 untracked）/
   *      branch.oid 前 8 位 → head_short（CC-04），"(initial)" → empty=true。
   *   ③ `git diff HEAD --numstat --no-renames`（--no-renames 对齐 git_show 纪律
   *      CC-03）：additions/deletions 求和（`-` 二进制行计 files_changed 不计行数）；
   *      files_changed ≡ numstat 行数（CC-05 单源无 fallback，porcelain 1/2 条目
   *      不参与）；空仓库 exit 128 容错转空态不走红通道（CC-07）。
   *
   * 空仓库空态：empty=true，branch/upstream/ahead/behind/dirty 计数/head_short
   * 全 null（前端提示「仓库还没有任何提交」）。
   *
   * **不抛**（对齐既有四 git 方法）；仅 root 越界走 RpcError forbidden。
   */
  async gitStatus(params: { root: string }): Promise<GitStatusResult> {
    // 1. 白名单守卫（与既有四方法同款）。
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);

    // ── ① fetch 降级（D-001）：预检 no_remote → fetch（局部 execFile）→ 失败不阻断 ──
    let fetchPerformed = false;
    let fetchError: string | null = null;
    const remote = await runCmd('git', ['-C', root, 'remote'], {
      timeout: GIT_READ_TIMEOUT_MS,
    });
    if (!remote.ok) {
      // 预检自身失败（非 git 目录等）→ 归入 fetch_failed（fetch 确未执行成功；
      // 真因由 ② porcelain 的 error 通道报告）。
      fetchError = 'fetch_failed';
    } else if (remote.stdout.trim().length === 0) {
      // 无 remote：fetch --quiet 静默 exit 0 探测不到，靠预检判定（Grill CC-07）。
      fetchError = 'no_remote';
    } else {
      const fetchOutcome = await runGitFetch(root);
      if (fetchOutcome === 'ok') {
        fetchPerformed = true;
      } else {
        fetchError = fetchOutcome; // fetch_timeout | fetch_failed
      }
    }

    // ── ② porcelain v2 解析（runCmd 只读采集；R-02 条目按前缀字节严格匹配）──
    const status = await runCmd(
      'git',
      ['-C', root, 'status', '--porcelain=v2', '--branch', '--no-show-stash'],
      { timeout: GIT_READ_TIMEOUT_MS },
    );
    if (!status.ok) {
      // porcelain 真失败（非 git 目录 / git 不可用）→ 全 null + error 文案（不抛）。
      return {
        branch: null,
        detached: false,
        upstream: null,
        ahead: null,
        behind: null,
        files_changed: null,
        additions: null,
        deletions: null,
        untracked_count: null,
        head_short: null,
        empty: false,
        fetch_performed: fetchPerformed,
        fetch_error: fetchError,
        error: status.stderr.trim() || status.stdout.trim() || 'git status failed',
      };
    }

    let branch: string | null = null;
    let upstream: string | null = null;
    let ahead: number | null = null;
    let behind: number | null = null;
    let untrackedCount = 0;
    let headShort: string | null = null;
    let empty = false;
    for (const line of status.stdout.split('\n')) {
      if (line.startsWith('# branch.oid ')) {
        const oid = line.slice('# branch.oid '.length).trim();
        if (oid === '(initial)') {
          empty = true; // 空仓库判据（CC-04 兼作，无 HEAD）
        } else {
          headShort = oid.slice(0, 8); // 前 8 位截断（CC-04）
        }
      } else if (line.startsWith('# branch.head ')) {
        branch = line.slice('# branch.head '.length).trim();
      } else if (line.startsWith('# branch.upstream ')) {
        upstream = line.slice('# branch.upstream '.length).trim();
      } else if (line.startsWith('# branch.ab ')) {
        // 形如 `# branch.ab +2 -1`；无 upstream 时整行缺失 → ahead/behind 保持 null。
        const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
        if (m !== null) {
          ahead = Number(m[1]);
          behind = Number(m[2]);
        }
      } else if (line.startsWith('? ')) {
        untrackedCount += 1; // porcelain 仅负责 untracked（CC-05 单源化）
      }
      // 其余 `#` 头行（stash 计数等）与 1/2/u 条目：files_changed 单源在 ③（CC-05），跳过。
    }
    const detached = branch === '(detached)';

    // ── ③ numstat 汇总（git diff HEAD 覆盖 staged+unstaged；--no-renames 防计数破坏）──
    const diff = await runCmd(
      'git',
      ['-C', root, 'diff', 'HEAD', '--numstat', '--no-renames'],
      { timeout: GIT_READ_TIMEOUT_MS },
    );
    let filesChanged: number | null = null;
    let additions: number | null = null;
    let deletions: number | null = null;
    let diffError: string | null = null;
    if (diff.ok) {
      filesChanged = 0;
      additions = 0;
      deletions = 0;
      for (const line of diff.stdout.split('\n')) {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        if (m === null) continue; // 空行 / 噪声行不计数
        filesChanged += 1; // files_changed ≡ numstat 行数（CC-05 单源，二进制行也计文件）
        if (m[1] !== '-') additions += Number(m[1]); // 二进制 `-` 不计行数
        if (m[2] !== '-') deletions += Number(m[2]);
      }
    } else if (GIT_DIFF_HEAD_MISSING_RE.test(diff.stderr)) {
      // 空仓库 exit 128 族 → 容错转空态，counts 保持 null（CC-07 不走红通道）。
    } else {
      diffError = diff.stderr.trim() || diff.stdout.trim() || 'git diff HEAD failed';
    }

    // ── 空态 / 常态组装 ──
    if (empty) {
      // 空仓库：计数全 null（② 的 untracked 也归空态，前端走「还没有任何提交」提示）。
      return {
        branch: null,
        detached: false,
        upstream: null,
        ahead: null,
        behind: null,
        files_changed: null,
        additions: null,
        deletions: null,
        untracked_count: null,
        head_short: null,
        empty: true,
        fetch_performed: fetchPerformed,
        fetch_error: fetchError,
        error: null,
      };
    }
    return {
      // detached 形态：branch 字段返回 HEAD 短哈希（§5.2；branch.ab/upstream 在
      // detached 下 porcelain 不输出，天然 null）。
      branch: detached ? headShort : branch,
      detached,
      upstream,
      ahead,
      behind,
      files_changed: filesChanged,
      additions,
      deletions,
      untracked_count: untrackedCount,
      head_short: headShort,
      empty: false,
      fetch_performed: fetchPerformed,
      fetch_error: fetchError,
      error: diffError,
    };
  }

  // ── pollution_archive ─────────────────────────────────────────────────────

  /**
   * `pollution_archive({ source_root, runtime_root, scan_run_id }) → { archived, archive_path, file_count, error? }`。
   *
   * 移动 `source_root/.sillyspec` → `runtime_root/pollution/<scan_run_id>/.sillyspec`
   * （对齐 backend post_scan_validator._archive_and_clean_pollution:204-240）。
   *
   * - source 不存在 / 空目录 → `{archived:false, archive_path:null, file_count:0}`。
   * - 移动失败 → `{archived:false, file_count:N, error:<msg>}`（不抛，结构化回传）。
   */
  async pollutionArchive(params: {
    source_root: string;
    runtime_root?: string;
    scan_run_id?: string;
  }): Promise<PollutionArchiveResult> {
    assertWithinAllowedRoots(params.source_root, this._rootsProvider());
    const sourceRoot = pathResolve(params.source_root);
    // runtime_root / scan_run_id 可选：delegate.pollution_archive 只传 source_root
    // （post_scan_validator:745 调用同样只传 source_root）。空时 fallback
    // source_root + 时间戳，archive 到 source_root/.pollution-<ts>/（与 delegate
    // server-local _local_pollution_archive 一致），不阻塞污染清理路径。
    const runtimeRoot =
      params.runtime_root && params.runtime_root.length > 0
        ? (assertWithinAllowedRoots(params.runtime_root, this._rootsProvider()),
          pathResolve(params.runtime_root))
        : sourceRoot;
    const sourceSillyspec = join(sourceRoot, '.sillyspec');

    // 1. source 不存在 → 未归档（file_count:0）。
    try {
      const info = await lstat(sourceSillyspec).catch((e) => {
        const code =
          typeof e === 'object' && e !== null && 'code' in e
            ? (e as { code: string }).code
            : '';
        if (code === 'ENOENT') return null;
        throw toRpcError(e, 'host_fs.pollution_archive.lstat_source');
      });
      if (info === null) {
        return { archived: false, archive_path: null, file_count: 0 };
      }
    } catch (e) {
      throw toRpcError(e, 'host_fs.pollution_archive.lstat_source');
    }

    // 2. 统计 source 下文件数（rglob 等价：递归 readdir）。
    const fileCount = await this._countFiles(sourceSillyspec).catch((e) => {
      throw toRpcError(e, 'host_fs.pollution_archive.count');
    });
    if (fileCount === 0) {
      return { archived: false, archive_path: null, file_count: 0 };
    }

    // 3. 移动到归档目录（scan_run_id 空 → 时间戳兜底，避免 join 段为空）。
    const scanRunId =
      params.scan_run_id && params.scan_run_id.length > 0
        ? params.scan_run_id
        : `local-${Date.now()}`;
    const archiveDir = join(runtimeRoot, 'pollution', scanRunId);
    const archivePath = join(archiveDir, '.sillyspec');
    try {
      await mkdir(archiveDir, { recursive: true });
      await rename(sourceSillyspec, archivePath);
      return { archived: true, archive_path: archivePath, file_count: fileCount };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        archived: false,
        archive_path: null,
        file_count: fileCount,
        error: msg,
      };
    }
  }

  /**
   * 递归统计目录下文件数（对齐 Python `Path.rglob('*')` + `is_file()` 过滤）。
   * 不跟随 symlink（避免环路；对齐 pollution 语义——只数真实文件）。
   */
  private async _countFiles(dir: string): Promise<number> {
    let count = 0;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      throw toRpcError(e, 'host_fs.pollution_archive.count.readdir');
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        count += 1;
      } else if (entry.isDirectory()) {
        count += await this._countFiles(join(dir, entry.name));
      }
    }
    return count;
  }

  // ── read_package_json ─────────────────────────────────────────────────────

  /**
   * `read_package_json({ root }) → dict | null`（`<root>/package.json`）。
   *
   * 不存在 → null；解析失败 → 抛 internal（JSON 解析错误属真异常，不是「文件不在」）。
   * 对齐 backend post_scan_validator._check_local_config:433-443（json.loads + .scripts）。
   */
  async readPackageJson(params: { root: string }): Promise<ReadDictResult> {
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);
    const pkgPath = join(root, 'package.json');
    try {
      const content = await readFile(pkgPath, 'utf8');
      const data = JSON.parse(content);
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return null;
      }
      return data as Record<string, unknown>;
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code: string }).code
          : '';
      if (code === 'ENOENT') return null;
      throw toRpcError(e, 'host_fs.read_package_json');
    }
  }

  // ── read_local_yaml ───────────────────────────────────────────────────────

  /**
   * `read_local_yaml({ root }) → dict | null`（`<root>/.sillyspec/local.yaml`）。
   *
   * 用 js-yaml safeLoad（对齐 backend post_scan_validator._check_local_config:397-399
   * 的 `yaml.safe_load`）。不存在 → null；解析失败 → 抛 internal。
   *
   * **依赖声明**：spike-01 / task-03 蓝图原说"daemon 依赖已含 js-yaml"，实际
   * sillyhub-daemon/package.json 未声明（仅作为 @redocly/openapi-core 间接依赖存在于
   * pnpm-lock）。本变更 W1 调度阶段已显式声明 `js-yaml` + `@types/js-yaml`（见
   * package.json dependencies / devDependencies），本方法用静态 `import yaml from 'js-yaml'`。
   */
  async readLocalYaml(params: { root: string }): Promise<ReadDictResult> {
    assertWithinAllowedRoots(params.root, this._rootsProvider());
    const root = pathResolve(params.root);
    const yamlPath = join(root, '.sillyspec', 'local.yaml');
    let content: string;
    try {
      content = await readFile(yamlPath, 'utf8');
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? (e as { code: string }).code
          : '';
      if (code === 'ENOENT') return null;
      throw toRpcError(e, 'host_fs.read_local_yaml.read');
    }
    try {
      const data = yaml.load(content);
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return null;
      }
      return data as Record<string, unknown>;
    } catch (e) {
      throw toRpcError(e, 'host_fs.read_local_yaml.parse');
    }
  }

  // ── run_command（task-02 / design §5.3+§7 / R3 命令白名单 + AC-8）──────────

  /**
   * `run_command({ command, args, cwd, timeout, env }) → { exit_code, stdout, stderr, duration_ms }`。
   *
   * P3 driver gate pilot 第 9 方法：在宿主跑 `sillyspec gate verify --change <name> --json
   * [--stage <stage>]`，由 backend HostFsDelegate.run_command（task-01）经 send_rpc 转发
   * 到本 handler（design §5.3 / §7）。
   *
   * **命令白名单（R3 / AC-8）**：调用前先过 `isGateCommand(command, args)`，只允 sillyspec
   * gate 模板。非白名单**不执行**，返回 `{ exit_code: 126, stdout: '', stderr: 'command not
   * allowed: <command>', duration_ms: <极小> }`（不抛，结构化回传让 backend 记审计；与
   * git_apply D-008 不抛语义一致）。
   *
   * **execFile 非 shell**（防注入，与 runCmd:169 同模式）：command + args 直接传 execFile，
   * 不经 shell 拼接。timeout 用入参 params.timeout（**不写死 12min，透传调用方值**）；
   * cwd 先过 `assertWithinAllowedRoots`（穿越防护，与现有 8 方法一致）。
   *
   * **超时杀子进程**：execFile timeout 触发后 Node 自动 SIGTERM 子进程（不留孤儿），
   * callback 的 err 带 `signal === 'SIGTERM'` / `killed === true`。超时返回
   * `{ exit_code: 124, stdout, stderr: '<timeout after Nms>', duration_ms }`（不抛）。
   *
   * **env 注入**：env 非空时合并到 `process.env` 之上（仅追加/覆盖入参键，不清空 PATH）；
   * 空/null 走默认环境。
   *
   * **duration_ms**：方法入口 `Date.now()` 计时，返回时算差值。
   */
  async runCommand(params: RunCommandParams): Promise<RunCommandResult> {
    const startedAt = Date.now();

    // 1. 命令白名单守卫（R3 / AC-8）—— 非白名单不执行，结构化回传 exit 126。
    if (!isGateCommand(params.command, params.args)) {
      return {
        exit_code: 126,
        stdout: '',
        stderr: `command not allowed: ${params.command}`,
        duration_ms: Date.now() - startedAt,
      };
    }

    // 2. cwd 穿越守卫（与现有 8 方法一致，assertWithinAllowedRoots 抛 forbidden RpcError）。
    assertWithinAllowedRoots(params.cwd, this._rootsProvider());
    const cwd = pathResolve(params.cwd);

    // 3. 合并 env（非空时叠加到 process.env 之上，不清空 PATH）。
    //    DA-6（2026-08-20 审计）：PATH/PATHEXT/SystemRoot/ComSpec 等进程解析关键变量
    //    不允许调用方覆盖——否则 backend 传 env:{PATH:'C:\\tmp'} 即可把白名单命令
    //    `sillyspec` 解析到任意可执行文件，白名单形同虚设。
    const PROTECTED_ENV_KEYS = new Set(['PATH', 'PATHEXT', 'SystemRoot', 'ComSpec', 'windir']);
    const filteredEnv = params.env
      ? Object.fromEntries(
          Object.entries(params.env).filter(([k]) => !PROTECTED_ENV_KEYS.has(k)),
        )
      : undefined;
    const env =
      filteredEnv && Object.keys(filteredEnv).length > 0
        ? { ...process.env, ...filteredEnv }
        : process.env;

    // 4. execFile（非 shell，timeout 透传）。不复用 runCmd：runCmd 把超时混入 ok:false 无法
    //    区分 exit_code 124，run_command 需独立从 err 上读 signal/killed 判超时。
    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve) => {
      execFile(
        params.command,
        params.args,
        {
          cwd,
          env: env as NodeJS.ProcessEnv,
          timeout: params.timeout > 0 ? params.timeout : undefined,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          const out = Buffer.isBuffer(stdout)
            ? stdout.toString('utf8')
            : stdout ?? '';
          const errOut = Buffer.isBuffer(stderr)
            ? stderr.toString('utf8')
            : stderr ?? '';
          // execFile 超时：Node 自动 SIGTERM，err.signal === 'SIGTERM' / err.killed === true。
          const timedOut =
            err !== null &&
            typeof err === 'object' &&
            (('signal' in err && (err as { signal?: string }).signal === 'SIGTERM') ||
              ('killed' in err && (err as { killed?: boolean }).killed === true));
          if (timedOut) {
            resolve({ exitCode: 124, stdout: out, stderr: errOut, timedOut: true });
            return;
          }
          if (err !== null) {
            // 非 0 退出（err.code 或 err.exitCode 是数字）；读不到时兜底 1。
            const code =
              typeof err === 'object' && err !== null
                ? (('code' in err && typeof (err as { code?: unknown }).code === 'number'
                    ? (err as { code?: number }).code
                    : undefined) ??
                  ('exitCode' in err && typeof (err as { exitCode?: unknown }).exitCode === 'number'
                    ? (err as { exitCode?: number }).exitCode
                    : undefined))
                : undefined;
            resolve({
              exitCode: typeof code === 'number' ? code : 1,
              stdout: out,
              stderr: errOut,
              timedOut: false,
            });
            return;
          }
          resolve({ exitCode: 0, stdout: out, stderr: errOut, timedOut: false });
        },
      );
    });

    const stderrFinal = result.timedOut
      ? `${result.stderr}<timeout after ${params.timeout}ms>`.trim()
      : result.stderr;

    return {
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: stderrFinal,
      duration_ms: Date.now() - startedAt,
    };
  }

  // ── read_agent_log_messages（task-02 / 2026-08-23-agent-log-conversation-view）──

  /**
   * `read_agent_log_messages(path, format, beforeSeq?) → { status, messages,
   * truncated, totalSegments, skippedLines }`（design §7.1，外层 camelCase；
   * messages 内层 NormalizedLogMessage snake_case 原样透传）。
   *
   * agent 日志对话化读取第 10 方法：backend platform_sync 经 ws_rpc 转发
   * platform_agent_logs 落库的 path + format，daemon 在宿主读原文并解析为
   * 归一化对话消息（FR-02），替代 256KB 原文尾部直出口径。
   *
   * **错误双通道分层**（Grill B3 裁决 / design §7.1）——「RPC 成功≠解析成功」：
   *   - 走 throw RpcError（与 readFile 完全同通道同 code，backend 既有映射零改动）：
   *     越界 `forbidden`（assertWithinAllowedRoots）；文件不存在 `not_found`（toRpcError）。
   *   - 走 status 结构化返回（不抛）：未注册 format → `unsupported`（registry 判 null，
   *     不进解析器；FR-04 二进制格式在 backend 409 黑名单拦截，daemon 侧 unsupported
   *     兜底）；超 20MB → `too_large`（lstat 预判，不读全文入内存）；其余
   *     parsed / parse_error 由解析器产出（task-01 契约）。
   *
   * 处理顺序：白名单守卫（不论 format 注册与否都先过，安全铁律）→ 注册表分发
   * （null → unsupported，避免无谓文件 IO）→ lstat 预判大小 → readFile utf8 全量
   * 交解析器（透传 content + beforeSeq；解析器内部 20MB 预算为兜底，task-01 契约）。
   */
  async readAgentLogMessages(
    path: string,
    format: string,
    beforeSeq?: number,
  ): Promise<AgentLogMessagesResult> {
    // 1. 白名单守卫（与 readFile 同款）：越界抛 forbidden RpcError。
    assertWithinAllowedRoots(path, this._rootsProvider());
    const abs = pathResolve(path);

    // 2. 注册表分发：未注册 format → unsupported（不进解析器、不读文件；
    //    含二进制格式串透传到达时的 daemon 侧兜底，D-002）。
    const parser = getAgentLogParser(format);
    if (parser === null) {
      return {
        status: 'unsupported',
        messages: [],
        truncated: false,
        totalSegments: 0,
        skippedLines: 0,
      };
    }

    // 3. lstat 预判大小（超 20MB → too_large，不读全文入内存；阈值与解析器内部
    //    预算共用同一常量 DEFAULT_MAX_CONTENT_BYTES，两侧不漂移）。
    let info: Stats;
    try {
      info = await lstat(abs);
    } catch (e) {
      throw toRpcError(e, 'host_fs.read_agent_log_messages.lstat');
    }
    if (info.size > DEFAULT_MAX_CONTENT_BYTES) {
      return {
        status: 'too_large',
        messages: [],
        truncated: false,
        totalSegments: 0,
        skippedLines: 0,
      };
    }

    // 4. readFile utf8 全量（不存在/读失败 → toRpcError 抛 not_found，
    //    与 readFile 同通道）→ 透传 content + beforeSeq 交解析器，原样回传
    //    { status, messages, truncated, totalSegments, skippedLines }。
    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch (e) {
      throw toRpcError(e, 'host_fs.read_agent_log_messages');
    }
    return parser(content, { beforeSeq: beforeSeq ?? null });
  }
}
