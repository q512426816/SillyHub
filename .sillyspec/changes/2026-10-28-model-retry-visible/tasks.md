---
author: flow-machine-draft
created_at: 2026-10-27T23:39:20.199Z
---
# 任务注册表（Tasks）— 2026-10-28-model-retry-visible

- [x] task-01: daemon 归一化——claude-events.ts `_normalizeSystemMessage` 新增 api_retry 分支（status 事件 + metadata 五字段 + error 截断 + 缺字段不伪造），先写 tests/interactive/claude-events.test.ts 归一化用例（429/连接类 error_status=null/缺字段）跑绿再实现
- [ ] task-02: daemon 分发——session-manager/events.ts `_dispatchStatusEvent` 新增 api_retry case（runId 空丢弃、[MODEL_RETRY]+单行 JSON stdout 行、error 截断），新建 tests/interactive/session-manager-status-dispatch.test.ts 覆盖落行/丢弃/截断并跑绿
- [ ] task-03: 前端分类——session-log-assembler.ts 新增 kind=model_retry（先于 reply 兜底与 API Error 丢弃规则），__tests__/session-log-assembler.test.ts 补分类与载荷解析失败兜底用例并跑绿
- [ ] task-04: 前端渲染——turn-segment-views.tsx 新增 model_retry 段渲染（运行中「模型限流重试中 第N/M次」+摘要、终态对话正文不渲染、解析失败中性兜底），turn-status-bar.tsx 补 segmentTs case 与 currentActivity 回退链；__tests__/turn-segment-views.test.tsx 与 __tests__/turn-status-bar-phase.test.tsx 补用例并跑绿
- [ ] task-05: 回归验证——daemon 相关套件（claude-events/golden/agent-event-schema 等）与前端相关套件（assembler/segment-views/status-bar/sanitize）全绿，backend/ 目录零 diff（FR-03 禁改面核对）
