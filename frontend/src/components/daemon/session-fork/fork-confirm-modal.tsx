"use client";

/**
 * ForkConfirmModal — 分叉确认弹层（2026-09-22-session-fork-continuation task-07 /
 * FR-01 / FR-04 / D-004@v1）。视觉与文案基准 = 原型 prototype-session-fork.html
 * 确认弹层节（.modal-mask / .modal / .info-row / .acts）。
 *
 * 职责切分（task-07 边界）：
 *   - 本组件：分叉点信息（源会话标题 @第 N 轮后）+ 引擎档位语义标注（native=
 *     「原生分叉·真截断」绿档 / seed=「种子分叉·前情转述（非原生上下文）」黄档，
 *     FR-04 UI 标注义务）+ 继承快照说明 + 确认调 forkSession；
 *   - 挂载方（task-08 接线）：入口门控与打开时机、成功后跳转 B 会话（onForked
 *     回调上抛，本组件不路由——page/dialog 双模式跳转语义不同）。
 *
 * 形态照 DeleteChangeConfirm 受控确认范式（fixed overlay + 父组件持有开关，
 * 本组件自带请求与提交态）；错误统一走 ApiError.message 透出（backend 409
 * 「分叉点所在轮仍在进行中…」/ 422 锚点缺失「可退种子档」文案已中文化，
 * role=alert 行内展示，不弹系统框）。
 *
 * 样式（双主题铁律）：结构色全走主题 token（bg-card / border-border /
 * bg-primary 确认按钮）；档位语义色走既有状态点色系（emerald=完成绿 / amber=
 * 警示黄，与段族 TASK_STATUS_BADGE、StderrRowView 同源语义阶），不硬编码 hex。
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { forkSession } from "@/lib/daemon";
import type { SessionForkResponse } from "@/lib/daemon";
import { ApiError } from "@/lib/api";
import { getProviderCaps } from "@/lib/provider-caps";
import { cn } from "@/lib/utils";

/** 档位语义标注元数据（FR-04 / D-004@v1：两档文案是验收断言点，勿改措辞）。 */
const FORK_TIER_META: Record<
  "native" | "seed",
  { badge: string; desc: string; badgeCls: string }
> = {
  native: {
    badge: "原生分叉·真截断",
    desc: "SDK 真截断恢复，新会话对分叉点之后的事完全不知情",
    badgeCls: "bg-emerald-600/15 text-emerald-700",
  },
  seed: {
    badge: "种子分叉·前情转述（非原生上下文）",
    desc: "引擎不支持原生截断，新会话以「前情转述」种子启动，细节有损、非原生上下文",
    badgeCls: "bg-amber-500/15 text-amber-700",
  },
};

export interface ForkConfirmModalProps {
  /** 源会话 id（fork 请求路径参数）。 */
  sessionId: string;
  /** 分叉锚轮 run id（「分叉自此轮之后」，请求体 at_run_id）。 */
  atRunId: string;
  /** 分叉点轮序号（展示「第 N 轮后」；run 创建序派生，挂载方传入）。 */
  atRunSeq: number;
  /** 源会话标题（分叉点信息展示；空串由挂载方兜底，本组件原样渲染）。 */
  sourceTitle: string;
  /** 源会话引擎 provider（经 getProviderCaps 取 sessionFork 档位做语义标注）。 */
  provider: string;
  /** 取消（父组件关弹层；不触发任何请求）。 */
  onCancel: () => void;
  /** 创建成功（forkSession 201 回执原样上抛；跳转 B 归挂载方）。 */
  onForked: (_resp: SessionForkResponse) => void;
}

export function ForkConfirmModal({
  sessionId,
  atRunId,
  atRunSeq,
  sourceTitle,
  provider,
  onCancel,
  onForked,
}: ForkConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 档位派生：入口已按 caps 门控（none 不渲染入口），此处防御性兜底——
  // none 档（未知 provider 回退值）不渲染弹层本体（请求必 422，无确认意义）。
  const tier = getProviderCaps(provider).sessionFork;
  if (tier === "none") return null;
  const tierMeta = FORK_TIER_META[tier];

  const handleConfirm = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await forkSession(sessionId, { at_run_id: atRunId });
      // 成功后不回退 submitting——弹层即将被挂载方关闭（onForked 内关态），
      // 防双击窗口期重复建 fork。
      onForked(resp);
    } catch (err) {
      // 409（轮进行中）/ 422（锚点缺失可退种子档 / 引擎不支持）等业务文案
      // 经 ApiError.message 中文化透出；非 ApiError 走通用兜底。
      setError(err instanceof ApiError ? err.message : "分叉创建失败，请重试");
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="fork-confirm-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-[460px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-5 shadow-lg">
        <h3 className="text-sm font-semibold">从此处创建分叉会话</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          新会话将继承截至所选轮次的全部上下文，原会话不受影响、可继续对话
        </p>
        <div className="mt-3 space-y-2">
          {/* 分叉点信息（原型 .info-row ①） */}
          <div className="flex items-start gap-2.5 rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-[13px] leading-6">
            <span aria-hidden className="shrink-0 text-brand-600">
              ⑂
            </span>
            <p data-testid="fork-confirm-point">
              分叉点：<b>「{sourceTitle}」第 {atRunSeq} 轮后</b>（含该轮全部上下文）
            </p>
          </div>
          {/* 引擎档位语义标注（FR-04 / D-004，原型 .info-row ② + .tier 药丸） */}
          <div className="flex items-start gap-2.5 rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-[13px] leading-6">
            <span aria-hidden className="shrink-0 text-brand-600">
              ⚡
            </span>
            <p data-testid="fork-confirm-tier">
              引擎档位：<b>{provider} · {tier === "native" ? "原生分叉" : "种子分叉"}</b>
              ——{tierMeta.desc}
              <span
                data-testid="fork-confirm-tier-badge"
                className={cn(
                  "ml-1.5 inline-flex items-center rounded-full px-2 py-px align-[1px] text-[10px] font-medium",
                  tierMeta.badgeCls,
                )}
              >
                {tierMeta.badge}
              </span>
            </p>
          </div>
          {/* 继承快照说明（原型 .info-row.warn ③） */}
          <div className="flex items-start gap-2.5 rounded-[10px] border border-amber-600/30 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-6">
            <span aria-hidden className="shrink-0 text-amber-600">
              ℹ
            </span>
            <p>继承快照：工作区 / 供应商 / 模型 / 档案按原会话当前值继承</p>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            data-testid="fork-confirm-error"
            className="mt-2 break-words text-[11px] leading-5 text-destructive"
          >
            分叉失败：{error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={submitting} onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" disabled={submitting} onClick={() => void handleConfirm()}>
            {submitting ? "创建中…" : "创建分叉并进入"}
          </Button>
        </div>
      </div>
    </div>
  );
}
