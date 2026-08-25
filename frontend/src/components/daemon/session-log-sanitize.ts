/**
 * 2026-07-11-unify-runtime-session-dialog / FR-04 / D-004: 共享日志内容过滤纯函数。
 *
 * 独立模块的由来（史）：当时 runtime-session-helpers 已 import panel 的
 * InteractiveSessionPanel，若 panel（interactive-session-panel，现已删除）反向
 * import helpers 会成环，故共享纯函数下沉到此独立文件。
 *
 * attach 历史预填（logsToTurns）与实时 SSE（onLog）共用同一过滤，
 * 避免 thinking/SYSTEM/AskUserQuestion 等原始标记泄漏到正文（修复 attach 历史
 * 消息渲染 BUG：[SYSTEM:thinking_tokens]/[THINKING] 不再显示）。
 *
 * 过滤规则（史：源自原 interactive-session-panel 内 renderLogContent，语义
 * 完全一致）：
 *   - 含 AskUserQuestion / [TOOL_RESULT] User answered / [SYSTEM…]/[RESULT…] → 丢弃
 *   - channel=stderr → 加 ⚠️ 前缀
 *   - channel=tool_call → 不加 🔧 前缀（ql-20260730-001：tool 内容走 classifySessionLog
 *     分流到工具卡片，卡片自带图标；保留正文不再加 emoji 前缀）
 *   - 剥 [ASSISTANT|THINKING|LOG:\w+|TOOL_USE|TOOL_RESULT] 前缀
 *
 * 2026-08-19-session-stream-ux / task-01：classifySessionLog / isToolResultDenied /
 * statusFromToolUseRaw / OVERRIDE_RE / SessionLogSegment(Kind) 已迁入共享装配器
 * session-log-assembler.ts（design §6：分类函数迁为装配器内部依赖，语义零改动）。
 * 本文件保留同名导出垫片（下方 re-export）——史：当时的 interactive-session-panel
 * （现已删除）/ runtime-session-helpers / sessions page 与既有单测等引用零改动；
 * 现消费方为 runtime-session-helpers / turn-timeline / session-log-assembler 与单测；
 * 本文件其余 sanitize 函数（sanitizeSessionLogContent / extractDialogQA）不动。
 */
import { OVERRIDE_RE } from "./session-log-assembler";

// 垫片：分类实现已迁 session-log-assembler.ts，此处仅转出口（对外导出签名零变化）。
export {
  classifySessionLog,
  isToolResultDenied,
  statusFromToolUseRaw,
} from "./session-log-assembler";
export type {
  SessionLogSegment,
  SessionLogSegmentKind,
} from "./session-log-assembler";

export function sanitizeSessionLogContent(content: string, channel?: string | null): string {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("AskUserQuestion")) return "";
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return "";
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return "";
  // 2026-08-03-session-stream-partial-revoke / FR-04 / R-04：override 撤回令箭前缀不
  // 泄漏到正文（防御性：attach 历史路径万一收到 override 文本，sanitize 兜底丢弃）。
  // 与 classifySessionLog 同源 OVERRIDE_RE（现于 session-log-assembler.ts），仅判命中
  // 不取捕获组。
  if (OVERRIDE_RE.test(trimmed)) return "";
  if (channel === "stderr") return `⚠️ ${trimmed}`;
  return trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+|TOOL_USE|TOOL_RESULT)\]\s?/, "");
}

/**
 * ql-20260801-003 / ql-20260802-003：从 SessionDialogRead 解析「问题→可选项→选中」，
 * 供交互式会话面板渲染 AskUserQuestion 历史记录。
 *
 * 实时 AskUserDialogCard 回答后即移除、failed/ended 会话不渲染卡片，已答/历史
 * 问答只能靠 GET /dialogs/history 恢复展示；本函数把持久化的 payload/answer
 * 归一成 {question, options[], answerText} 供只读历史区块渲染。
 *
 *   - dialog_payload（AskUserQuestion 同构）：{questions:[{question, options:[{label,description}], ...}]}
 *   - answer：{answers:[{answer}]}（按顺序与 questions 对应，answer = 用户选中的 option.label）
 * 缺失/结构异常 → 问题兜底「(无问题文本)」；选中判定 = answer.trim() === option.label.trim()。
 * ql-20260802-003 修复：旧版只取 question+answer 丢了 options，导致卡片只显示用户选中的
 * 那一项、看不到其余备选；现提取全部 options 并标记 selected。
 */
export interface DialogOption {
  label: string;
  description?: string;
  /** 是否为用户最终选中项（answer.answer 与 option.label 匹配）。 */
  selected: boolean;
}

export interface DialogQA {
  question: string;
  options: DialogOption[];
  /** 用户作答文本（无 options 的自由作答场景兜底，或选中项 label）。null=未答。 */
  answerText: string | null;
}

export function extractDialogQA(dialog: {
  dialog_payload?: unknown;
  answer?: unknown;
}): DialogQA[] {
  // dialog_payload/answer 在 api-types 里是 {[key:string]:unknown}|null，此处内部断言。
  const payload = (dialog?.dialog_payload ?? null) as {
    questions?: {
      question?: string;
      options?: { label?: string; description?: string }[];
    }[];
  } | null;
  // ql-20260825-003：answer.answer 真实形态是 string（单选）或 string[]（multiSelect）——
  // 旧代码只按 string 处理，multiSelect 会话历史回看时 [数组].trim() 直接崩页面
  // （「(intermediate value)….trim is not a function」）。归一为 label 列表。
  const answer = (dialog?.answer ?? null) as {
    answers?: { answer?: string | string[] }[];
  } | null;
  const questions = payload?.questions ?? [];
  const answers = answer?.answers ?? [];
  if (questions.length === 0) return [];
  return questions.map((q, i) => {
    const raw = answers[i]?.answer;
    const chosenList = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string")
      : typeof raw === "string"
        ? [raw]
        : [];
    const chosen = chosenList.map((s) => s.trim()).filter(Boolean).join("、");
    const options: DialogOption[] = (q.options ?? []).map((o) => ({
      label: o.label ?? "(无标签)",
      description: o.description,
      // AskUserQuestion 推荐项 label 常带 "(Recommended)" 后缀，answer 存的是完整 label，
      // 原样比较即可；trim 仅容忍两端空白。multiSelect 按 label ∈ 选中列表判定。
      selected: chosenList.length > 0 && chosenList.includes((o.label ?? "").trim()),
    }));
    return {
      question: q.question ?? "(无问题文本)",
      options,
      answerText: chosen.length > 0 ? chosen : null,
    };
  });
}
