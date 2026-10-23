/**
 * turn-file-diff.ts —— 轮文件变更弹窗的**数据纯映射**（2026-10-23-turn-file-diff-dialog
 * task-01）。零 DOM / 零 React / 零 fetch。
 *
 * 数据源（全部既有，零后端改动）：本轮 agent_run_logs——
 *   - tool_call 行（channel="tool_call"）：content_redacted = JSON
 *     `{tool, args:{file_path…}, tool_use_id}`（backend sdk_pipeline 双写之一起）；
 *   - 编辑结果行：edit_patch 列 = structuredPatch JSON 串（hunks 带真实文件行号）。
 *   **配对键**：`metadata.agent_event.call_id`（新轨事件逐行落库；`agent_run_logs`
 *   无顶层 tool_use_id 列，顶层键仅 slim 截断时内存回填）——见 `entryCallId`。
 *
 * 归因口径（与文件变更卡一致的对齐点）：文件卡 numstat 归因不区分主/子代理，
 * 本映射同样按「本轮全部日志（含 subagent 行）」配对——子代理对同一文件的编辑
 * 也是该文件本轮的真实改动，不做主/子过滤（过滤反而丢内容）；但**回退配对**
 * 按 `parent_tool_use_id` 轨道隔离（并行子代理形态下跨轨配对会张冠李戴）。
 *
 * 诚实性约束（FR-03）：配不到补丁返回空数组（弹窗出如实说明）；edit_patch 在但
 * JSON 形状不可解析 → 段保留 rows=null（占位说明），**不静默丢弃、不伪造 diff**。
 */

import { parseStructuredPatch } from "@/components/agent-log/tool-diff";
import type { DiffRow } from "@/components/agent-log/tool-diff";
import type { AgentRunLogEntry } from "@/lib/agent";

/** 单次编辑补丁段：工具名 + 行级 diff 行（rows=null = 补丁形状不可解析的占位段）。 */
export interface TurnFilePatchSection {
  toolName: string;
  rows: DiffRow[] | null;
}

/** tool 入参里可能的文件路径字段（Claude 工具族命名，按命中率排序）。 */
const FILE_PATH_ARG_KEYS = ["file_path", "notebook_path", "path"] as const;

/** 从 tool args 提取文件路径（无/非字符串 → null）。 */
export function toolCallFilePath(args: Record<string, unknown>): string | null {
  for (const key of FILE_PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** 路径归一：反斜杠 → posix 分隔符，剥 `./` 前缀（大小写敏感，git 路径口径）。 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * tool 入参路径是否指向目标仓根相对路径：全等或「以 /<rel> 结尾」的后缀匹配
 * （绝对路径 C:\repo\frontend\src\a.ts ⊃ frontend/src/a.ts）。后缀必须整段对齐
 * （ab.ts 不匹配 a.ts）。
 */
export function matchesRepoPath(argPath: string, repoRelPath: string): boolean {
  const arg = normalizePath(argPath);
  const rel = normalizePath(repoRelPath);
  return arg === rel || arg.endsWith(`/${rel}`);
}

/** tool_call 行解析产物（解析失败的行不进配对池）。 */
interface ParsedToolCall {
  toolName: string;
  filePath: string | null;
  toolUseId: string | null;
}

/** tool_call 行 content JSON → {tool, args, tool_use_id}（与 tool-args-detail 同容错口径）。 */
function parseToolCallEntry(entry: AgentRunLogEntry): ParsedToolCall | null {
  if (entry.channel !== "tool_call") return null;
  const raw = entry.content_redacted;
  if (typeof raw !== "string" || raw.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (obj == null || typeof obj !== "object") return null;
  const record = obj as { tool?: unknown; args?: unknown; tool_use_id?: unknown };
  if (typeof record.tool !== "string" || record.tool.length === 0) return null;
  const args =
    record.args != null && typeof record.args === "object"
      ? (record.args as Record<string, unknown>)
      : {};
  const toolUseId =
    typeof record.tool_use_id === "string" && record.tool_use_id.length > 0
      ? record.tool_use_id
      : null;
  return { toolName: record.tool, filePath: toolCallFilePath(args), toolUseId };
}

/**
 * DiffRow[] → unified 前缀文本（2026-10-23-diff-dialog-copy-fallback / FR-01/02）。
 *
 * 复制兜底的数据源：DiffView 的 2000 行上限只是渲染截断（rows 本身完整），本函数
 * 对全部行重建 `-` / `+` / 空格 前缀文本；parseStructuredPatch 在多 hunk 间插入的
 * 「…」视觉分隔（type=ctx 且 oldNo/newNo 均 null）不是真实 diff 行，剔除不进入
 * 复制文本。不拼造 unified header（hunk 边界信息已丢，伪造会误导 git apply）。
 */
export function diffRowsToText(rows: readonly DiffRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.type === "ctx" && row.oldNo == null && row.newNo == null) continue;
    const prefix = row.type === "del" ? "-" : row.type === "add" ? "+" : " ";
    lines.push(prefix + row.text);
  }
  return lines.join("\n");
}

/**
 * 本轮日志 + 仓根相对路径 → 按编辑完成序（日志序）的补丁段列表。
 *
 * 配对键（2026-10-23-diff-dialog-pairing-fix 评审修正）：**优先
 * `metadata.agent_event.call_id`**——新轨事件逐行落库该键（backend
 * submit_steps.py `metadata_['agent_event']`，tool_call 与 edit_patch 行都有），
 * 弹窗日志行顶层的 `tool_use_id` 并非 DB 列（仅 slim 截断时内存回填），旧实现只读
 * 顶层键 → ①精确配对在真实链路上从未生效，全部补丁落到②启发式配对，多文件编辑
 * 轮必然张冠李戴（实证会话 49c5c3ec / run 63130ca1，点 task-runner.test.ts 显示
 * design.md 内容）。回退面：顶层 `tool_use_id`（slim）> tool_call content JSON 内
 * `tool_use_id`（旧轨）。
 *
 * ① 精确配对：任一侧取得相同 id 即配对成功（跨子代理轨道也成立——id 全局唯一）。
 * ② 回退（两侧都取不到 id）：**按子代理轨道隔离 + 同轨唯一悬置**——平台支持后台
 * 子代理并行（事件按到达序落库，主代理与子代理行交错），跨轨配对会把 A 的补丁
 * 挂到 B 名下；因此回退只在「同轨（parent_tool_use_id 相同）、日志序上已出现、
 * 未被①消费的编辑族调用恰好一个」时配对，否则该段诚实丢弃（不伪造归属）。
 */
export function collectTurnFilePatches(
  logs: readonly AgentRunLogEntry[],
  repoRelPath: string,
): TurnFilePatchSection[] {
  interface CallEntry {
    parsed: ParsedToolCall;
    /** 轨道键（parent_tool_use_id；主代理 `__main__`）——子代理并行隔离面。 */
    track: string;
    /** 是否编辑族（只有编辑族进②回退候选面）。 */
    patchEligible: boolean;
  }

  const trackOf = (entry: AgentRunLogEntry): string => entry.parent_tool_use_id ?? "__main__";
  const calls: CallEntry[] = [];
  const callIndexById = new Map<string, number>();
  /** 日志行 → calls 下标（第二遍免重复解析；仅解析成功的 tool_call 行在场）。 */
  const callIndexByEntry = new Map<AgentRunLogEntry, number>();

  // 第一遍：全量预建 call 索引（①按 id 随机访问——容忍 result 行先于 call 行的
  // 同时间戳乱序批次；评审 P3 要求，勿改回单遍增量建索引）。
  for (const entry of logs) {
    if (entry.channel !== "tool_call") continue;
    const parsed = parseToolCallEntry(entry);
    if (!parsed) continue;
    const index = calls.length;
    // 调用侧配对键以 metadata.agent_event.call_id 为主（content JSON 的
    // tool_use_id 为旧轨来源；metadata 缺失时回退）。
    const id = entryCallId(entry) ?? parsed.toolUseId;
    calls.push({
      parsed,
      track: trackOf(entry),
      patchEligible: isPatchEligibleToolName(parsed.toolName),
    });
    callIndexByEntry.set(entry, index);
    if (id != null && !callIndexById.has(id)) callIndexById.set(id, index);
  }

  const callUsed = new Array<boolean>(calls.length).fill(false);
  /** 轨道 → 日志序上「已出现、未消费」的编辑族调用下标（②回退候选面）。 */
  const appearedByTrack = new Map<string, number[]>();

  const paired: { call: ParsedToolCall | null; patch: string }[] = [];

  for (const entry of logs) {
    if (entry.channel === "tool_call") {
      const index = callIndexByEntry.get(entry);
      if (index == null) continue; // 解析失败行不进 calls（第一遍同口径）
      const call = calls[index];
      if (call == null || !call.patchEligible) continue;
      const list = appearedByTrack.get(call.track) ?? [];
      list.push(index);
      appearedByTrack.set(call.track, list);
      continue;
    }
    const patch = entry.edit_patch;
    if (typeof patch !== "string" || patch.length === 0) continue;
    let call: ParsedToolCall | null = null;
    // ① 精确配对：id 全局唯一，跨轨道也成立。
    const resultId = entryCallId(entry);
    // 结果行「有 id 但索引未命中」= 其调用行缺失/不可解析（如 content 超 50KB
    // 落库截断）或同 id 已被消费——归属已由 id 语境确定，**禁止**回落②把补丁
    // 错挂到同轨其他悬置调用（评审 P3b）。
    let exactOrphaned = false;
    if (resultId != null) {
      const index = callIndexById.get(resultId);
      if (index != null && !callUsed[index]) {
        callUsed[index] = true;
        call = calls[index]?.parsed ?? null;
      } else {
        exactOrphaned = true;
      }
    }
    // ② 回退（仅两侧都取不到 id 的补丁）：**同轨**已出现未消费的编辑族调用恰好
    //    一个才配（串行执行下即其归属；同轨 >1 = 同执行体并行多 tool_use，跨轨 =
    //    子代理交错——均无法确证归属，诚实丢弃，不把 A 的补丁挂到 B 名下）。
    if (call == null && !exactOrphaned) {
      const track = trackOf(entry);
      const candidates = (appearedByTrack.get(track) ?? []).filter((i) => !callUsed[i]);
      if (candidates.length === 1) {
        const index = candidates[0]!;
        callUsed[index] = true;
        call = calls[index]?.parsed ?? null;
      }
    }
    paired.push({ call, patch });
  }

  const sections: TurnFilePatchSection[] = [];
  for (const item of paired) {
    if (item.call == null) continue;
    if (item.call.filePath == null || !matchesRepoPath(item.call.filePath, repoRelPath)) {
      continue;
    }
    sections.push({ toolName: item.call.toolName, rows: parseStructuredPatch(item.patch) });
  }
  return sections;
}

/**
 * 日志行 → 工具调用 id（配对键单一入口）：
 *   ① `metadata.agent_event.call_id`——新轨事件逐行落库的真实 id（主来源）；
 *   ② 顶层 `tool_use_id`——slim 截断时的内存回填（DB 无此列）；
 * 均缺 → null（该行不提供配对键）。
 */
function entryCallId(entry: AgentRunLogEntry): string | null {
  const metadata = entry.metadata;
  if (metadata != null && typeof metadata === "object") {
    const event = (metadata as Record<string, unknown>).agent_event;
    if (event != null && typeof event === "object") {
      const callId = (event as Record<string, unknown>).call_id;
      if (typeof callId === "string" && callId.length > 0) return callId;
    }
  }
  if (typeof entry.tool_use_id === "string" && entry.tool_use_id.length > 0) {
    return entry.tool_use_id;
  }
  return null;
}

/**
 * 回退配对（②）的编辑族工具先验：structuredPatch 抓取链不限工具名（Edit 与
 * Write 覆盖写均携带），但回退没有 id 可查，必须收紧到「可能有补丁」的调用，
 * 否则 Bash/Read 等调用会吃走 Edit 的补丁。按「含 edit / write / patch 词根」
 * 宽匹配，覆盖 apply_patch / edit_file / write_file 等方言；不含这些词根的工具名
 * （如 str_replace）不入候选面——宁可少配不误配。
 */
function isPatchEligibleToolName(toolName: string): boolean {
  const lowered = toolName.toLowerCase();
  return lowered.includes("edit") || lowered.includes("write") || lowered.includes("patch");
}
