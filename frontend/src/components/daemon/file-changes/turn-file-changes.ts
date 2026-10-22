/**
 * 轮工作区快照 → 卡片 props 的**纯映射**（task-11 / 2026-10-20-session-page-dsh-alignment
 * 线 C「1b 第三段」）。零 DOM / 零 React / 零 fetch / 零 store。
 *
 * 依据：
 * - `.sillyspec/changes/2026-10-20-session-page-dsh-alignment/design.md`
 *   「### 文件变更卡 DTO」`TurnFileChangesSnapshot` 契约要点：
 *   ① `attribution="edit_patch"` → `source="tool"`、其余 `"command"` → `source="shell"`；
 *   ② `partial` **不是错误态**——卡片照出，行级 +/− 退化为破折号；
 *   ③ `binary=true` 行同样破折号（numstat 对二进制是 0/0，不能显示成「+0 −0」）；
 *   ④ `capability` 独立成字段，前端**只看 capability、不看字段是否存在**（E6/E8）：
 *      「没有快照」绝不能被渲染成「本轮无改动」。
 * - 「### 1b 承载面与读模型字段」：读模型用顶层 snake_case
 *   `file_changes` / `file_changes_capability`，嵌套快照体是 camelCase。
 *
 * 三态降级（本模块的裁决口径，逐条对应 design E6/E8；2026-10-22-file-card-hide-empty
 * 起「无信息」一律**不出卡**，不再渲染「仅工具编辑」占位）：
 * | 输入 | 输出 |
 * |---|---|
 * | `capability` 与 `snapshot` 双双缺省 | `null`——读模型没接线/该轮无 run 快照，**不出卡、不出占位** |
 * | `capability="tool_only"` | `null`——daemon 无快照能力（老 daemon / 部署前的历史轮）：零信息，不出卡 |
 * | `snapshot=null`（capability 已给） | `null`——同上（显式缺失不静默成「无改动」，也不出占位） |
 * | `status="failed" \| "unavailable"` | `null`——git 不可用 / 非 git 仓：行级数据不可信，且无信息可呈现 |
 * | `status="partial"` 或 `truncated=true` | 正常卡 + `truncated: true`（行级破折号）；`files` 为空时出一行提示卡 |
 * | `status="ok"` 且 `files` 为空 | `null`（确认无改动的快照 → 零渲染空态，不写「本轮无改动」文案） |
 */

import type { components } from "@/lib/api-types";

import type {
  ChangedFile,
  FileChangesCapability,
  FileChangesCardProps,
} from "./file-changes-card";

/** 后端轮次读模型里的快照形状（`SessionRunRead.file_changes`，生成物已含）。 */
export type TurnFileChangesSnapshot = components["schemas"]["TurnFileChangesSnapshot"];
/** 快照内的单文件行。 */
export type TurnFileChange = components["schemas"]["TurnFileChange"];
export type { FileChangesCapability };

/** `toFileChangesCardProps` 的可选透传参数（挂载面提供，不参与判定）。 */
export interface TurnFileChangesCardOptions {
  /** 轮次号（卡片折叠头「第 N 轮」）。 */
  turnNo?: number;
  /** 行点击打开文件（缺省＝行不可跳转，原型同款可选回调）。 */
  onOpenFile?: (_path: string) => void;
  className?: string;
}

/**
 * partial 且无文件列表时的提示文案（D-034）。
 *
 * 语义边界：说的是「没拿到改动清单」，**不是**「本轮没改文件」——后者是 E6/E8 明令
 * 禁止的伪值。超时与队列溢出在快照层面同为 `status="partial"`（daemon 端不区分
 * files 内容），故文案合并表述；精确 `reason` 仍保留在快照里供检查器读取。
 */
export const NOTICE_PARTIAL_NO_FILES = "工作区快照未完成，本轮改动未知";

/**
 * partial 且无文件列表时的提示文案（2026-10-22-file-changes-card-fix）。
 *
 * 按快照精确 `reason` + 采集耗时生成——timeout 与 queue_overflow 不再混成一句
 * 「超时或队列溢出」；无 reason 的 partial（行数退档）用通用文案。
 */
export function fileChangesNotice(snapshot: TurnFileChangesSnapshot): string {
  if (snapshot.reason === "timeout") {
    const duration =
      snapshot.collectMs >= 1000
        ? `${(snapshot.collectMs / 1000).toFixed(1).replace(/\.0$/, "")}s`
        : `${snapshot.collectMs}ms`;
    return `工作区快照采集超时（${duration}），本轮改动未知`;
  }
  if (snapshot.reason === "queue_overflow") {
    return "快照采集排队溢出，本轮改动未知";
  }
  return NOTICE_PARTIAL_NO_FILES;
}

/**
 * 读模型里与文件变更相关的两字段（后端 `SessionRunRead` 已透传）。
 *
 * 前端手工维护的镜像 `frontend/src/lib/daemon/sessions.ts` 的 `SessionRunRead`
 * 尚未补这两列（该文件在本任务 allowed_paths 之外）——用**结构化可选字段**读取，
 * 既不改它，也不影响它回补后的类型收窄。
 */
export interface RunFileChangesFields {
  file_changes?: TurnFileChangesSnapshot | null;
  file_changes_capability?: FileChangesCapability | null;
}

/** 可承载文件变更字段的轮视图（结构类型，不依赖 turn-timeline，避免循环 import）。 */
export interface FileChangesTurnFields {
  runId: string;
  realRunId?: string;
  fileChanges?: TurnFileChangesSnapshot | null;
  fileChangesCapability?: FileChangesCapability | null;
}

/** 单文件行映射：归因 → 来源；`edits` 取编辑调用次数（`editToolNames` 长度）。 */
export function toChangedFile(file: TurnFileChange): ChangedFile {
  const toolEdited = file.attribution === "edit_patch";
  const toolNames = toolEdited ? (file.editToolNames ?? undefined) : undefined;
  // untracked（numstat 不覆盖）/ mtime 探测（无行级采集）行级 +/− 不可信；
  // 二进制同理（numstat 恒 0/0）。卡片据此显示破折号而不是假精确的 +0 −0。
  const hasLineStats =
    file.binary !== true &&
    file.status !== "untracked" &&
    file.source !== "mtime";
  return {
    path: file.path,
    adds: file.added,
    dels: file.deleted,
    // command 归因的行没有「本轮编辑次数」概念——填 0，卡片对 edits<=0 不出「改N次」。
    edits: toolEdited ? (toolNames?.length ?? 1) : 0,
    source: toolEdited ? "tool" : "shell",
    status: file.status,
    hasLineStats,
    ...(file.binary === true ? { binary: true } : {}),
    ...(toolNames != null && toolNames.length > 0 ? { editToolNames: toolNames } : {}),
  };
}

/**
 * 轮快照 + capability → 卡片 props（`null` = 不出卡、不出占位）。
 *
 * 判定顺序即上表：先看「有没有这项能力」，再看「快照可信不可信」，最后才谈行级数据。
 * 2026-10-22-file-card-hide-empty：前三条「无信息」分支（tool_only / 无快照 /
 * failed|unavailable）一律返回 `null`——不再渲染「仅工具编辑」占位卡。
 */
export function toFileChangesCardProps(
  snapshot: TurnFileChangesSnapshot | null | undefined,
  capability: FileChangesCapability | null | undefined,
  options: TurnFileChangesCardOptions = {},
): FileChangesCardProps | null {
  // 未接线：两个字段都缺（旧消费方 / 该轮无 run 快照来源）——不出卡也不出占位。
  if (snapshot == null && capability == null) return null;
  // E8：capability 明确为 tool_only＝daemon 不提供工作区快照能力（老 daemon /
  // 部署前的历史轮）——零信息，不出卡（用户裁决：没有信息就隐藏卡片）。
  if (capability === "tool_only") return null;
  // 有 capability 却无快照（backend 声称 full 但没数据）：同样零信息，不出卡。
  if (snapshot == null) return null;
  // 采集失败 / git 不可用：行级统计不可信（不伪造 files），且没有可呈现的信息。
  if (snapshot.status === "failed" || snapshot.status === "unavailable") return null;

  const truncated = snapshot.status === "partial" || snapshot.truncated === true;
  const files = (snapshot.files ?? []).map(toChangedFile);
  // partial 但 daemon 没拿到文件列表（采集超时 / 队列溢出，见 daemon
  // `collectTurnFileChanges` 的 partial 收口）：D-034 —— 卡片照出但只有一行提示，
  // 否则「采集没完成」会被读成「本轮没改文件」（E6/E8 立意）。
  if (files.length === 0 && truncated) {
    return {
      files: [],
      capability: "full",
      turnNo: options.turnNo,
      truncated: true,
      notice: fileChangesNotice(snapshot),
      sharedWorkspace: snapshot.concurrentSessionsHint === true,
      className: options.className,
    };
  }
  // 快照齐全且确实零改动 → 空态零渲染（既有卡片语义）；不写「本轮无改动」文案。
  if (files.length === 0) return null;

  return {
    files,
    capability: "full",
    turnNo: options.turnNo,
    truncated,
    sharedWorkspace: snapshot.concurrentSessionsHint === true,
    onOpenFile: options.onOpenFile,
    className: options.className,
  };
}

/**
 * 投影缓存（保 TurnRow memo）：入参 `turns` 来自 `enrichDisplayTurns`，未变化的轮
 * **保持原对象引用**（ql-20260903-025 身份稳定守卫）；本层若每次重建对象，流式
 * delta 会把所有带快照的轮子树（markdown 解析）全部重渲染。缓存以「原 turn 对象」
 * 为键、以「快照对象 + capability」为校验，同输入恒同输出（WeakMap 随轮对象回收）。
 */
const FILE_CHANGES_PROJECTION_CACHE = new WeakMap<
  FileChangesTurnFields,
  {
    snapshot: TurnFileChangesSnapshot | null;
    capability: FileChangesCapability;
    projected: FileChangesTurnFields;
  }
>();

/**
 * 把 `/runs` 读模型的 `file_changes` / `file_changes_capability` 投影到轮视图上
 * （snake_case → camelCase，唯一职责；取值/分页/SSE 零参与，FR-22）。
 *
 * - `capability` 字段缺失按 `"tool_only"`（E8：字段缺失＝老 daemon，显式降级）；
 * - 命中的 run 缺失（该轮无 run 快照来源）→ 原对象透传，不出卡。
 *
 * 入参 map 的值按 `object` 收口（形状由 `RunFileChangesFields` 声明）：前端手工维护
 * 的镜像 `SessionRunRead` 尚未补这两列（该文件在本任务 allowed_paths 之外），
 * 若直接声明 `ReadonlyMap<string, RunFileChangesFields>`，TS 的 weak-type 规则会因为
 * 「两者没有公共属性」拒绝整个 Map。读取处做一次显式视图声明，等镜像补齐后可原地收紧。
 */
export function attachRunFileChanges<T extends FileChangesTurnFields>(
  turns: T[],
  runsMeta: ReadonlyMap<string, object>,
): T[] {
  if (turns.length === 0 || runsMeta.size === 0) return turns;
  let touched = false;
  const next = turns.map((turn) => {
    const meta = runsMeta.get(turn.realRunId ?? turn.runId) as
      | RunFileChangesFields
      | undefined;
    if (!meta) return turn;
    const snapshot = meta.file_changes ?? null;
    const capability: FileChangesCapability =
      meta.file_changes_capability === "full" ? "full" : "tool_only";
    if (turn.fileChanges === snapshot && turn.fileChangesCapability === capability) return turn;
    const cached = FILE_CHANGES_PROJECTION_CACHE.get(turn);
    if (cached && cached.snapshot === snapshot && cached.capability === capability) {
      touched = true;
      return cached.projected as T;
    }
    const projected = {
      ...turn,
      fileChanges: snapshot,
      fileChangesCapability: capability,
    } as T;
    FILE_CHANGES_PROJECTION_CACHE.set(turn, { snapshot, capability, projected });
    touched = true;
    return projected;
  });
  return touched ? next : turns;
}
