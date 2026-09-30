"use client";

// TakeoverBridgeNote —— tool_report 会话接手衔接提示条 + handoff 引擎选择器
// （2026-09-30-tool-report-activation-wrong-machine task-07 / FR-06 / D-004@v1 /
//  D-005@v2 / D-006@v1，原型 prototype-tool-report-activation.html 案例①②③）。
//
// 三态：
// - native（harness ∈ claude-code/codex）绿条：接续原引擎会话 + 派发机器名；
// - handoff（zcode 等）黄条：分叉新会话 + 交接文档说明 + 接手引擎选择器
//   （原机在线引擎集合，默认「默认映射」，D-005@v2）；
// - 原机离线红条：回放可浏览、接手需原机在线（不换机，D-002@v1）。
// 样式沿用 AI-Native 主题语义阶（emerald=ok / amber=warn / red=err 轻量内联，
// 与原型一致；不引 antd 组件保持轻条形态）。

import type { deriveTakeoverChrome } from "./page-helpers";

export function TakeoverBridgeNote({
  chrome,
  harness,
  provider,
  onProviderChange,
}: {
  chrome: ReturnType<typeof deriveTakeoverChrome>;
  harness: string;
  provider: string | null;
  onProviderChange: (next: string | null) => void;
}): JSX.Element {
  if (!chrome.machineOnline) {
    return (
      <span className="rounded-md bg-red-50 px-2 py-1 text-red-600">
        {`原机 ${chrome.machineLabel} 当前离线——回放可浏览，接手需该机器 daemon 在线（不会换机执行）`}
      </span>
    );
  }
  return (
    <>
      <span
        className={
          chrome.tier === "native"
            ? "rounded-md bg-emerald-50 px-2 py-1 text-emerald-700"
            : "rounded-md bg-amber-50 px-2 py-1 text-amber-700"
        }
      >
        {chrome.tier === "native"
          ? `继续对话将接续原 ${harness || "本地"} 会话（引擎级 resume，上下文延续），派发到上报机器 ${chrome.machineLabel}`
          : `${harness || "该 harness"} 会话不支持引擎级续聊：继续对话将分叉出新会话（列表标注「分叉自本会话」），由接手 agent 基于交接文档继续；本会话保持只读回放`}
      </span>
      {chrome.tier === "handoff" && chrome.engines.length > 0 && (
        <label className="flex items-center gap-1 text-muted-foreground">
          接手引擎：
          <select
            aria-label="接手引擎"
            className="rounded-md border border-border bg-card px-2 py-1"
            value={provider ?? ""}
            onChange={(e) => onProviderChange(e.target.value || null)}
          >
            <option value="">默认映射</option>
            {chrome.engines.map((eng) => (
              <option key={eng} value={eng}>
                {eng}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
