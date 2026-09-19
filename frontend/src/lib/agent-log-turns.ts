/**
 * 2026-09-19-tool-report-session-replay task-09（FR-01 / FR-03 / D-001@v1 /
 * D-004@v1 / D-005@v1）：会话回放适配器——纯函数把 messages 端点归一化消息
 * （GET /agent-logs/{entry_id}/messages 的 snake_case 条目）映射成 TurnTimeline
 * 的 SessionTurnView 数组，FR-01 会话样式回放与 FR-03 轮级 token 的数据装配层
 * （task-11 AgentReplayBody 直接消费）。
 *
 * 纯函数约定：零 React / 渲染层运行时依赖（turn-timeline 仅 type-only import，
 * 编译期擦除）、不改入参（只读遍历，配对回填只发生在本函数自建对象上）。
 *
 * 切轮规则（D-005）：
 *   - sender='human'（或缺省——缺省视为 human）的 user_input 开新轮，轮起点
 *     真人文本作 prompt；非真人起点的轮 prompt 留空串（日志有轮边界无命令
 *     文本，不伪造 CLI 命令原文）；
 *   - turn_id 变化（两非空值不同）独立切轮；turn_id 缺省/空 = 无信息不触发
 *     切轮（老数据 / 老窗口页不误切）；
 *   - sender=system_event 的 user_input 不切轮、不进 prompt，追加 processItems
 *     的 system_event 项（task-10 渲染为居中虚线中性行，本模块只产数据）。
 *
 * 段映射：
 *   - thinking → processItems thinking 项；
 *   - reply → 按序直接拼接 output（segmentsToLegacy 「output += 文本段」同款
 *     语义，无分隔符）；
 *   - tool_use 按 tool_use_id 显式 Map 配对 tool_result（Map 跨轮登记：结果
 *     回填到其调用所在轮的过程项，轮边界插在中间也不丢配对）→ tool 项
 *     （raw=tool_input、result=tool_result、is_error → ok/deny）；
 *   - 孤儿 tool_result（窗口内未见配对 tool_use，含更早页未加载）→ raw 空串
 *     tool 项（SessionToolEvent 语义）；
 *   - 未配对 tool_use → result 显式文本「结果未记录（更早窗口外或中断）」——
 *     对齐 R-03 红线（agent-log-card 2026-08-23：已结束会话不得假运行），不用
 *     status='running' 编码（渲染层与实时路径共用，视觉即执行中转圈=假运行）。
 *
 * token 轮级聚合（D-004 / FR-03）：轮内各段 usage 先按调用去重（同一次调用
 * 产出的多段共享同一 usage——JSON 反序列化后引用不同但五项同值，按值签名去重）
 * 再求和 inputTokens/outputTokens；ctxTokens = 该轮末次（去重序列末位）调用
 * 的 inputTokens（zcode inputTokens 已含 cacheRead，与平台 input+cache_read
 * 口径一致）；轮内无 usage → 三值 null（未知不显 0 不伪造）。全会话累计
 * total_usage 由 daemon 返回、task-11 展示，本模块不做全局求和（窗口化下
 * 前端求和必算少）。
 *
 * turn_id / model / duration_ms 不进 SessionTurnView（时间 / 模型展示归
 * task-11 组件层直读消息数据）。
 */

import type { SessionProcessItem, SessionTurnView } from "@/components/daemon/turn-timeline";
import type { AgentLogMessagesResponse } from "@/lib/agent-logs";

/**
 * 归一化消息单条——api-types 生成 schema 内层条目派生
 * （agent-log-card.tsx:120 NonNullable 派生先例，禁手写同名接口）。
 * snake_case 字段原样访问（usage 五项为 input_tokens 等 snake 键）。
 */
export type AgentLogMessageItem = NonNullable<
  AgentLogMessagesResponse["messages"]
>[number];

/** usage 五项（schema 内层派生）——轮级聚合入参形状。 */
type AgentLogMessageUsage = NonNullable<AgentLogMessageItem["usage"]>;

/** tool 过程项的可变引用（配对回填 result / status 用）。 */
type ToolProcessItem = Extract<SessionProcessItem, { kind: "tool" }>;

/** 单轮构建中间态——processItems 按序累积 + usage 按调用去重收集。 */
interface TurnDraft {
  prompt: string;
  output: string;
  processItems: SessionProcessItem[];
  /** 轮内按调用去重后的 usage 序列（首现序；末位 = 该轮末次调用）。 */
  usages: AgentLogMessageUsage[];
  /** usage 值签名去重键（同值多段只计一次）。 */
  usageKeys: Set<string>;
}

/**
 * usage 五项值签名——「同一次调用多段共享同一 usage」在 JSON 反序列化后引用
 * 不同但值全等，按值去重（null 与 0 是不同值，逐项保留区分）。
 */
function usageKeyOf(usage: AgentLogMessageUsage): string {
  return JSON.stringify([
    usage.input_tokens ?? null,
    usage.output_tokens ?? null,
    usage.total_tokens ?? null,
    usage.cache_read_tokens ?? null,
    usage.cache_write_tokens ?? null,
  ]);
}

/** 消息 turn_id 归一：非空字符串原样，其余（undefined/null/空串）视为无信息。 */
function turnIdOf(msg: AgentLogMessageItem): string | null {
  return typeof msg.turn_id === "string" && msg.turn_id !== "" ? msg.turn_id : null;
}

/**
 * messages → SessionTurnView[]（纯函数，不改入参）。
 * 空数组 → 空数组；每轮 status='completed'（历史轮先例 runtime-session-helpers
 * logsToTurns）、seenLogIds 空 Set（回放无 SSE 去重）、runId 伪 id __replay_N__
 * （__attach_history_N__ 先例）、turn 取 1 起轮序。
 */
export function buildReplayTurns(messages: AgentLogMessageItem[]): SessionTurnView[] {
  const drafts: TurnDraft[] = [];
  // tool_use_id → 已产出的 tool 过程项（跨轮登记：tool_result 按 id 回填到其
  // 调用所在轮，即使配对双方被切轮/分页拆开也能正确回填）。
  const toolItemsById = new Map<string, ToolProcessItem>();
  let current: TurnDraft | null = null;
  // 当前轮 turn_id 标记（null=尚未见到非空标记）；仅「两非空值不同」视为变化。
  let currentTurnId: string | null = null;

  const openTurn = (turnId: string | null): TurnDraft => {
    current = { prompt: "", output: "", processItems: [], usages: [], usageKeys: new Set() };
    drafts.push(current);
    // 新轮标记重置为轮起点消息的 turn_id（null 时由轮内首个非空值补登记）。
    currentTurnId = turnId;
    return current;
  };

  for (const msg of messages) {
    const turnId = turnIdOf(msg);
    // 切轮判定（任一命中开新轮）：真人 user_input（sender 缺省视为 human）；
    // turn_id 两非空值不同。
    const isHumanInput = msg.kind === "user_input" && msg.sender !== "system_event";
    const turnIdChanged =
      turnId !== null && currentTurnId !== null && turnId !== currentTurnId;
    let turn: TurnDraft;
    if (current === null || isHumanInput || turnIdChanged) {
      turn = openTurn(turnId);
    } else {
      turn = current;
      // 轮内首个非空 turn_id 迟到登记（不切轮——缺省→有值是信息补全不是边界）。
      if (turnId !== null && currentTurnId === null) currentTurnId = turnId;
    }

    // usage 收集（切轮后归新轮）：值签名去重，首现序保留。
    if (msg.usage != null) {
      const key = usageKeyOf(msg.usage);
      if (!turn.usageKeys.has(key)) {
        turn.usageKeys.add(key);
        turn.usages.push(msg.usage);
      }
    }

    switch (msg.kind) {
      case "user_input":
        if (msg.sender === "system_event") {
          // 系统注入伪用户消息 → 中性系统事件行（不切轮、不进 prompt）。
          turn.processItems.push({ kind: "system_event", text: msg.text ?? "" });
        } else {
          // 真人轮起点：prompt 取原文（切轮逻辑已保证开新轮，无覆盖风险）。
          turn.prompt = msg.text ?? "";
        }
        break;
      case "reply":
        // 按序直接拼接（segmentsToLegacy output += 同款，无分隔符）。
        turn.output += msg.text ?? "";
        break;
      case "thinking":
        turn.processItems.push({ kind: "thinking", text: msg.text ?? "" });
        break;
      case "tool_use": {
        // result 暂缺省（配对成功由 tool_result 回填）；轮定稿时未配对项统一
        // 填「结果未记录」显式文本（R-03：不伪造运行中）。
        const item: ToolProcessItem = {
          kind: "tool",
          raw: msg.tool_input ?? "",
          status: "ok",
        };
        turn.processItems.push(item);
        const id = msg.tool_use_id ?? null;
        if (id !== null && !toolItemsById.has(id)) toolItemsById.set(id, item);
        break;
      }
      case "tool_result": {
        const status: ToolProcessItem["status"] = msg.is_error ? "deny" : "ok";
        const id = msg.tool_use_id ?? null;
        const paired = id !== null ? toolItemsById.get(id) : undefined;
        if (paired !== undefined) {
          paired.result = msg.tool_result ?? "";
          paired.status = status;
        } else {
          // 孤儿结果（更早页未加载 / 失配）→ raw 空串 tool 项。
          turn.processItems.push({
            kind: "tool",
            raw: "",
            result: msg.tool_result ?? "",
            status,
          });
        }
        break;
      }
    }
  }

  // 轮级定稿：未配对 tool_use 统一填「结果未记录」（显式诚实文本，R-03——
  // 此刻全部消息已处理完，仍无 result 的 tool 项即真孤儿：结果在更早窗口外或
  // 日志中断）；usage 去重序列求和 + 末次口径 ctxTokens；无 usage 三值 null。
  return drafts.map((draft, index) => {
    for (const item of draft.processItems) {
      if (item.kind === "tool" && item.result === undefined) {
        item.result = "结果未记录（更早窗口外或中断）";
      }
    }
    const turnNo = index + 1;
    const lastUsage = draft.usages[draft.usages.length - 1] ?? null;
    return {
      runId: `__replay_${turnNo}__`,
      turn: turnNo,
      prompt: draft.prompt,
      output: draft.output,
      status: "completed",
      seenLogIds: new Set<string>(),
      processItems: draft.processItems,
      inputTokens:
        draft.usages.length > 0
          ? draft.usages.reduce((sum, u) => sum + (u.input_tokens ?? 0), 0)
          : null,
      outputTokens:
        draft.usages.length > 0
          ? draft.usages.reduce((sum, u) => sum + (u.output_tokens ?? 0), 0)
          : null,
      ctxTokens: lastUsage !== null ? (lastUsage.input_tokens ?? null) : null,
    } satisfies SessionTurnView;
  });
}
