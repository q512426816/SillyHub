/**
 * 过程行语义标签词表（D-025@v1 / 2026-10-20-session-page-dsh-alignment）。
 *
 * **纯展示映射**：只决定「图标 + 中文标签」，不读取也不改写日志原文 / 工具名。
 * 工具名仍由 `turn-segment-views.tsx` 的 ToolRowView 原样渲染（label 之后、
 * 摘要之前，如 `💻 运行命令 · Bash · pnpm vitest…`）；本模块零副作用、零 DOM，
 * 供单测与组件共用，避免两处词表漂移。
 *
 * 固定词表（7 类，不可增删字面量）：
 *
 * | 类别     | 标签     | 图标 | 命中规则 |
 * |----------|----------|------|----------|
 * | thinking | 思考     | 💭   | kind=thinking |
 * | 命令     | 运行命令 | 💻   | Bash / Pwsh / PowerShell / Shell / sh / zsh / cmd / terminal(_send…) / run_command / execute_command |
 * | 文件     | 读写文件 | 📂   | Read / Write / Edit / MultiEdit / NotebookEdit / str_replace_editor（含 snake_case 变体） |
 * | 搜索     | 搜索     | 🔍   | Grep / Glob / WebSearch / web_fetch / CodebaseSearch（含 snake_case 变体） |
 * | 回复     | 回复     | 💬   | kind=text（助手正文段——当前 TextSegmentView 无折叠头，词表先备好，不额外造头） |
 * | 失败     | 失败     | ⚠   | status ∈ error / deny / failed（**优先级最高**，压过类别） |
 * | 其它     | 其它     | 🔧   | 词表外工具名 / 空工具名（**必须保留，禁止丢行**） |
 *
 * 匹配口径：工具名大小写不敏感；`mcp__<server>__<tool>` 前缀取末段参与匹配
 * （只影响匹配，展示名仍是调用方传入的原名）。错误状态优先于一切类别——
 * 失败的 Bash 行显示「失败」而不是「运行命令」。
 */

/** 过程行类别（UI 当前只有 thinking / tool 两种行；text 为词表预留）。 */
export type ProcessKind = "thinking" | "tool" | "text";

/**
 * 行状态：tool 段为 `ok` / `running` / `deny`；`error` / `failed` 为通用错误别名。
 * 其余值（含 null / undefined）一律按「非错误」处理，不参与标签裁决。
 */
export type ProcessStatus = string | null | undefined;

export interface ProcessLabel {
  /** 固定中文标签（词表七选一）。 */
  label: string;
  /** 类别图标（emoji，与既有过程行图标风格一致）。 */
  icon: string;
}

const THINKING: ProcessLabel = { label: "思考", icon: "💭" };
const COMMAND: ProcessLabel = { label: "运行命令", icon: "💻" };
const FILE: ProcessLabel = { label: "读写文件", icon: "📂" };
const SEARCH: ProcessLabel = { label: "搜索", icon: "🔍" };
const REPLY: ProcessLabel = { label: "回复", icon: "💬" };
const FAILED: ProcessLabel = { label: "失败", icon: "⚠" };
const OTHER: ProcessLabel = { label: "其它", icon: "🔧" };

/** 运行命令类工具（全小写；`terminal_*` 家族在下方按前缀兜底）。 */
const COMMAND_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "pwsh",
  "powershell",
  "shell",
  "sh",
  "zsh",
  "cmd",
  "terminal",
  "terminal_send",
  "terminal_send_keys",
  "run_command",
  "execute_command",
]);

/** 读写文件类工具（全小写）。 */
const FILE_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "write",
  "edit",
  "multiedit",
  "multi_edit",
  "notebookedit",
  "notebook_edit",
  "str_replace_editor",
]);

/** 搜索类工具（全小写）。 */
const SEARCH_TOOLS: ReadonlySet<string> = new Set([
  "grep",
  "glob",
  "websearch",
  "web_search",
  "web_fetch",
  "webfetch",
  "codebasesearch",
  "codebase_search",
]);

/** 错误状态别名（tool 段 deny = 失败/被拒；error/failed 为通用写法）。 */
function isErrorStatus(status: ProcessStatus): boolean {
  return status === "error" || status === "deny" || status === "failed";
}

/**
 * 过程行 → 固定语义标签（纯函数）。
 *
 * @param kind     行类别（thinking / tool / text）
 * @param toolName 工具原名（仅 tool 行使用；大小写不敏感，可带 mcp__ 前缀）
 * @param status   行状态（error / deny / failed 一律判「失败」，优先于类别）
 */
export function processLabel(
  kind: ProcessKind,
  toolName?: string | null,
  status?: ProcessStatus,
): ProcessLabel {
  // 失败优先：任何类别的错误行都显示「失败」（状态徽章仍由行组件渲染）。
  if (isErrorStatus(status)) return FAILED;
  if (kind === "thinking") return THINKING;
  if (kind === "text") return REPLY;

  const name = (toolName ?? "").trim().toLowerCase();
  if (!name) return OTHER;
  // mcp__<server>__<tool>：取末段匹配（展示层仍用原名，见文件头）。
  const bare = name.split("__").pop() ?? name;
  if (COMMAND_TOOLS.has(bare) || bare.startsWith("terminal_")) return COMMAND;
  if (FILE_TOOLS.has(bare)) return FILE;
  if (SEARCH_TOOLS.has(bare)) return SEARCH;
  // 词表外工具名 → 其它：**绝不丢行**（新工具上线即隐身是不可接受的回归）。
  return OTHER;
}
