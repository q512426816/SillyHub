"use client";

/**
 * AskUserDialogCard：结构化问答对话卡片（provider 无关）。
 *
 * 当 permission_request 携带 dialog_kind 时，本组件替代 PermissionApprovalCard
 * 渲染结构化问答（问题文本 + 选项列表 + 可选自定义文本输入）。提交后调
 * respondSessionPermission(sessionId, requestId, 'allow', undefined, {answers})。
 *
 * 与 PermissionApprovalCard 的差异：
 *   - 无 5min 倒计时（对话可长期等待用户回答，backend 不超时）；
 *   - 无 allow/deny 二选一，只有"提交回答"（语义上即 allow + dialog_result.answers）；
 *   - 提交后进入 disabled 状态，等待 permission_resolved SSE 由父组件移除本卡。
 *
 * 父组件（session-panel，dialog/page 两模式同款分流）按 req.dialog_kind 是否存在
 * 决定渲染本卡还是普通审批卡。
 *
 * task-09（FR-09 / D-010@v1）：本组件 provider 无关，零分支复用。
 *   - Claude Code canUseTool AskUserQuestion → dialog_kind="ask_user"
 *   - Codex app-server item/tool/requestUserInput → dialog_kind="codex_request_user_input"
 *   - Codex app-server mcpServer/elicitation/request（可归一化） → dialog_kind="mcp_elicitation"
 * daemon（task-05）负责把 Codex 原生 payload 归一化成下方 DialogPayload 结构；
 * parseQuestions 只依赖通用 questions/options 字段，不识别 provider 原生 schema。
 * badge 直接显示后端传入的 kind 字符串（专业标识，不翻译）。复杂 MCP elicitation
 * 由 daemon fail-closed，前端不会收到不可渲染的卡片；若收到缺字段 payload，走兜底分支。
 *
 * task-10（FR-05 / D-004@v2，群聊增强——仅展示层，提交协议零变化）：
 *   - dialog_payload.recommendResponders（string[]，daemon 端头平铺透传、
 *     dialog_payload 自由 JSON 无 schema 变更）非空时，问题区上方渲染
 *     「💡 推荐 @xx 回答」软提示条（原型场景二 .ask-recommend 浅青虚线形态），
 *     仅提示不门控；单聊无该字段时渲染零变化。
 *   - answered prop → 已答关闭态（群聊先到先得，后答者可见已被谁回答）：
 *     只读问题文本 + 「✓ ×× 已回答，本题已关闭」条（原型 .answered-strip /
 *     .takenover-strip）。人名数据源为 SSE permission_resolved 的
 *     answered_by_actual_user（task-09 契约，user_id）/ dialogs_history 恢复数据，
 *     卡片上下文无用户名映射，由父组件解析 user_id → 人名后传入；缺失降级为
 *     「已回答」不带名，不崩。群聊聚合挂载归 task-11。
 */

import { useMemo, useState } from "react";
import { Check, HelpCircle, Minimize2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  respondSessionPermission,
  type SessionPermissionRequest,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/* ---------- dialog payload 类型（对齐 Claude Code AskUserQuestion） ---------- */

export interface DialogOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface DialogQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: DialogOption[];
}

export interface DialogPayload {
  questions: DialogQuestion[];
}

/** 提交给 backend 的单条答案。answer 为 string（单选）或 string[]（多选）。 */
export interface DialogAnswer {
  question: string;
  header?: string;
  answer: string | string[];
}

/* ---------- helpers ---------- */

// 手动输入由每个问题下方的常驻输入框承载（ql-013），不再需要识别 custom 选项。

/**
 * 从 dialog_payload 防御性解析 questions 数组。
 * 缺字段 / 非数组 / 空选项的条目被跳过，避免后端格式偏差导致整卡崩溃。
 */
function parseQuestions(
  payload: Record<string, unknown> | undefined,
): DialogQuestion[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): DialogQuestion | null => {
      if (!item || typeof item !== "object") return null;
      const q = item as Record<string, unknown>;
      const question = typeof q.question === "string" ? q.question : "";
      const optionsRaw = Array.isArray(q.options) ? q.options : [];
      const options = optionsRaw
        .map((o): DialogOption | null => {
          if (!o || typeof o !== "object") return null;
          const oo = o as Record<string, unknown>;
          const label = typeof oo.label === "string" ? oo.label : "";
          if (!label) return null;
          return {
            label,
            ...(typeof oo.description === "string"
              ? { description: oo.description }
              : {}),
            ...(typeof oo.preview === "string"
              ? { preview: oo.preview }
              : {}),
          };
        })
        .filter((o): o is DialogOption => o !== null);
      if (!question || options.length === 0) return null;
      return {
        question,
        ...(typeof q.header === "string" ? { header: q.header } : {}),
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
        options,
      };
    })
    .filter((q): q is DialogQuestion => q !== null);
}

/**
 * task-10（FR-05 / D-004@v2）：从 dialog_payload 防御解析推荐回答人列表。
 * string[] 平铺透传（自由 JSON，无 schema 变更）；非数组 / 非字符串 / 空白
 * 条目被过滤并去重。返回空数组时卡片渲染零变化（单聊回归无影响）。
 */
function parseRecommendResponders(
  payload: Record<string, unknown> | undefined,
): string[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { recommendResponders?: unknown })
    .recommendResponders;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw.filter(
        (v): v is string => typeof v === "string" && v.trim() !== "",
      ),
    ),
  );
}

/* ---------- 组件内状态 ---------- */

interface QuestionState {
  /** 已选中的 option label 列表；单选长度 ≤ 1，多选可为任意长度。 */
  selected: string[];
  /** 自定义选项选中文本输入框的值。 */
  customText: string;
}

function emptyState(): QuestionState {
  return { selected: [], customText: "" };
}

/* ---------- 组件 ---------- */

/**
 * task-10（FR-05 / D-004@v2）：已答关闭态载荷（群聊先到先得——后答者可见
 * 本题已被谁回答）。父组件（task-11 群聊聚合）在收到 permission_resolved SSE
 * / 重拉见 409 已答 / dialogs_history 恢复时置入本态。
 */
export interface AskUserDialogAnswered {
  /**
   * 实际答题人展示名（人名，非 user_id）。数据源：SSE permission_resolved 的
   * answered_by_actual_user（task-09 契约，user_id 字符串）或 dialogs_history
   * 恢复数据——卡片上下文无用户名映射，由父组件解析 user_id → 人名后传入。
   * null / 缺失 / 空白串 → 降级显示「已回答」不带人名（数据缺失不崩）。
   */
  answeredByName?: string | null;
}

export interface AskUserDialogCardProps {
  request: SessionPermissionRequest;
  /** 卡片被移除时回调（permission_resolved SSE / 父组件清空时触发）。 */
  onResolved?: (requestId: string, decision: "allow" | "deny") => void;
  /**
   * task-08（FR-04 / D-003@v1）：最小化受控态。true 时本组件渲染 null，但
   * 保持挂载（父组件不卸载子树），已填的选项 / 手动输入 state 全部保留，
   * 还原（切回 false）后继续作答。undefined = 现状零变化（默认展开）。
   */
  minimized?: boolean;
  /** 点击卡头最小化按钮时回调（缺省不渲染按钮，向后兼容旧用法）。 */
  onMinimize?: (requestId: string) => void;
  /**
   * task-10（FR-05 / D-004@v2）：已答关闭态。传入（非 undefined）时本卡渲染
   * 关闭态：只读问题文本 + 「✓ ×× 已回答，本题已关闭」条，无作答交互；
   * undefined = 现状开放态，渲染零变化（单聊回归无影响）。
   */
  answered?: AskUserDialogAnswered;
  /**
   * ql-20260910-004：提交撞「已被他人回答」409 的回调（先到先得第二答题端）。
   * answeredByUserId=后端 details.answered_by（user_id 字符串，可能 null）——
   * 人名解析归父组件（群成员映射）；卡片同时本地翻已答关闭态（降级不带名）。
   */
  onAlreadyResolved?: (requestId: string, answeredByUserId: string | null) => void;
}

export function AskUserDialogCard({
  request,
  onResolved,
  minimized,
  onMinimize,
  answered,
  onAlreadyResolved,
}: AskUserDialogCardProps) {
  const questions = useMemo(
    () => parseQuestions(request.dialog_payload),
    [request.dialog_payload],
  );
  const recommendResponders = useMemo(
    () => parseRecommendResponders(request.dialog_payload),
    [request.dialog_payload],
  );

  // 每个问题一个独立选择态，key 为问题在数组中的下标（稳定）。
  const [states, setStates] = useState<Record<number, QuestionState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ql-20260910-004：409 已被他人回答时的本地关闭态（父组件 answered prop 带
  // 人名重渲染后优先生效——answerInfo 合并取 prop 优先）。
  const [alreadyAnswered, setAlreadyAnswered] = useState<AskUserDialogAnswered | null>(null);

  const getQState = (idx: number): QuestionState => states[idx] ?? emptyState();

  const selectOption = (idx: number, q: DialogQuestion, label: string) => {
    if (submitting) return;
    setStates((prev) => {
      const cur = prev[idx] ?? emptyState();
      if (q.multiSelect) {
        const set = new Set(cur.selected);
        if (set.has(label)) set.delete(label);
        else set.add(label);
        return { ...prev, [idx]: { ...cur, selected: Array.from(set) } };
      }
      // 单选：替换当前选中（取消同项再点则取消选择）
      const nextSelected = cur.selected[0] === label ? [] : [label];
      return { ...prev, [idx]: { ...cur, selected: nextSelected } };
    });
  };

  const setCustomText = (idx: number, text: string) => {
    if (submitting) return;
    setStates((prev) => {
      const cur = prev[idx] ?? emptyState();
      return { ...prev, [idx]: { ...cur, customText: text } };
    });
  };

  /**
   * 计算单个问题的具体答案列表：
   *   - 非自定义 label 直接作为答案；
   *   - 自定义 label 用 customText（trim 后非空才计入）作为答案。
   * 返回 null 表示该问题尚未有效作答。
   */
  function computeAnswer(
    q: DialogQuestion,
    st: QuestionState,
  ): string[] | null {
    // 手动输入优先：填了输入框就以输入内容作答（覆盖选项选择）。
    const custom = st.customText.trim();
    if (custom) {
      return q.multiSelect
        ? Array.from(new Set([...st.selected, custom]))
        : [custom];
    }
    // 无手动输入：用选中的预设选项。
    if (st.selected.length === 0) return null;
    return q.multiSelect ? st.selected : st.selected.slice(0, 1);
  }

  const canSubmit =
    !submitting &&
    questions.every((q, idx) => {
      const ans = computeAnswer(q, getQState(idx));
      return ans !== null && ans.length > 0;
    });

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const dialogResult = {
      answers: questions.map((q, idx): DialogAnswer => {
        const ans = computeAnswer(q, getQState(idx)) ?? [];
        return {
          question: q.question,
          ...(q.header ? { header: q.header } : {}),
          answer: q.multiSelect ? ans : (ans[0] ?? ""),
        };
      }),
    };

    try {
      await respondSessionPermission(
        request.session_id,
        request.request_id,
        "allow",
        undefined,
        dialogResult,
      );
      // 成功送达 backend；permission_resolved SSE 到达后父组件移除本卡。
      onResolved?.(request.request_id, "allow");
    } catch (err) {
      // ql-20260910-004：409 已被他人回答（先到先得第二答题端）——不是错误：
      // 本地翻已答关闭态 + 回调父组件解析人名（details.answered_by），不再
      // 直出后端英文报错文案。
      if (
        err instanceof ApiError &&
        err.code === "HTTP_409_DAEMON_DIALOG_ALREADY_RESOLVED"
      ) {
        const details = (err.details ?? {}) as { answered_by?: unknown };
        const answeredBy =
          typeof details.answered_by === "string" ? details.answered_by : null;
        setAlreadyAnswered({ answeredByName: null });
        onAlreadyResolved?.(request.request_id, answeredBy);
        setSubmitting(false);
        return;
      }
      const msg =
        err instanceof ApiError ? err.message : "提交失败，请重试";
      setError(msg);
      setSubmitting(false);
    }
  };

  // task-08（FR-04）：最小化时渲染 null 但**不卸载组件**——上方 hooks（已选项 /
  // 手动输入 state）随挂载保留，父组件把本卡收缩为右下角浮动胶囊，还原后已填
  // 内容原样恢复。须放在全部 hooks 之后（hooks 调用不能条件化）。
  if (minimized) return null;

  // dialog_payload 解析失败兜底：展示提示但不再崩溃（仍可被父组件通过 SSE 移除）。
  if (questions.length === 0) {
    return (
      <article
        className="overflow-hidden rounded-md border bg-card shadow-sm"
        data-request-id={request.request_id}
      >
        <header className="flex items-center gap-2 border-b bg-indigo-50/60 px-3 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-indigo-100 text-indigo-700">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-semibold text-foreground">
            智能体提问
          </span>
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            {request.dialog_kind ?? "ask_user"}
          </Badge>
          {onMinimize && (
            <button
              type="button"
              onClick={() => onMinimize(request.request_id)}
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="最小化为右下角浮动胶囊"
              aria-label="最小化提问卡片"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </header>
        <div className="px-3 py-2 text-[11px] text-muted-foreground">
          无法解析提问内容（dialog_payload 缺失或格式不符），请刷新页面重试。
        </div>
      </article>
    );
  }

  // task-10（FR-05 / D-004@v2）：已答关闭态（原型场景二关闭卡：问题只读 +
  // 已答条，无选项 / 输入 / 提交交互；答题人名缺失时降级不带名）。
  // 置入时机（父组件，task-11）：permission_resolved SSE（answered_by_actual_user）
  // / 重拉见 409 已答 / dialogs_history 恢复。提交协议零变化（本分支无交互入口）。
  const answerInfo = answered ?? alreadyAnswered;
  if (answerInfo) {
    const answeredName =
      typeof answerInfo.answeredByName === "string"
        ? answerInfo.answeredByName.trim()
        : "";
    return (
      <article
        className="overflow-hidden rounded-md border bg-card opacity-80 shadow-sm"
        data-request-id={request.request_id}
        data-dialog-kind={request.dialog_kind ?? "ask_user"}
        data-answered="true"
      >
        <header className="flex items-center gap-2 border-b bg-indigo-50/60 px-3 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-indigo-100 text-indigo-700">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                智能体提问 · 已回答
              </span>
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {request.dialog_kind ?? "ask_user"}
              </Badge>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {request.request_id.slice(0, 12)}…
            </p>
          </div>
          {onMinimize && (
            <button
              type="button"
              onClick={() => onMinimize(request.request_id)}
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="最小化为右下角浮动胶囊"
              aria-label="最小化提问卡片"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </header>
        <div className="space-y-2 px-3 py-3">
          {questions.map((q, idx) => (
            <div
              key={`${idx}-${q.question.slice(0, 16)}`}
              className="flex flex-wrap items-baseline gap-1.5"
            >
              {q.header && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                  {q.header}
                </span>
              )}
              <p className="text-xs font-medium text-foreground">{q.question}</p>
            </div>
          ))}
          {/* 已答条（原型 .answered-strip / .takenover-strip 绿色关闭态） */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            <span aria-hidden>✓</span>
            {answeredName ? (
              <>
                <span className="font-bold">{answeredName}</span>
                <span>已回答，本题已关闭</span>
              </>
            ) : (
              // 答题人数据缺失降级：显示「已回答」不带名，不崩。
              <span>已回答，本题已关闭</span>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="overflow-hidden rounded-md border bg-card shadow-sm"
      data-request-id={request.request_id}
      data-dialog-kind={request.dialog_kind ?? "ask_user"}
    >
      <header className="flex items-center gap-2 border-b bg-indigo-50/60 px-3 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-indigo-100 text-indigo-700">
          <HelpCircle className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">
              智能体提问
            </span>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {request.dialog_kind ?? "ask_user"}
            </Badge>
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {request.request_id.slice(0, 12)}…
          </p>
        </div>
        {onMinimize && (
          <button
            type="button"
            onClick={() => onMinimize(request.request_id)}
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="最小化为右下角浮动胶囊"
            aria-label="最小化提问卡片"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      <div className="space-y-3 px-3 py-3">
        {/* task-10（FR-05 / D-004@v2）：群聊推荐回答人软提示条（原型场景二
            .ask-recommend 浅青虚线形态）。仅提示不门控——任何成员仍可作答；
            无 recommendResponders 时不渲染（单聊渲染零变化）。 */}
        {recommendResponders.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-dashed border-cyan-600/50 bg-cyan-50 px-2.5 py-1.5 text-xs text-cyan-800">
            <span aria-hidden>💡</span>
            <span>推荐</span>
            {recommendResponders.map((name) => (
              <span key={name} className="font-bold">
                @{name}
              </span>
            ))}
            <span>回答</span>
          </div>
        )}
        {questions.map((q, idx) => {
          const st = getQState(idx);
          return (
            <div
              key={`${idx}-${q.question.slice(0, 16)}`}
              className="space-y-1.5"
            >
              <div className="flex flex-wrap items-baseline gap-1.5">
                {q.header && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                    {q.header}
                  </span>
                )}
                <p className="text-xs font-medium text-foreground">
                  {q.question}
                </p>
                {q.multiSelect && (
                  <span className="text-[10px] text-muted-foreground">
                    （可多选）
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {q.options.map((opt) => {
                  const selected = st.selected.includes(opt.label);
                  return (
                    <div key={opt.label}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => selectOption(idx, q, opt.label)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          selected
                            ? "border-indigo-400 bg-indigo-50"
                            : "border-zinc-200 bg-card hover:border-indigo-300 hover:bg-indigo-50/40",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border",
                            q.multiSelect ? "rounded-sm" : "rounded-full",
                            selected
                              ? "border-indigo-500 bg-indigo-500 text-white"
                              : "border-zinc-300 bg-card",
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium text-foreground">
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {opt.description}
                            </div>
                          )}
                          {opt.preview && (
                            <div className="mt-0.5 font-mono text-[10px] text-zinc-500">
                              {opt.preview}
                            </div>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
                {/* ql-013：常驻手动输入框——填写后以此内容作答（覆盖选项）。 */}
                <Input
                  placeholder="或手动输入（填写后以此内容作答）"
                  value={st.customText}
                  onChange={(e) => setCustomText(idx, e.target.value)}
                  disabled={submitting}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          );
        })}

        {error && (
          <p className="text-[11px] text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t bg-muted/20 px-3 py-2">
        <span className="text-[10px] text-muted-foreground">
          {submitting ? "已提交，等待智能体确认..." : "智能体正在等待你的回答"}
        </span>
        <Button
          size="sm"
          className="h-7 gap-1 px-2.5 text-[11px]"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          title="提交回答"
        >
          <Check className="h-3.5 w-3.5" />
          {submitting ? "提交中" : "提交回答"}
        </Button>
      </footer>
    </article>
  );
}
