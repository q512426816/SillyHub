/**
 * 会话输入联想触发检测与选中回填纯函数。
 *
 * 变更 2026-08-26-session-input-mention task-01（FR-01/FR-04，D-002）。
 * 变更 2026-08-28-session-ppm-task-binding task-06（FR-02/FR-05，D-001@v1）：
 *   条目类型扩展 ppmItem（PPM 任务/问题归一形态）+ 回填键清洗纯函数。
 *
 * 只做纯计算，零副作用、不依赖 React 与 DOM API——浮层归 task-02
 * （session-mention-popover.tsx），输入框接入与 IME 保护归 task-03
 * （session-input-bar.tsx）。
 *
 * 契约（task-02/task-03 按此消费，字段名不可改）：
 *   - detectMention 返回字段名用 **start**（非 startIndex）。
 *   - applyMentionPick(value, mention, insertKey) 返回 { value, caret }，
 *     回填段后随一个尾随空格（浮层检测归零自动关闭）。
 */
import type { PpmItemKind } from "@/lib/daemon";

/** 触发字符：/ = 技能指令联想，@ = 变更/快速修复/PPM 条目关联联想。 */
export type MentionTrigger = "/" | "@";

/** detectMention 命中结果。start = 触发字符在原文本中的下标。 */
export interface MentionDetection {
  trigger: MentionTrigger;
  /** 触发字符到光标之间的查询串（不含触发字符本身，可为空串）。 */
  query: string;
  /** 触发字符下标（重命名需同步 task-02/task-03 消费方，勿用 startIndex）。 */
  start: number;
}

/** applyMentionPick 结果：回填后的完整文本与新光标位置。 */
export interface MentionPickResult {
  value: string;
  /** 光标位于插入片段（含尾随空格）之后。 */
  caret: number;
}

/**
 * 从光标向左回看检测联想触发（design §3.1）。
 *
 * 规则：
 *   - 触发字符（/ 或 @）仅行首或空白字符之后命中（词首）；
 *   - 从触发字符到光标的查询串不含任何空白——回看途中遇空白即返回 null
 *     （空白中断关浮层）；查询串可空（刚输入触发字符）；
 *   - 取离光标最近的触发字符；若它非词首（如 foo/bar 的 /），不回退到更左
 *     的触发字符，直接返回 null（对齐主流编辑器最近优先语义）；
 *   - caretIndex 越界时按 value.length 收敛（防御 selectionStart 异常值）。
 *
 * @returns 命中返回 { trigger, query, start }；未命中返回 null。
 */
export function detectMention(
  value: string,
  caretIndex: number,
): MentionDetection | null {
  const caret = Math.max(0, Math.min(caretIndex, value.length));
  for (let i = caret - 1; i >= 0; i--) {
    // charAt 越界返回 ""（noUncheckedIndexedAccess 下索引访问为 string|undefined）。
    const ch = value.charAt(i);
    if (/\s/.test(ch)) {
      // 空白中断：查询串含空白视为普通文本，浮层关闭。
      return null;
    }
    if (ch === "/" || ch === "@") {
      const atWordStart = i === 0 || /\s/.test(value.charAt(i - 1));
      if (!atWordStart) return null; // 非词首的触发字符不触发
      return { trigger: ch, query: value.slice(i + 1, caret), start: i };
    }
  }
  return null;
}

/**
 * 选中联想项后回填文本（design §3.3）。
 *
 * 把「触发字符 + 查询串」片段（start 到 start + 1 + query.length，即检测时
 * 光标覆盖的片段）替换为「触发字符 + insertKey + 尾随空格」，片段之后的
 * 原文保留拼接。尾随空格使下一次 detectMention 因查询串含空白而归 null，
 * 浮层自动关闭；/team 回填后整条前缀仍命中既有 parseTeamCommand 拦截。
 *
 * @param mention 检测时点（调用方传入刚检测到的对象）的命中结果
 * @param insertKey 插入键：/ 用技能名（task-08 前为 name），@ 用无空格自然键
 *   （change_key / ql_id）
 * @returns 新文本与新光标位置（插入片段之后，含尾随空格）
 */
export function applyMentionPick(
  value: string,
  mention: MentionDetection,
  insertKey: string,
): MentionPickResult {
  const segmentEnd = mention.start + mention.trigger.length + mention.query.length;
  const inserted = `${mention.trigger}${insertKey} `;
  return {
    value:
      value.slice(0, mention.start) + inserted + value.slice(segmentEnd),
    caret: mention.start + inserted.length,
  };
}

/* ───────── PPM 条目（2026-08-28-session-ppm-task-binding task-06 / FR-02） ───────── */

/**
 * @ 联想 PPM 条目归一形态（PPM 任务/问题两类共用；task-04 useMentionSources
 * 从 PlanTask/ProblemList 响应映射，绑定走结构化槽位不依赖回填文本）。
 */
export interface MentionPpmItem {
  /** 绑定类别：plan_task=PPM 任务 / problem=PPM 问题（对齐 daemon.ts PpmItemKind）。 */
  kind: PpmItemKind;
  /** 条目 id（uuid，随 createSession/injectSession 成对上送）。 */
  id: string;
  /** 条目标题（任务 content / 问题 pro_desc；空由数据源兜底短码）。 */
  title: string;
  /** 项目名标注（响应自带 project_name，零额外请求；空 = 不标注）。 */
  projectName: string | null;
  /** 次行说明（任务 task_description / 问题功能名·类型，仅展示与次级过滤）。 */
  subtitle: string | null;
}

/** PPM 条目回填键上限：标题过长截断（回填文本是展示性残留，绑定走结构化槽位）。 */
const PPM_INSERT_KEY_MAX = 40;

/**
 * PPM 条目回填键清洗（task-06）：标题压连续空白为单空格 + 截断 40 字符。
 * change_key/ql_id 是无空格自然键，PPM 标题是自由文本——换行会拆行、连续
 * 空格是噪音；压成单空格后经 applyMentionPick 回填，尾随空格的关层语义
 * （下一次检测因查询串含空白归 null）不受影响。空标题返回空串（回填仅剩
 * 触发字符 + 尾随空格，绑定仍由 mentions 槽位承载）。
 */
export function sanitizePpmInsertKey(
  title: string | null | undefined,
): string {
  const collapsed = (title ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed.length > PPM_INSERT_KEY_MAX
    ? `${collapsed.slice(0, PPM_INSERT_KEY_MAX)}…`
    : collapsed;
}
