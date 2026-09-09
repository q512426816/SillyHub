"use client";

/**
 * task-07（2026-09-09-askuser-pi-cursor / FR-03 / D-003@v2）：cursor marker 型
 * 提问卡。消息尾部 ```askuser fenced JSON 标记（askuser-marker.ts 解析产物）在
 * turn-timeline 文本段命中处原位渲染本卡，标记原文隐藏（textBefore 由消费方
 * 作正文渲染）。
 *
 * 视觉对齐 prototype-askuser-cards.html 场景三（cursor 轮界协议）：
 *   - 头部：提问徽标 + 引擎副行「本轮结束，你的回答将作为下一条消息自动发送」
 *     （兼作 R-05 社工风险提示——明示回答会发给 AI）；
 *   - 问题行 + 选项列表（单选 radio 形态）+ 可选文本输入（allowCustom 或
 *     input/editor 形态；无选项的 select/confirm 降级为纯输入保证可答）；
 *   - recommendResponders 渲染「💡 agent 推荐 @xx 回答」条（场景二样式语义，
 *     软提示非硬门控）；
 *   - 提交按钮「提交并发送」（场景三文案）：答案组装规则（design §Wave B.4）
 *     select→所选 label（自定义时用输入文本）、confirm→是/否（无 options 时
 *     合成）、input/editor→输入文本；手动输入优先覆盖选项选择（与
 *     AskUserDialogCard 同语义）。
 *
 * 提交不经后端 dialog 管道（无 pending 行/答题端点，D-003@v2 纯前端协议）：
 * onSubmit 把组装好的答案文本交消费方经既有发送链路作为下一条用户消息发出
 * （turn-timeline 传 onResend，cursor --resume 续轮天然生效）。
 *
 * 已答态（design §Wave B.3 best-effort 启发式）：answered=true（该 marker 轮
 * 之后已存在用户消息，消费方从 displayTurns 本地判定，无后端状态；启发式不
 * 区分「回答」与「无关插话」，仅展示层语义）或本地已提交 → 关闭态展示
 * （灰化徽标 + 问题 + 绿色已答条），无交互入口。
 */

import { useState } from "react";

import type { AskUserMarkerPayload } from "@/lib/askuser-marker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface AskUserMarkerCardProps {
  /** 提问载荷（parseAskUserMarker 防御归一产物，见 askuser-marker.ts）。 */
  payload: AskUserMarkerPayload;
  /**
   * 已答关闭态（best-effort）：true = 该 marker 轮之后已存在用户消息。
   * 本地提交成功后组件内部也会立即转已答态（不等父层 turns 更新翻真）。
   */
  answered: boolean;
  /**
   * 提交回调：参数为组装好的答案文本，由消费方经既有发送链路作为下一条
   * 用户消息发出。
   */
  onSubmit: (answer: string) => void;
  /** 引擎展示名（副行前缀；marker 协议当前唯一生产方是 cursor，缺省即 cursor）。 */
  engineLabel?: string;
}

/** confirm 载荷缺 options 时合成的两选项（对齐 design 总体方案① confirm 语义）。 */
const CONFIRM_OPTIONS: Array<{ label: string }> = [{ label: "是" }, { label: "否" }];

export function AskUserMarkerCard({
  payload,
  answered,
  onSubmit,
  engineLabel = "cursor",
}: AskUserMarkerCardProps) {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  // 本地提交记录：发出后立即转已答态并回显所发答案（父层 heuristic 随后接管）。
  const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(null);

  const isAnswered = answered || submittedAnswer !== null;

  const options =
    payload.kind === "confirm" && (payload.options?.length ?? 0) === 0
      ? CONFIRM_OPTIONS
      : (payload.options ?? []);

  // 文本输入挂载条件：input/editor 形态、allowCustom，或无可选选项的
  // select/confirm（防御降级——解析器容许空 options，保证用户仍可作答）。
  const showTextInput =
    payload.kind === "input" ||
    payload.kind === "editor" ||
    payload.allowCustom === true ||
    options.length === 0;
  const multiline = payload.kind === "editor";

  // 答案组装（design §Wave B.4）：手动输入优先（填写后以输入内容作答，覆盖
  // 选项选择——与 AskUserDialogCard 同语义）；否则取选中选项 label。
  const assembleAnswer = (): string | null => {
    const custom = customText.trim();
    if (custom) return custom;
    return selectedLabel;
  };
  const canSubmit = !isAnswered && assembleAnswer() !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const answer = assembleAnswer();
    if (answer === null) return;
    setSubmittedAnswer(answer);
    onSubmit(answer);
  };

  // ── 已答关闭态（原型场景一/二 answered 形态：灰化徽标 + 问题 + 已答条） ──
  if (isAnswered) {
    return (
      <article
        data-testid="ask-user-marker-card"
        className="w-full rounded-xl border border-border bg-muted/40 px-4 py-3 opacity-80 shadow-sm"
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
            提问 · 已回答
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">
            {engineLabel}
          </span>
        </div>
        <p className="mb-2 text-sm font-semibold leading-relaxed text-foreground">
          {payload.question}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <span aria-hidden>✓</span>
          {submittedAnswer != null ? (
            <span>
              回答「{submittedAnswer}」已作为下一条消息发送，等待 agent 续轮
            </span>
          ) : (
            <span>已收到新的回答消息，本题已关闭</span>
          )}
        </div>
      </article>
    );
  }

  // ── 开放态（原型场景三 ask-card） ──
  return (
    <article
      data-testid="ask-user-marker-card"
      className="w-full rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-bold text-brand-700">
          提问
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">
          {engineLabel} · 本轮结束，你的回答将作为下一条消息自动发送
        </span>
      </div>
      <p className="mb-3 text-sm font-semibold leading-relaxed text-foreground">
        {payload.question}
      </p>
      {(payload.recommendResponders?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-dashed border-cyan-600/50 bg-cyan-50 px-2.5 py-1.5 text-xs text-cyan-800">
          <span>💡 agent 推荐</span>
          {payload.recommendResponders!.map((name) => (
            <span key={name} className="font-bold">
              @{name}
            </span>
          ))}
          <span>回答</span>
        </div>
      )}
      {options.length > 0 && (
        <div role="radiogroup" aria-label={payload.question} className="flex flex-col gap-2">
          {options.map((opt) => {
            const selected = selectedLabel === opt.label;
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedLabel(selected ? null : opt.label)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border-[1.5px] px-3 py-2 text-left text-[13px] transition-colors",
                  selected
                    ? "border-brand-500 bg-brand-100/70 font-semibold"
                    : "border-border bg-card hover:border-brand-400 hover:bg-brand-50",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                    selected ? "border-brand-600" : "border-muted-foreground/30",
                  )}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                </span>
                <span className="min-w-0 flex-1 break-words text-foreground">
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {showTextInput &&
        (multiline ? (
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="输入你的回答（支持多行）"
            rows={4}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <Input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={options.length > 0 ? "或输入自定义回答（填写后以此内容发送）" : "输入你的回答"}
            className="mt-2 h-9 text-sm"
          />
        ))}
      <div className="mt-3 flex justify-end">
        <Button disabled={!canSubmit} onClick={handleSubmit} title="提交并发送">
          提交并发送
        </Button>
      </div>
    </article>
  );
}
