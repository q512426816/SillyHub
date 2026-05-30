---
id: task-04
title: Agent Console 页面 SSE 集成
priority: P0
estimated_hours: 2
depends_on: [task-01, task-02, task-03]
blocks: [task-06]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
---

# task-04: Agent Console 页面 SSE 集成

## 修改文件
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`

## 实现要求
1. 将 L228-239 的 3 秒轮询 useEffect 替换为 SSE 实时消费
2. Agent running 时：用 streamAgentRunLogs 连接 SSE，实时推送日志行到 activeLogs state
3. Agent completed/failed 时：保持现有 DB 查询逻辑不变
4. 组件卸载时关闭 EventSource

## 接口定义

```tsx
/* 替换原来的 Poll active logs useEffect */
useEffect(() => {
  if (!activeRunId) return;

  // Check if the active run is still running
  const run = runs.find(r => r.id === activeRunId);
  if (!run || run.status !== "running") return;

  const es = streamAgentRunLogs(
    workspaceId,
    activeRunId,
    (event) => {
      setActiveLogs(prev => [...prev, {
        id: crypto.randomUUID(),
        run_id: activeRunId,
        timestamp: event.timestamp,
        channel: event.channel,
        content_redacted: event.content,
      }]);
    },
    () => {
      // done: SSE closed, run likely completed
      // Reload run status from DB
      void reload();
    },
  );

  return () => es.close();
}, [activeRunId, workspaceId, runs]);
```

## 边界处理
1. Agent 状态不是 running：不连接 SSE，跳过
2. EventSource 连接失败：浏览器自动重连（默认行为）
3. 收到 done event：触发 reload() 刷新 run 状态，之后 completed 逻辑加载 DB 日志
4. activeLogs state 增量追加：每次 onMessage 追加而非替换，避免丢失之前的行
5. 组件卸载：useEffect cleanup 调用 es.close()
6. 切换 activeRunId：cleanup 关闭旧 SSE，新 SSE 连接新 run

## 非目标
- 不改 completed 状态的日志展示逻辑
- 不改 run 列表的 5 秒轮询（L199）
- 不改 Task Detail 页面（后续可单独优化）

## 参考
- 现有轮询逻辑（agent/page.tsx L228-239）
- streamAgentRunLogs 函数（task-03 产出）

## TDD 步骤
集成验证在 task-06 完成。此任务侧重 UI 变更，通过手动测试验证。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 打开 running 状态的 Agent Console | 日志行实时逐行出现，无 3 秒延迟 |
| AC-02 | Agent 运行结束 | SSE 关闭，页面自动刷新显示完整 DB 日志 |
| AC-03 | 关闭页面/切换 tab | EventSource 被 close，无内存泄漏 |
| AC-04 | 打开 completed 状态的 Agent Console | 行为与修改前完全一致（DB 查询） |
