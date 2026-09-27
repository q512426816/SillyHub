/**
 * prototype-as-code 演示视图 —— SillySpec 变更流程状态机（流程类原型示例）。
 *
 * 流程类原型没有对应页面：源是节点/边 JSON（下方 FLOW_NODES/FLOW_EDGES，
 * 可 diff 可评审），经 FlowDiagram 渲染为分层 SVG，与页面视图共用编译管线。
 * 流程依据：AGENTS.md「选道」表 + 轻量变更/完整流程两通道语义。
 */
import * as React from "react";

import { DemoBar } from "./demo-chrome";
import { FlowDiagram, type FlowEdge, type FlowNode } from "./flow-diagram";

const FLOW_NODES: FlowNode[] = [
  // 轻量变更（默认快道）
  { id: "t-start", lane: "thin", layer: 0, label: "flow start", sub: "成功标准过门", tone: "brand" },
  { id: "t-work", lane: "thin", layer: 1, label: "干活", sub: "改代码 · 写测试" },
  { id: "t-done", lane: "thin", layer: 2, label: "flow done", sub: "实测门 + patch 留档", tone: "warning" },
  { id: "t-archive", lane: "thin", layer: 3, label: "归档", tone: "success" },
  // 完整流程（大改动）
  { id: "f-brainstorm", lane: "full", layer: 0, label: "brainstorm", sub: "预段方案探索" },
  { id: "f-plan", lane: "full", layer: 1, label: "plan", sub: "Wave 计划编排" },
  { id: "f-execute", lane: "full", layer: 2, label: "execute", sub: "逐任务推进" },
  { id: "f-verify", lane: "full", layer: 3, label: "verify", sub: "探针 + 三轮审查", tone: "warning" },
  { id: "f-archive", lane: "full", layer: 4, label: "archive", tone: "success" },
];

const FLOW_EDGES: FlowEdge[] = [
  { from: "t-start", to: "t-work" },
  { from: "t-work", to: "t-done" },
  { from: "t-done", to: "t-archive", label: "实测通过" },
  { from: "f-brainstorm", to: "f-plan" },
  { from: "f-plan", to: "f-execute" },
  { from: "f-execute", to: "f-verify" },
  { from: "f-verify", to: "f-archive", label: "PASS" },
  // 跨通道
  { from: "f-brainstorm", to: "t-start", label: "完成后收编续跑", dashed: true },
  { from: "t-done", to: "f-execute", label: "实测失败自动升厚", dashed: true },
];

function Legend() {
  const item = "flex items-center gap-1.5 text-xs text-muted-foreground";
  const chip = "inline-block h-3 w-5 rounded";
  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className={item}>
        <span className={chip} style={{ backgroundColor: "var(--color-brand-50)", outline: "1px solid var(--color-brand-600)" }} />
        主径入口
      </span>
      <span className={item}>
        <span className={chip} style={{ backgroundColor: "hsl(var(--card))", outline: "1px solid hsl(var(--border))" }} />
        常规节点
      </span>
      <span className={item}>
        <span className={chip} style={{ backgroundColor: "var(--semantic-warning-soft)", outline: "1px solid hsl(var(--warning))" }} />
        门禁
      </span>
      <span className={item}>
        <span className={chip} style={{ backgroundColor: "var(--semantic-success-soft)", outline: "1px solid hsl(var(--success))" }} />
        终态
      </span>
      <span className={item}>
        <svg width="26" height="8" viewBox="0 0 26 8">
          <path d="M 1 4 C 9 4, 17 4, 25 4" stroke="hsl(var(--muted-foreground))" strokeWidth="1.25" strokeDasharray="5 4" fill="none" />
        </svg>
        跨通道转道
      </span>
    </div>
  );
}

export function SillySpecFlowView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-col gap-2">
          <nav className="text-xs text-muted-foreground">SillySpec / 流程原型</nav>
          <h1 className="text-xl font-semibold leading-7">变更流程状态机 · 轻量道与完整道</h1>
          <p className="text-xs leading-5 text-muted-foreground">
            流程类原型示例：源为节点/边 JSON（本文件 FLOW_NODES / FLOW_EDGES，随代码评审与
            diff），产物为编译后的分层 SVG——没有对应页面，批准后对照 JSON 源写状态机测试与 design 引用。
          </p>
        </div>
        <div className="mt-4">
          <Legend />
        </div>
        <div
          className="mt-4 overflow-x-auto rounded-lg border bg-card px-4 py-4"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <FlowDiagram
            nodes={FLOW_NODES}
            edges={FLOW_EDGES}
            lanes={["thin", "full"]}
            laneLabels={{ thin: "轻量变更（默认快道）", full: "完整流程（大改动）" }}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          语义依据：AGENTS.md「选道」——需求已含决策走轻量；方案探索走头脑风暴预段（完成后
          flow start 收编续跑）；轻量实测失败自动升厚进入完整流程执行段。
        </p>
      </main>
    </div>
  );
}
