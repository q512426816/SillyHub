/**
 * 轨迹账本视图模型（2026-10-22-trajectory-view-redesign / D-013 / D-014 / D-019）。
 *
 * 纯函数层：把 `Trajectory`（数据层产物）转成账本可直接渲染的分组/行模型，
 * 并承担折叠与搜索语义。无 React、无副作用，便于单测。
 *
 * 语义（与 design §接口定义一致）：
 *   - 分组：按 `row.turnIndex` 聚合成 `LedgerGroupView`；
 *   - 轮次折叠：每个轮次只保留首个内容行，其余替换为一条摘要行；
 *   - 调用折叠：连续的工具行（≥2）合并为一条「N 个工具调用 · 名称列表」摘要行；
 *   - 搜索：空格分词 AND、大小写不敏感；命中时**忽略折叠**，只显示命中行；
 *   - 产品路径行型固定六类（D-006/FR-06），不构造不存在的行型。
 */

import type {
  Trajectory,
  TrajectoryRow,
  TrajectoryRowKind,
} from "./build-trajectory";

/** 类型标签文案（产品路径六类；dev 路径多出的类型沿用同名标签）。 */
export const KIND_LABEL: Record<TrajectoryRowKind, string> = {
  user: "用户",
  assistant: "助手",
  thinking: "思考",
  tool: "工具",
  tool_result: "结果",
  system: "系统",
  compaction: "压缩",
  error: "错误",
};

export type LedgerRowViewKind = "record" | "summary";

export interface LedgerRowView {
  /** record = 真实记录行；summary = 折叠摘要行（不可选中）。 */
  kind: LedgerRowViewKind;
  /** record 行携带原始数据；summary 行为 null。 */
  record: TrajectoryRow | null;
  /** 类型标签 / 摘要行的伪标签。 */
  kindLabel: string;
  summary: string;
  /** 行尾「→ 结果摘要」（有结果时）。 */
  resultSummary?: string;
  /** 摘要行对应的折叠轴：turn = 整轮折叠，calls = 一组工具调用折叠。 */
  collapseAxis?: "turn" | "calls";
  /** 摘要行要折叠/展开的目标 key（轮次号或调用组 key）。 */
  collapseKey?: string;
  /** 子工具缩进层级（渲染端换算 px）。 */
  depth: number;
}

export interface LedgerGroupView {
  turnIndex: number;
  /** 展示行（含摘要行；已按折叠/搜索过滤）。 */
  rows: LedgerRowView[];
  /** 该轮真实记录数（不含摘要行）。 */
  stepCount: number;
  toolCallCount: number;
  /** 搜索命中但父轮被折叠时不使用；保留给渲染端做轮次头。 */
  isTurnStart: boolean;
}

export interface LedgerViewOptions {
  collapsedTurns: ReadonlySet<number>;
  collapsedCalls: ReadonlySet<string>;
  query: string;
}

/** 连续工具行（≥2）组成一个可折叠调用组；key = 组内首行 id。 */
export function collectCollapsibleCallGroups(
  trajectory: Trajectory,
): Array<{ key: string; rowIds: string[]; names: string[] }> {
  const groups: Array<{ key: string; rowIds: string[]; names: string[] }> = [];
  let current: { key: string; rowIds: string[]; names: string[] } | null = null;

  const flush = () => {
    if (current && current.rowIds.length >= 2) groups.push(current);
    current = null;
  };

  let currentTurn: number | null = null;
  for (const row of trajectory.rows) {
    // 跨轮不合并：调用组只在本轮内连续工具行之间成立（P3 修复）。
    if (currentTurn !== null && row.turnIndex !== currentTurn) flush();
    currentTurn = row.turnIndex;
    if (row.kind === "tool" || row.kind === "tool_result") {
      if (!current) {
        current = { key: row.id, rowIds: [row.id], names: [] };
      } else {
        current.rowIds.push(row.id);
      }
      const name = row.toolName ?? KIND_LABEL[row.kind];
      if (!current.names.includes(name)) current.names.push(name);
      continue;
    }
    flush();
  }
  flush();
  return groups;
}

function clipSummary(text: string | undefined, max = 160): string {
  if (!text) return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** 工具行摘要：优先主参数/命令，其次工具名。 */
/** 行标签：system_event 派生行显示「上下文」（dsh 对照的 context 类）；
 *  团队派发指令识别行显示「系统」（dsh 对照的 system 类）。 */
function recordKindLabel(row: TrajectoryRow): string {
  if (row.kind === "system" && row.meta?.contextEvent) return "上下文";
  if (row.kind === "system" && row.meta?.systemBrief) return "系统";
  return KIND_LABEL[row.kind] ?? row.kind;
}

function recordSummary(row: TrajectoryRow): string {
  if (row.kind === "tool") {
    const base = row.toolName ?? "tool";
    const detail = clipSummary(row.inputText, 120);
    return detail ? `${base} · ${detail}` : base;
  }
  const text = clipSummary(row.outputText ?? row.inputText);
  return text || row.toolName || KIND_LABEL[row.kind] || "—";
}

function recordResultSummary(row: TrajectoryRow): string | undefined {
  if (row.kind !== "tool") return undefined;
  // 工具行 outputText 即配对结果（D-015）；与输入相同时不重复展示。
  if (!row.outputText || row.outputText === row.inputText) return undefined;
  return clipSummary(row.outputText, 90);
}

function searchFields(row: TrajectoryRow): string[] {
  return [
    recordKindLabel(row),
    KIND_LABEL[row.kind] ?? "",
    row.toolName ?? "",
    row.inputText ?? "",
    row.outputText ?? "",
    row.status,
  ];
}

function matchesQuery(row: TrajectoryRow, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = searchFields(row).join("\n").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function summaryRow(
  text: string,
  axis: "turn" | "calls",
  key: string,
  depth: number,
): LedgerRowView {
  return {
    kind: "summary",
    record: null,
    kindLabel: "",
    summary: text,
    collapseAxis: axis,
    collapseKey: key,
    depth,
  };
}

/**
 * 账本视图：分组 + 折叠 + 搜索。
 *
 * @param trajectory 数据层产物
 * @param options 折叠集合与搜索词（query 非空时忽略折叠，D-013）
 */
export function buildLedgerView(
  trajectory: Trajectory,
  options: LedgerViewOptions,
): LedgerGroupView[] {
  const tokens = options.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const searching = tokens.length > 0;

  const callGroups = collectCollapsibleCallGroups(trajectory);
  const callGroupOf = new Map<string, { key: string; names: string[] }>();
  for (const group of callGroups) {
    for (const rowId of group.rowIds) {
      callGroupOf.set(rowId, { key: group.key, names: group.names });
    }
  }

  const groups: LedgerGroupView[] = [];
  let currentGroup: LedgerGroupView | null = null;
  let turnRecords: TrajectoryRow[] = [];

  const flushTurn = () => {
    if (!currentGroup) return;
    const turnIndex = currentGroup.turnIndex;
    const rows = turnRecords;

    if (searching) {
      // 搜索：只保留命中记录，不做任何折叠摘要。
      currentGroup.rows = rows
        .filter((row) => matchesQuery(row, tokens))
        .map((row) => ({
          kind: "record" as const,
          record: row,
          kindLabel: recordKindLabel(row),
          summary: recordSummary(row),
          resultSummary: recordResultSummary(row),
          depth: row.depth,
        }));
      currentGroup.stepCount = currentGroup.rows.length;
      currentGroup.toolCallCount = rows.filter((row) => row.kind === "tool").length;
      if (currentGroup.rows.length > 0) groups.push(currentGroup);
      currentGroup = null;
      turnRecords = [];
      return;
    }

    const turnCollapsed = options.collapsedTurns.has(turnIndex);
    if (turnCollapsed && rows.length > 1) {
      const first = rows[0]!;
      const toolCalls = rows.filter((row) => row.kind === "tool").length;
      currentGroup.rows = [
        {
          kind: "record",
          record: first,
          kindLabel: KIND_LABEL[first.kind] ?? first.kind,
          summary: recordSummary(first),
          resultSummary: recordResultSummary(first),
          depth: 0,
        },
        summaryRow(
          `${rows.length} 个步骤${toolCalls > 0 ? ` · ${toolCalls} 个工具调用` : ""}`,
          "turn",
          String(turnIndex),
          0,
        ),
      ];
      currentGroup.stepCount = rows.length;
      currentGroup.toolCallCount = toolCalls;
      groups.push(currentGroup);
      currentGroup = null;
      turnRecords = [];
      return;
    }

    currentGroup.rows = [];
    for (const row of rows) {
      const callGroup = callGroupOf.get(row.id);
      const collapsedCall = callGroup ? options.collapsedCalls.has(callGroup.key) : false;
      if (collapsedCall && callGroup) {
        // 只在组首行插入一条摘要，组内其余行隐藏。
        if (callGroup.key === row.id) {
          currentGroup.rows.push(
            summaryRow(
              `${callGroup.names.length} 个工具调用 · ${callGroup.names.join(" · ")}`,
              "calls",
              callGroup.key,
              row.depth,
            ),
          );
        }
        continue;
      }
      currentGroup.rows.push({
        kind: "record",
        record: row,
        kindLabel: recordKindLabel(row),
        summary: recordSummary(row),
        resultSummary: recordResultSummary(row),
        depth: row.depth,
      });
    }
    currentGroup.stepCount = rows.length;
    currentGroup.toolCallCount = rows.filter((row) => row.kind === "tool").length;
    groups.push(currentGroup);
    currentGroup = null;
    turnRecords = [];
  };

  for (const row of trajectory.rows) {
    if (!currentGroup || currentGroup.turnIndex !== row.turnIndex) {
      flushTurn();
      currentGroup = {
        turnIndex: row.turnIndex,
        rows: [],
        stepCount: 0,
        toolCallCount: 0,
        isTurnStart: true,
      };
    }
    turnRecords.push(row);
  }
  flushTurn();

  return groups;
}

/** 可见记录行 id（键盘导航与选中校验用，D-014）。 */
export function visibleRecordIds(groups: LedgerGroupView[]): string[] {
  const ids: string[] = [];
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.kind === "record" && row.record) ids.push(row.record.id);
    }
  }
  return ids;
}
