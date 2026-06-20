---
id: task-02
title: frontend SessionHistoryView 按 channel 渲染用户/agent 气泡
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-1]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
---

## 修改文件
- `frontend/src/app/(dashboard)/runtimes/page.tsx`：`SessionHistoryView`（:957-1025）
- `frontend/src/lib/daemon.ts`：`AgentRunLogEntry` type（补 `channel` 字段，后端 schema `agent/schema.py:123-129` 已有）
- 测试：`runtimes/page.test.tsx`

## 覆盖来源
- design.md §4.1、§13；decisions D-001@v1、D-005@v1；requirements FR-1

## 实现要求
1. `AgentRunLogEntry` type 加 `channel: string`（与后端 `AgentRunLogEntry` DTO 对齐）
2. `SessionHistoryView` 渲染 `entries` 时按 `log.channel` 区分：
   - `channel === "user"` → 右对齐气泡，`bg-primary text-primary-foreground`（参考 `InteractiveSessionPanel` 用户气泡样式 :532）
   - 其余（`stdout/stderr/tool_call`）→ 左对齐白底气泡（`border bg-card`），保留现有 :1013 样式
3. 保留按 `run_id` 分组（:971 groups）+ run tag（:1007）
4. 同一 run 内 user log 在前（后端 timestamp 排序保证），agent log 在后

## 接口定义
- `AgentRunLogEntry`（`lib/daemon.ts`）：`{ id: string; run_id: string; timestamp: string; channel: string; content_redacted: string }`
- 渲染判定：`const isUser = log.channel === "user"`

## 边界处理
1. **旧会话无 user log（D-005）**：该 run 仅 agent 气泡，无用户气泡，不报错
2. **log 无 channel 字段（前端 type 未同步/异常）**：`channel` 缺失按非 user 处理（agent 气泡），不崩
3. **user log 的 `content_redacted` 为空**：渲染空气泡或跳过（与 agent 空 content 一致）
4. **同一 run 多条 user log**：理论上每 turn 1 条；防御性全部右对齐渲染
5. **tool_call/stderr channel**：仍走 agent 气泡（左对齐），可保留原样或按 channel 加小标签（本任务不加，YAGNI）

## 非目标
- 不改 `InteractiveSessionPanel`（task-10 attach 模式才动）
- 不加 tool/stderr 的特殊样式（YAGNI）
- 不补旧数据 user log（D-005）

## 参考
- 用户气泡样式：`interactive-session-panel.tsx:532`（`bg-primary ... text-primary-foreground`，右对齐 `justify-end`）
- 现有 agent 气泡：`page.tsx:1011-1016`

## TDD 步骤
1. 写测试：SessionHistoryView 渲染含 `channel:"user"` log → 出现右对齐 primary 气泡；含 stdout log → 左对齐
2. 确认失败
3. 实现按 channel 渲染
4. 确认通过；补旧会话无 user log 不崩测试
5. 回归现有 page.test.tsx

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 回看含 `channel:"user"` log | 渲染右对齐 primary 气泡 |
| AC-02 | 回看含 stdout/stderr/tool_call log | 渲染左对齐白底气泡 |
| AC-03 | 按 run 分组 | 每个 run tag 下 user 在前、agent 在后 |
| AC-04 | 旧会话（无 user log） | 不报错，仅显 agent 气泡 |
| AC-05 | page.test.tsx 回归 | 全绿 |
