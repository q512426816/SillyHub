/**
 * task-01（2026-10-14-session-turn-preview-cards / FR-01 / FR-04 / D-004@v1）：
 * 消息流归并层——turn-outline 大纲条目与已加载真实轮归并为单一列表（合并式单一
 * 数据源，方案 A），未加载轮合成带 preview 摘要的预览条目，由 turn-timeline 渲染
 * 为 TurnPreviewCard（task-02）。
 *
 * 归并规则：
 *   - outline（seq 升序全量权威轮序）为骨架逐位落子：命中 turns 且「有实质内容或
 *     活跃」→ 透传真实轮原引用（下游 memo 命中）；命中但是空壳块（enrich 孤儿
 *     补建的静默配置行等）→ 预览条目原位替代（配置行墙由预览卡统一收敛，用户
 *     痛点）；未命中 → 预览条目。
 *   - 无内容终态轮（2026-10-19-preview-card-empty-turn-fix，isContentlessTerminalItem）
 *     不出预览卡：纯切换档案轮（backend inject.py silent_config_switch）建 run
 *     刻意零日志，单轮直达查回 0 条走 empty 短路，「点击展开」是永久展不开的
 *     死卡——命中（孤儿配置行/已加载空壳）原引用透传（紧凑配置行语义保留，
 *     2026-10-14 design 非目标），未命中不生成条目（深历史静默轮不可见）。
 *   - turns 中大纲外轮（实时新轮 SSE 先到 / 大纲滞后）：原样尾部追加，顺序保持
 *     （enrich 孤儿窗口规则 ql-20260916-016 的既有语义不归本函数管，保守不吞）。
 *   - outline 缺失 / 空（拉取失败、旧 daemon、空会话）→ 原样返回输入引用（FR-04
 *     降级：页面回到现状形态，不崩不空）。
 */

import { createEmptyAssembledTurn } from "@/components/daemon/session-log-assembler";
import type { SessionTurnView, TurnUiStatus } from "@/components/daemon/turn-timeline";
import type {
  SessionTurnOutlineItem,
  SessionTurnOutlineRead,
} from "@/lib/daemon";

/** 预览条目摘要（SessionTurnView.preview；可选字段缺省零回归惯例）。 */
export interface TurnPreviewInfo {
  /** 大纲提问摘要（后端截 60 字；null → undefined 不渲染该行）。 */
  promptSummary?: string;
  /** 大纲答复摘要（null → undefined 不渲染该行）。 */
  answerSummary?: string;
  /** 轮起始时间（started_at 兜底 created_at；卡片时间显示源）。 */
  startedAt?: string | null;
}

/**
 * 预览条目轮状态映射（词表对齐 session-panel-page.tsx mapRunStatus / 后端 run
 * 状态；终点档落 TurnUiStatus 六档——mapRunStatus 的导航五档「stopped」在本域
 * 投影为 killed「已中止」，与 turn-state.ts deriveTurnTerminalStatus 的打断分流
 * 口径一致）。
 */
export function previewTurnStatusOf(
  status: string | null | undefined,
  errorCode?: string | null,
): TurnUiStatus {
  switch (status) {
    case "completed":
    case "finished":
      return "completed";
    case "failed":
    case "error":
      return errorCode === "interactive_interrupted" ? "killed" : "failed";
    // 活跃词表（pending_approval = team 审批轮）；interrupting 前端展示态。
    case "running":
    case "active":
    case "pending":
    case "pending_approval":
    case "interrupting":
      return "running";
    case "killed":
    case "stopped":
    case "interrupted":
    case "cancelled":
      return "killed";
    default:
      return "pending";
  }
}

/**
 * 「有实质内容或活跃」判定—— true 的轮透传真实块，false 的空壳块由大纲预览
 * 条目原位替代：
 *   - 活跃轮（pending/running/interrupting）恒 true（实时流与发送占位不能被
 *     归并层掐断；SSE 内容到达前保留既有思考占位形态）；
 *   - 失败轮（errorDetail 非空）恒 true（RunErrorItem 失败卡是真实内容）；
 *   - 终态轮看正文：prompt / output 任一非空即 true；
 *   - preview 已存在的条目（重入防御）恒 false——继续按大纲对齐，不重复包皮。
 */
function hasRenderableBody(t: SessionTurnView): boolean {
  if (t.preview != null) return false;
  if (
    t.status === "pending" ||
    t.status === "running" ||
    t.status === "interrupting"
  ) {
    return true;
  }
  if (t.errorDetail) return true;
  return t.prompt.trim().length > 0 || t.output.trim().length > 0;
}

/**
 * 无内容终态轮判定（2026-10-19-preview-card-empty-turn-fix）——纯切换档案轮
 * （backend inject.py silent_config_switch：建 run 刻意零日志，实测会话 54317e42
 * 第 2/4/7 轮）。这类轮没有可展开内容，出「点击展开」预览卡只会得到单轮直达
 * 查回 0 条日志、走 empty 静默短路的永久死卡。四条件同时成立才收敛：
 *   - started_at 空 = 从未派发引擎（正常轮派发后必有值；群聊空 user_input 轮
 *     已派发，2026-09-29 幂等语义保留，不归本判定管）；
 *   - error_code 空 = 非失败族（失败轮的失败详情卡是真实内容，展开链路照旧）；
 *   - 摘要双空 = 大纲侧确无提问/答复文本（带摘要轮必有内容可展开）；
 *   - previewTurnStatusOf 映射 completed/killed 终态（running/pending 轮后续
 *     可能产出内容，保留预览卡实时形态）。
 * 导出供跳转（handleJumpToTurn 早退）与预取（prefetchNearbyTurns 跳过）链路
 * 复用——单一判定源，三处口径永不漂移。
 */
export function isContentlessTerminalItem(item: SessionTurnOutlineItem): boolean {
  if (item.started_at != null || item.error_code != null) return false;
  if (item.prompt_summary != null || item.answer_summary != null) return false;
  const ui = previewTurnStatusOf(item.status, item.error_code);
  return ui === "completed" || ui === "killed";
}

/** 大纲条目 → 预览条目（SessionTurnView 全形状；segments/processItems 空产物，
 *  渲染层预览分支最前置不消费段模型）。 */
function buildPreviewTurn(item: SessionTurnOutlineItem): SessionTurnView {
  const empty = createEmptyAssembledTurn();
  return {
    runId: item.run_id,
    turn: item.seq,
    prompt: "",
    output: "",
    status: previewTurnStatusOf(item.status, item.error_code),
    seenLogIds: empty.seenLogIds,
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    errorDetail: null,
    processItems: empty.processItems,
    segments: empty.segments,
    turnStartedAt: null,
    realRunId: item.run_id,
    preview: {
      promptSummary: item.prompt_summary ?? undefined,
      answerSummary: item.answer_summary ?? undefined,
      startedAt: item.started_at ?? item.created_at,
    },
  };
}

/**
 * 轮号盖章缓存（2026-10-14-session-preview-defect-fixes）：logsToTurns 按批次
 * 局部编号（初始窗口末块 N / 单轮直达恒 1 / 翻页批次各起 1），与大纲权威 seq
 * 错位——已加载块经本缓存盖成 seq（RoundDivider/导航/预览卡三处轮号同源）。
 * WeakMap 按原 turn 引用缓存盖章产物：同输入重复派生保持同引用，不击穿
 * TurnRow memo（流式期间每 delta 重派生 displayTurns，无缓存会全量克隆）。
 */
const seqStampCache = new WeakMap<SessionTurnView, SessionTurnView>();

function stampOutlineSeq(hit: SessionTurnView, seq: number): SessionTurnView {
  if (hit.turn === seq) return hit;
  let stamped = seqStampCache.get(hit);
  if (!stamped || stamped.turn !== seq) {
    stamped = { ...hit, turn: seq };
    seqStampCache.set(hit, stamped);
  }
  return stamped;
}

/**
 * 归并纯函数（displayTurns 派生链末端接线，见 session-panel-page displayTurns）。
 * 输入 enrichDisplayTurns 产物（无 preview 字段），输出统一列表；不修改任何输入
 * 对象（真实轮原引用透传——轮号不一致时透传盖章产物，预览条目新建）。
 */
export function mergePreviewIntoDisplayTurns(
  outline: SessionTurnOutlineRead | null,
  turns: SessionTurnView[],
): SessionTurnView[] {
  if (!outline || outline.items.length === 0) return turns;
  const byKey = new Map(
    turns.map((t) => [t.realRunId ?? t.runId, t] as const),
  );
  const seen = new Set<string>();
  const out: SessionTurnView[] = [];
  // 后端保证 seq 升序（sessions.ts turn-outline 契约），客户端按 seq 稳定排序
  // 兜底——对输入顺序鲁棒（seq 同值保持数组原序，成本 O(n log n) 一次性）。
  const ordered = [...outline.items].sort((x, y) => x.seq - y.seq);
  for (const item of ordered) {
    seen.add(item.run_id);
    const hit = byKey.get(item.run_id);
    // 2026-10-19-preview-card-empty-turn-fix：无内容终态轮（纯切换档案轮）不出
    // 预览卡——命中孤儿配置行/已加载空壳原引用透传（盖章对齐 seq，紧凑配置行
    // 语义保留），未命中不生成条目（无可展示内容，深历史静默轮不可见）。
    if (isContentlessTerminalItem(item)) {
      if (hit) out.push(stampOutlineSeq(hit, item.seq));
      continue;
    }
    if (hit && hasRenderableBody(hit)) {
      out.push(stampOutlineSeq(hit, item.seq));
      continue;
    }
    out.push(buildPreviewTurn(item));
  }
  // 大纲外轮尾部追加（实时新轮 / 大纲滞后孤儿）——引用与顺序原样保留。
  for (const t of turns) {
    const key = t.realRunId ?? t.runId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
