"use client";

/**
 * SubagentDetailPanel · 右栏子代理详情面板壳（task-03 /
 * 2026-09-15-subagent-three-pane-display / FR-03 / FR-05 / D-001@v1 / design §5.E）。
 *
 * - 壳风格对齐 sessions/portal-file-panels.tsx（头部高度 / 边框圆角 / ✕ 按钮）：
 *   根 flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card，
 *   头部 border-b px-3 py-2 + antd text Button 关闭（data-testid=subagent-panel-close）。
 * - 头部派生复用 turn-segment-views 的共享纯函数 subagentHeaderOf(segment, now)
 *   （状态点 / 🤖 / 名称 / subagentType 标签 / task-13 徽标 / 时长，一处派生防漂移）；
 *   async 后台运行中本地走秒 tick 与 SubagentBlockView 同模式（仅运行中启动）。
 * - 正文与主会话「进度」视图完全同构：segment.children 经 SegmentView 递归渲染
 *   （文本 / 思考 / 工具展开 / 文件卡 / stderr），面板内独立滚动（overflow-y-auto）。
 *   段由父级（session-panel-page）从 displayTurns 实时解析传入活引用——SSE 更新
 *   即重渲，本组件零取数（constraints：不自带取数）。
 * - 嵌套子代理（depth>1）在 children 中经 SegmentView → SubagentBlockView 渲染
 *   为紧凑卡片（SubagentPanelContext 在页面级 Provider 已生效），点击
 *   openSubagent(嵌套段 id) 由父级切面板内容（单槽位语义，design §5.E）。
 * - 无任何输入框 / 发送控件（FR-03 底线：不支持继续对话）。
 * - 段 id 失效（null）不在本组件处理——由 page 层 effect 检测并 onSubagentPanelClose
 *   自动关闭（design §5.E），本组件契约 segment 恒非 null。
 */

import { memo, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "antd";

import { SegmentView, subagentHeaderOf } from "@/components/daemon/turn-segment-views";
import type { SubagentContainerSegment } from "@/components/daemon/turn-segment-views";
import { dispatchPromptOfRaw } from "@/components/daemon/session-log-assembler";
import { cn } from "@/lib/utils";

export interface SubagentDetailPanelProps {
  /** 子代理容器段（父级从 displayTurns 实时解析的活引用，恒非 null）。 */
  segment: SubagentContainerSegment;
  /** 头部 ✕ 关闭回调（上抛宿主清右栏槽位）。 */
  onClose: () => void;
}

/**
 * 右栏子代理详情面板：头部（✕ + 状态点 + 🤖 + 名称 + 类型标签 + 状态徽标 +
 * 时长）+ 正文（children 段时间线，SegmentView 递归，与主会话进度视图同构）。
 * memo 浅比较依赖装配器 path-copy 的段引用稳定性（同 turn-segment-views 约定）。
 */
export const SubagentDetailPanel = memo(function SubagentDetailPanel({
  segment,
  onClose,
}: SubagentDetailPanelProps) {
  // task-13 走秒同模式：tick 是组件局部 state，仅 async 元数据运行中启动
  // （终态 / 卸载清理），锚点 = 段 startedAt（派发时刻）。
  const [now, setNow] = useState<number>(() => Date.now());
  const asyncRunning = segment.kind === "tool" && segment.taskStatus === "running";
  useEffect(() => {
    if (!asyncRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [asyncRunning]);

  // 头部派生共享纯函数（design §5.E：与 SubagentBlockView 头部一处派生）。
  const header = subagentHeaderOf(segment, now);

  // 用户验收返工（2026-09-15）：初始化提示词——派发 tool_call JSON 的 args.prompt
  // 全文。children 只含子代理侧日志，派发指令本体在父级 tool 段 raw 里，不提取
  // 就永远看不到「这个子代理被要求做什么」。stub 段无 raw 天然不渲染（tool_use
  // 到达后 stub 合并迁入 tool 段，届时可见）。
  const dispatchPrompt =
    segment.kind === "tool" ? dispatchPromptOfRaw(segment.raw)?.trim() ?? null : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* 头部：✕ 关闭 + 状态点 + 🤖 名称 + 类型标签 + 状态徽标 + 时长
          （portal-file-panels PortalFilePreviewPanel 头部同款壳）。 */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Button
          size="small"
          type="text"
          aria-label="关闭子代理面板"
          data-testid="subagent-panel-close"
          onClick={onClose}
        >
          <X aria-hidden className="h-4 w-4" />
        </Button>
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", header.dotCls)} />
        <span aria-hidden className="shrink-0">
          🤖
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {header.name}
        </span>
        {header.subagentType && (
          <span className="shrink-0 rounded-lg border border-border bg-card px-1.5 text-[10px] text-muted-foreground">
            {header.subagentType}
          </span>
        )}
        {/* task-13 元数据状态徽标（后台运行中/已完成/失败/已停止）；
            前台路径不渲染（无元数据）。 */}
        {header.badge && (
          <span
            className={cn(
              "shrink-0 rounded-[5px] px-2 py-px text-[10.5px] font-semibold",
              header.badge.cls,
            )}
          >
            {header.badge.label}
          </span>
        )}
        {header.durationText && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {header.durationText}
          </span>
        )}
      </div>

      {/* 正文：children 段时间线经 SegmentView 递归（与主会话进度视图同构：
          文本气泡 / 思考折叠 / 工具展开 / 文件卡 / stderr 全量渲染），面板内
          独立滚动；无输入框（FR-03）。 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5">
        {dispatchPrompt && (
          // 任务指令块（用户验收返工）：正文首块固定展示派发 prompt 全文——
          // select-text 可选中复制，whitespace-pre-wrap 保留原始换行。
          <div
            data-testid="subagent-dispatch-prompt"
            className="select-text rounded-lg border border-border bg-muted/50 px-3 py-2"
          >
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
              📋 任务指令（初始化提示词）
            </p>
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-6 text-foreground">
              {dispatchPrompt}
            </p>
          </div>
        )}
        {segment.children.map((child) => (
          <SegmentView key={child.id} segment={child} />
        ))}
      </div>
    </div>
  );
});
