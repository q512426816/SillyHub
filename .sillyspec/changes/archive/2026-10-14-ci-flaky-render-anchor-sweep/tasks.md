---
author: flow-machine-draft
created_at: 2026-10-13T21:40:45.988Z
---
# 任务注册表（Tasks）— 2026-10-14-ci-flaky-render-anchor-sweep

- [x] task-01: 6 处确认脆弱点全部改为渲染锚等待：同步 getByXxx/textContent 断言包进 await waitFor（或等价 findByXxx），断言不再早于渲染提交
- [x] task-02: 涉及 5 个测试文件本地全量转绿（vitest 定向跑该 5 文件）
- [x] task-03: 零生产代码改动：仅测试文件时序加固
