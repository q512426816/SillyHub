
/**
 * dialog 模式 view 状态机与装配 helper（ISP 同款；自 session-panel.tsx 拆出，
 * task-14 / 2026-09-07-arch-large-file-split design §5 Wave 3，原样搬移零行为变化）。
 */

import {
  transferAssemblerInternals, type AssembledTurn, type AssemblerLogInput, type TurnSegment,
} from "@/components/daemon/session-log-assembler";
import {
  type SessionProcessItem, type SessionTurnView, type SessionUiStatus,
} from "@/components/daemon/turn-timeline";
import { PROVIDER_META, type SessionStreamEnvelope } from "@/lib/daemon";

import { upsertTurn, type UpsertOpts } from "./turn-state";

/* ────────────────────── dialog 模式内部子组件（零 react-query，R4） ────────────────────── */

/** attach 模式轮询常量（ISP task-10 同款）。 */
export const ATTACH_POLL_MS = 1500;
const ATTACH_POLL_TIMEOUT_MS = 15000;
export const ATTACH_POLL_MAX_ATTEMPTS = Math.ceil(ATTACH_POLL_TIMEOUT_MS / ATTACH_POLL_MS); // 10

export function getProviderLabel(provider: string): string {
  return PROVIDER_META[provider]?.label ?? provider;
}

/**
 * dialog 模式 view 状态机（ISP InteractiveSessionView 同款）：sessionId 由
 * createSession 成功 / attach props 写入；status 覆盖 SessionUiStatus 全态
 * （idle/creating/ending/reconnecting 为 dialog 特有，D11——page 模式状态从
 * detailQuery 派生，两机制按 mode 严格互斥，R5）。terminatingAt（lease 终止
 * 观测窗口，D5）非空时显示「终止中…」横幅，onSessionEnded 清空。
 * task-10（design A5/A6）：suspended——attach 目标会话处于挂起态（daemon 不
 * 在线）。SessionUiStatus 无此值（turn-timeline 词表不扩），挂起展示由本标志
 * 独立承载：info 横幅 + 输入禁用；attach 轮询不把它计为恢复失败（挂起窗口
 * 以小时计，超出 15s 轮询上限是常态），daemon 重启转 reconnecting/active 后
 * 自动收敛。
 */
export interface SessionDialogView {
  sessionId: string | null;
  status: SessionUiStatus;
  /** task-10：attach 目标会话挂起中（backend status === 'suspended'）。 */
  suspended: boolean;
  currentRunId: string | null;
  turns: SessionTurnView[];
  errorMsg: string | null;
  terminatingAt: string | null;
}

export const INITIAL_DIALOG_VIEW: SessionDialogView = {
  sessionId: null,
  status: "idle",
  suspended: false,
  currentRunId: null,
  turns: [],
  errorMsg: null,
  terminatingAt: null,
};

/**
 * SSE envelope → 装配器归一输入（ISP toAssemblerLogInput 同款；与 page 模式
 * applyEnvelopeToTurn 的内联归一同构——归属字段驼峰化、可选缺省归一 null）。
 */
export function toAssemblerLogInput(env: SessionStreamEnvelope): AssemblerLogInput {
  return {
    logId: env.log_id,
    channel: env.channel,
    content: env.content,
    timestamp: env.timestamp,
    segmentId: env.segment_id ?? null,
    stale: env.stale ?? null,
    parentToolUseId: env.parent_tool_use_id ?? null,
    subagentType: env.subagent_type ?? null,
    depth: env.depth ?? null,
    toolKind: env.tool_kind ?? null,
    editPatch: env.edit_patch ?? null,
  };
}

/**
 * dialog turn → 装配器视角（ISP assembledViewOf 同款，R1/D13）：segments 缺省
 * （第三方构造的 initialTurns 旧形状 turn）先把 legacy 字段反投影为段序列再入
 * 装配器——装配器的 output / processItems 投影从段树重算，不反投影会把既有
 * output 清空。反投影内容等价：processItems 依序映射 + output 尾挂单一 text 段。
 * 正常路径（本面板占位 turn / logsToTurns 历史 turn）segments 均有值，不触发。
 */
export function assembledViewOf(turn: SessionTurnView): AssembledTurn {
  const view: AssembledTurn = {
    segments:
      turn.segments ?? bootstrapLegacySegments(turn.output, turn.processItems ?? []),
    output: turn.output,
    processItems: turn.processItems ?? [],
    turnStartedAt: turn.turnStartedAt ?? null,
    seenLogIds: turn.seenLogIds,
  };
  // F7：视图与 turn 的 segments 同源（segments 有值时同引用），转移装配器增量
  // 内部状态（投影 cell / 段 id 索引），保持 O(1) 增量链跨视图不断链。
  transferAssemblerInternals(view, turn as AssembledTurn);
  return view;
}

/**
 * legacy 字段反投影（assembledViewOf 的 segments 缺省分支专用，ISP 同款）：tool
 * 项的 toolName / primary 无源置 null（渲染按 R-07 原样显示 raw，内容保全优先）。
 * id 用 legacy: 前缀防与装配器派生 id 撞车。
 */
function bootstrapLegacySegments(
  output: string,
  items: SessionProcessItem[],
): TurnSegment[] {
  const segments: TurnSegment[] = items.map((item, i): TurnSegment => {
    if (item.kind === "thinking") {
      return {
        kind: "thinking",
        id: `legacy:thinking:${i}`,
        text: item.text,
        streaming: false,
        ts: item.ts ?? null,
      };
    }
    if (item.kind === "stderr") {
      return { kind: "stderr", id: `legacy:stderr:${i}`, text: item.text, ts: item.ts ?? null };
    }
    if (item.kind === "file") {
      // agent-file-upload-mcp：file 过程项反投影回 file 段（字段一一对应）
      return {
        kind: "file",
        id: `legacy:file:${i}`,
        fileId: item.fileId,
        name: item.name,
        size: item.size,
        mime: item.mime,
        description: item.description ?? "",
        ts: item.ts ?? null,
      };
    }
    return {
      kind: "tool",
      id: `legacy:tool:${i}`,
      raw: item.raw,
      result: item.result,
      status: item.status,
      toolName: null,
      primary: null,
      startedAt: item.ts ?? null,
      endedAt: null,
      children: [],
      subagentType: null,
    };
  });
  if (output) {
    segments.push({
      kind: "text",
      id: "legacy:text",
      text: output,
      streaming: false,
      startedAt: null,
    });
  }
  return segments;
}

/**
 * dialog 版 upsert 入口：复用共享 upsertTurn（PAGE 基底 + healToRunning，R1——
 * 它覆盖 attach 竞态日志迟到场景，对 dialog attach 同样成立），把 view 的
 * turns / currentRunId 子集映射回 view（其余 view 字段不动）。
 */
export function upsertDialogTurn(
  prev: SessionDialogView,
  env: SessionStreamEnvelope,
  apply: (_turn: SessionTurnView) => SessionTurnView,
  opts: UpsertOpts,
): SessionDialogView {
  return {
    ...prev,
    ...upsertTurn({ turns: prev.turns, currentRunId: prev.currentRunId }, env, apply, opts),
  };
}
