---
author: flow-machine-draft
created_at: 2026-10-13T21:40:45.988Z
---
# 提案书（Proposal）— 2026-10-14-ci-flaky-render-anchor-sweep

## 动机

任务原话转写：动机：CI 连续逐轮暴露「mock 调用等待后同步断言渲染」型时序脆弱用例（agent-replay-body、session-history-scroll 已修），全量甄别（只读子代理 47 次取证）确认 frontend 尚有 6 处同机理渲染竞速、涉及 5 文件：api-keys page.test 115-118、m-change-detail test 279-284、team-task-block test 232-233、governance-cards test 155-158、ask-user-dialog-card test 737-742 与 769-772；计数竞速零新增。各文件内均有正确写法先例可对齐（渲染断言包进 waitFor 命中终态）。
成功标准：
- 6 处确认脆弱点全部改为渲染锚等待：同步 getByXxx/textContent 断言包进 await waitFor（或等价 findByXxx），断言不再早于渲染提交
- 涉及 5 个测试文件本地全量转绿（vitest 定向跑该 5 文件）
- 零生产代码改动：仅测试文件时序加固

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 6 处确认脆弱点全部改为渲染锚等待：同步 getByXxx/textContent 断言包进 await waitFor（或等价 findByXxx），断言不再早于渲染提交
2. 涉及 5 个测试文件本地全量转绿（vitest 定向跑该 5 文件）
3. 零生产代码改动：仅测试文件时序加固

## 成功标准（可验证）

1. 6 处确认脆弱点全部改为渲染锚等待：同步 getByXxx/textContent 断言包进 await waitFor（或等价 findByXxx），断言不再早于渲染提交
2. 涉及 5 个测试文件本地全量转绿（vitest 定向跑该 5 文件）
3. 零生产代码改动：仅测试文件时序加固
