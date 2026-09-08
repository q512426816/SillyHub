"use client";

/**
 * 定时发送弹窗 + 系统提示行（page / dialog 两模式共用的模块级展示件）。
 *
 * D-010 第二回合（merge main 2ad590192）自原 session-panel.tsx 单文件逐字
 * 移植（原位于 TurnStalledWatchdogBanner 与 SessionPanelPage 之间的模块级
 * 区，2026-09-07-session-pin-rename-scheduled-send task-08 / FR-04 / FR-05）。
 * 弹窗纯受控展示（两模式各自持有 state）；展示条本体在
 * ../scheduled-messages-bar（main 侧新文件，随 merge 带入）。
 */

import dayjs, { type Dayjs } from "dayjs";
import { Clock } from "lucide-react";
import { Button, DatePicker, Modal } from "antd";

/**
 * 快捷时间项（design §Wave 3.4）：全部按**本地时区**计算（dayjs 默认本地实例，
 * 提交时 toISOString 统一转 UTC ISO 交后端）。「明早 9 点」恒为明天 09:00——
 * 今天 9 点是否已过不存在歧义分支。
 */
const SCHEDULE_QUICK_PICKS: ReadonlyArray<{ label: string; at: (now: Dayjs) => Dayjs }> = [
  { label: "30 分钟后", at: (now) => now.add(30, "minute") },
  { label: "1 小时后", at: (now) => now.add(1, "hour") },
  {
    label: "明早 9 点",
    at: (now) => now.add(1, "day").hour(9).minute(0).second(0).millisecond(0),
  },
];

/**
 * 创建成功后的系统提示行（挂 TurnTimeline streamFooter 注入口——「对话流里的
 * 一条消息」形态，ql-20260823-002-6a1a 预留位首个消费方）。样式照既有紧凑
 * sys 行（TurnRow 配置变更标记同款：muted 小字一行 + 图标），本地态刷新即逝
 * ——定时消息权威列表在 ScheduledMessagesBar。
 */
export function ScheduledSysHints({ hints }: { hints: string[] }) {
  return (
    <div data-testid="scheduled-sys-hints" className="space-y-1">
      {hints.map((text, i) => (
        <div
          key={`${i}-${text}`}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-70"
        >
          <Clock aria-hidden className="h-3 w-3 shrink-0" />
          <span className="break-all">{text}</span>
        </div>
      ))}
    </div>
  );
}

/** 定时发送弹窗 props（两模式各自持有 state，弹窗纯受控展示）。 */
interface ScheduledSendModalProps {
  open: boolean;
  /** 当前输入框草稿（内容预览 + 确认按钮空态禁用）。 */
  draft: string;
  /** 选定发送时间（Dayjs 本地时间，分钟级）。 */
  value: Dayjs | null;
  /** 创建请求在途（提交按钮 loading + 防重复）。 */
  submitting: boolean;
  onChange: (next: Dayjs | null) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 定时发送弹窗（原型 .mask/.modal 区块）：说明行 + 草稿预览 + 分钟级 DatePicker
 * （disabledDate 禁选今天之前的日期；≥ now+60s 的精细校验由后端兜底 422 →
 * toast）+ 快捷项 chips（30 分钟后 / 1 小时后 / 明早 9 点）。空草稿禁用确认并
 * 行内提示（后端空 prompt 422 的前端前置拦截，附件豁免口径不适用——定时入口
 * 不携带附件）。
 */
export function ScheduledSendModal({
  open,
  draft,
  value,
  submitting,
  onChange,
  onCancel,
  onConfirm,
}: ScheduledSendModalProps) {
  const empty = !draft.trim();
  return (
    <Modal
      open={open}
      title="定时发送"
      onCancel={submitting ? undefined : onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={submitting}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          onClick={onConfirm}
          loading={submitting}
          disabled={empty || !value}
        >
          创建定时消息
        </Button>,
      ]}
    >
      <p className="text-xs leading-5 text-muted-foreground">
        到点自动发送以下消息；会话正忙时自动进入消息队列排队，设定后可随时取消。
      </p>
      <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="text-[11px] text-muted-foreground">将发送的内容</div>
        <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-[13px] leading-5">
          {draft.trim() ? draft : "（空）"}
        </div>
      </div>
      <div className="mt-3">
        <DatePicker
          value={value}
          onChange={(v) => onChange(v)}
          showTime={{ format: "HH:mm" }}
          format="YYYY-MM-DD HH:mm"
          allowClear={false}
          disabledDate={(d) => d.isBefore(dayjs().startOf("day"))}
          placeholder="选择发送时间（分钟级）"
          aria-label="定时发送时间"
          className="w-full"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SCHEDULE_QUICK_PICKS.map((pick) => (
          <button
            key={pick.label}
            type="button"
            onClick={() => onChange(pick.at(dayjs()))}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
          >
            {pick.label}
          </button>
        ))}
      </div>
      {empty && (
        <p className="mt-2 text-[11px] text-amber-700">
          输入内容为空，无法创建定时消息——请先在输入框写好要发送的内容
        </p>
      )}
    </Modal>
  );
}
