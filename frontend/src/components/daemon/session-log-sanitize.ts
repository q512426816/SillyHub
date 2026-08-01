/**
 * 2026-07-11-unify-runtime-session-dialog / FR-04 / D-004: 共享日志内容过滤纯函数。
 *
 * 独立模块避免 runtime-session-helpers ↔ interactive-session-panel 循环依赖
 *（helpers 已 import panel 的 InteractiveSessionPanel；若 panel 反向 import
 * helpers 会成环，故共享纯函数下沉到此独立文件）。
 *
 * attach 历史预填（logsToTurns）与实时 SSE（onLog）共用同一过滤，
 * 避免 thinking/SYSTEM/AskUserQuestion 等原始标记泄漏到正文（修复 attach 历史
 * 消息渲染 BUG：[SYSTEM:thinking_tokens]/[THINKING] 不再显示）。
 *
 * 过滤规则（与原 interactive-session-panel.tsx:894 renderLogContent 完全一致）：
 *   - 含 AskUserQuestion / [TOOL_RESULT] User answered / [SYSTEM…]/[RESULT…] → 丢弃
 *   - channel=stderr → 加 ⚠️ 前缀
 *   - channel=tool_call → 不加 🔧 前缀（ql-20260730-001：tool 内容走 classifySessionLog
 *     分流到工具卡片，卡片自带图标；保留正文不再加 emoji 前缀）
 *   - 剥 [ASSISTANT|THINKING|LOG:\w+|TOOL_USE|TOOL_RESULT] 前缀
 */
export function sanitizeSessionLogContent(content: string, channel?: string | null): string {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("AskUserQuestion")) return "";
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return "";
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return "";
  if (channel === "stderr") return `⚠️ ${trimmed}`;
  return trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+|TOOL_USE|TOOL_RESULT)\]\s?/, "");
}

/**
 * ql-20260729-005：会话日志分类（对话 / 过程信息分流）。
 * ql-20260730-003：tool 拆回 tool_use / tool_result，恢复 use↔result 配对 + 状态徽章。
 *
 * 与 sanitizeSessionLogContent 同一套丢弃规则，但返回结构化分类而非拼接字符串，
 * 供会话面板把「答复正文（reply）」与「过程信息（thinking/tool_use/tool_result/stderr）」分流：
 * 默认对话视图只渲染 reply，过程信息经「对话/全部」切换后再展示。
 *
 * 分类规则：
 *   - 丢弃（返回 null）：AskUserQuestion 卡片协议行 / [TOOL_RESULT] User answered /
 *     [SYSTEM…] / [RESULT…] 与空内容（与原函数完全一致；丢弃优先于 channel 分流）
 *   - kind=thinking：[THINKING] 前缀行（剥前缀）
 *   - kind=tool_use：channel=tool_call（daemon 上报的工具 JSON，含 tool_use_id/success，
 *     权威源）。stdout 的 [TOOL_USE] 文本行与该 JSON 重复 → 丢弃（双发去重，否则 tool_use
 *     翻倍、result 仅够配一半，余下永显「执行中 ⏳」）
 *   - kind=tool_result：[TOOL_RESULT] 前缀的 stdout 文本行（剥前缀，供配对最近 tool_use）
 *   - kind=stderr：channel=stderr
 *   - kind=reply：其余（剥 [ASSISTANT]/[LOG:\w+] 前缀）
 */
export type SessionLogSegmentKind =
  | "reply"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "stderr";

export interface SessionLogSegment {
  kind: SessionLogSegmentKind;
  text: string;
}

export function classifySessionLog(
  content: string,
  channel?: string | null,
): SessionLogSegment | null {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("AskUserQuestion")) return null;
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return null;
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return null;
  if (channel === "stderr") return { kind: "stderr", text: trimmed };
  if (channel === "tool_call") return { kind: "tool_use", text: trimmed };
  // ql-20260730-003 修正：stdout [TOOL_USE] 文本行与 channel=tool_call JSON 是同一工具的
  // 重复记录（daemon 双发），丢弃文本行、以 tool_call JSON 为权威源——否则 tool_use 翻倍、
  // result 仅够配一半，余下永显「执行中 ⏳」（已结束会话也假运行）。
  if (/^\[TOOL_USE\]\s?/.test(trimmed)) {
    return null;
  }
  if (/^\[TOOL_RESULT\]\s?/.test(trimmed)) {
    return { kind: "tool_result", text: trimmed.replace(/^\[TOOL_RESULT\]\s?/, "") };
  }
  if (/^\[THINKING\]\s?/.test(trimmed)) {
    return { kind: "thinking", text: trimmed.replace(/^\[THINKING\]\s?/, "") };
  }
  return {
    kind: "reply",
    text: trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+)\]\s?/, ""),
  };
}

/**
 * ql-20260730-003：判断 tool_result 文本是否表示工具执行失败/被拒（→ deny 状态徽章 ✗）。
 * ql-20260801-004：收紧关键词——去掉 error/fail（成功输出正文常含这些字样会误判，如
 *   grep 命中 "fail"、测试报告 "0 errors"），改为只匹配明确拒绝/失败信号。
 *
 * 配对逻辑让 result 拒绝**覆盖** tool_use 的 success（daemon task-runner.ts:1895 把
 * tool_call JSON 的 success 硬编码为 true，语义是「已放行执行」而非「执行成功」，不可作
 * 最终结果权威；真正的 Runtime Policy 拒绝只体现在 result 文本）。故关键词必须精准，
 * 宁可漏判（success 仍兜底 ok）不可误判成功输出正文。
 *
 * 命中「拒绝|denied|失败|禁止写入|not allowed」任一（大小写不敏感）即判 deny。
 * onLog（实时）与 logsToTurns（attach 历史）共用，避免两处正则不一致。
 */
export function isToolResultDenied(text: string): boolean {
  return /拒绝|denied|失败|禁止写入|not allowed/i.test(text ?? "");
}

/**
 * ql-20260730-003 修正：从 tool_call JSON raw 解析工具执行状态（状态徽章权威源）。
 *
 * daemon 上报的 tool_call JSON 形如
 *   {"tool":"Bash","args":{...},"tool_use_id":"call_xxx","success":true}
 * 含 `success` 布尔字段——工具执行结果真值。以此定状态徽章，不再靠 [TOOL_RESULT] 文本
 * 关键词猜测（避免结果正文里出现 "error"/"fail" 字样误判 ✗）。
 *
 *   - success: true  → "ok"（✓）
 *   - success: false → "deny"（✗）
 *   - 解析失败 / 无 success 字段 → "running"（回退靠后续 result 配对兜底）
 */
export function statusFromToolUseRaw(raw: string): "ok" | "deny" | "running" {
  try {
    const obj = JSON.parse((raw ?? "").trim());
    if (obj && typeof obj.success === "boolean") {
      return obj.success ? "ok" : "deny";
    }
  } catch {
    // 非 JSON（人类可读摘要等），回退 running
  }
  return "running";
}

/**
 * ql-20260801-003：从 SessionDialogRead 解析「问题→回答」对，供交互式会话面板
 * 渲染 AskUserQuestion 历史记录（dialog_payload.questions 配 answer.answers）。
 *
 * 实时 AskUserDialogCard 回答后即移除、failed/ended 会话不渲染卡片，已答/历史
 * 问答只能靠 GET /dialogs/history 恢复展示；本函数把持久化的 payload/answer
 * 归一成 {question, answer} 供只读历史区块渲染。
 *
 *   - dialog_payload（AskUserQuestion 同构）：{questions:[{question,...}]}
 *   - answer：{answers:[{question,answer}]}（按顺序与 questions 对应）
 * 缺失/结构异常 → 问题兜底「(无问题文本)」、回答兜底 null（调用方据 status 显示「待答/未回答」）。
 */
export interface DialogQA {
  question: string;
  answer: string | null;
}

export function extractDialogQA(dialog: {
  dialog_payload?: unknown;
  answer?: unknown;
}): DialogQA[] {
  // dialog_payload/answer 在 api-types 里是 {[key:string]:unknown}|null，此处内部断言。
  const payload = (dialog?.dialog_payload ?? null) as {
    questions?: { question?: string }[];
  } | null;
  const answer = (dialog?.answer ?? null) as {
    answers?: { answer?: string }[];
  } | null;
  const questions = payload?.questions ?? [];
  const answers = answer?.answers ?? [];
  if (questions.length === 0) return [];
  return questions.map((q, i) => ({
    question: q.question ?? "(无问题文本)",
    answer: answers[i]?.answer ?? null,
  }));
}
