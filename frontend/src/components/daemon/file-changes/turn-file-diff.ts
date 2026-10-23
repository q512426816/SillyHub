/**
 * turn-file-diff.ts —— 轮文件变更弹窗的**数据纯映射**（2026-10-23-turn-file-diff-dialog
 * task-01）。零 DOM / 零 React / 零 fetch。
 *
 * 数据源（全部既有，零后端改动）：本轮 agent_run_logs——
 *   - tool_call 行（channel="tool_call"）：content_redacted = JSON
 *     `{tool, args:{file_path…}, tool_use_id}`（backend sdk_pipeline 双写之一起）；
 *   - 编辑结果行：edit_patch 列 = structuredPatch JSON 串（hunks 带真实文件行号），
 *     tool_use_id 与调用行配对（Anthropic tool_result 块自带）。
 *
 * 归因口径（与文件变更卡一致的对齐点）：文件卡 numstat 归因不区分主/子代理，
 * 本映射同样按「本轮全部日志（含 subagent 行）」配对——子代理对同一文件的编辑
 * 也是该文件本轮的真实改动，不做主/子过滤（过滤反而丢内容）。
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
 * 配对两遍：① result.tool_use_id → 同 id 的 tool_call 行（精确，零改动语义）；
 * ② 遗留 result（无 id 或 id 无主）**就近悬置配对**——仅配给「最近的未消费编辑
 * 族调用」（2026-10-23-diff-dialog-pairing-fix：旧实现「按序塞给路径命中目标文件
 * 的第一个未用调用」在多文件编辑轮必然张冠李戴——实证会话 49c5c3ec / run 63130ca1，
 * 点 task-runner.test.ts 显示 design.md 内容）。协议依据：agent 工具调用**串行**
 * 执行，串行编辑轮无 id 时最近悬置调用即补丁归属；新编辑调用的到来即证明前序
 * 调用 result 已处理（旧悬置=补丁超限/丢失的悬空调用，判死不累计毒化）。无前置
 * 编辑调用（悬置空）→ 该段诚实丢弃（不伪造归属；违反串行假设的真并发日志为
 * 已披露边界，见 design 风险节）。
 */
export function collectTurnFilePatches(
  logs: readonly AgentRunLogEntry[],
  repoRelPath: string,
): TurnFilePatchSection[] {
  // 单遍扫描：日志序即配对序。calls 全量留存（①按 id 索引随机访问），
  // pending 为「已见未消费的编辑族调用」悬置栈（②就近配对的候选面）。
  const calls: ParsedToolCall[] = [];
  const callUsed: boolean[] = [];
  const callIndexById = new Map<string, number>();
  const pending: number[] = [];

  const paired: { call: ParsedToolCall | null; patch: string }[] = [];

  const noteCall = (parsed: ParsedToolCall): void => {
    const index = calls.length;
    calls.push(parsed);
    callUsed.push(false);
    if (parsed.toolUseId != null && !callIndexById.has(parsed.toolUseId)) {
      callIndexById.set(parsed.toolUseId, index);
    }
    if (isPatchEligibleToolName(parsed.toolName)) {
      // 串行协议推理（FR-02）：agent 工具调用顺序执行——新编辑调用到来 ⟹ 前序
      // 调用的 result 已处理（哪怕无补丁）。旧悬置此时必为悬空调用（补丁超 64KB
      // 上限不附着 / result 行丢失），判死清空，防其永久毒化后续无主补丁的配对。
      pending.length = 0;
      pending.push(index);
    }
  };

  for (const entry of logs) {
    if (entry.channel === "tool_call") {
      const parsed = parseToolCallEntry(entry);
      if (parsed) noteCall(parsed);
      continue;
    }
    const patch = entry.edit_patch;
    if (typeof patch !== "string" || patch.length === 0) continue;
    const toolUseId =
      typeof entry.tool_use_id === "string" && entry.tool_use_id.length > 0
        ? entry.tool_use_id
        : null;
    let call: ParsedToolCall | null = null;
    // ① 精确配对：同 id 且未被占用（同 id 多次出现取首个——callIndexById 首写者胜）。
    if (toolUseId != null) {
      const index = callIndexById.get(toolUseId);
      if (index != null && !callUsed[index]) {
        callUsed[index] = true;
        if (pending[pending.length - 1] === index) pending.length = 0;
        call = calls[index] ?? null;
      }
    }
    // ② 就近配对（仅无主补丁）：配给最近悬置的编辑族调用（串行协议下即其归属，
    // noteCall 已把悬置面收敛为最近一个）；无悬置（result 先于任何编辑调用 /
    // ①已消费且后续无新调用）→ 诚实丢弃。
    if (call == null && pending.length > 0) {
      const index = pending[pending.length - 1]!;
      callUsed[index] = true;
      pending.length = 0;
      call = calls[index] ?? null;
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
 * 回退配对（②）的编辑族工具先验：structuredPatch 抓取链不限工具名（Edit 与
 * Write 覆盖写均携带），但回退没有 id 可查，必须收紧到「可能有补丁」的调用，
 * 否则 Bash/Read 等调用会吃走 Edit 的补丁。命名按「含 edit/write/patch 词根」
 * 宽匹配，覆盖 provider 方言（apply_patch / edit_file / str_replace…）。
 */
function isPatchEligibleToolName(toolName: string): boolean {
  const lowered = toolName.toLowerCase();
  return lowered.includes("edit") || lowered.includes("write") || lowered.includes("patch");
}
