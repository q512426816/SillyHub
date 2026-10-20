---
author: flow-machine-draft
created_at: 2026-10-20T03:44:06.234Z
---
# 任务注册表（Tasks）— 2026-10-20-session-error-visibility

- [x] task-01: 写 page-helpers-error-visibility 测试（interrupted+error_detail 升级 failed / 真打断保持 killed 两向用例），先红后绿
- [x] task-02: 改 page-helpers.tsx enrichOne：killed 且 meta.status=failed 时 buildErrorLogItem 可解析 → 升级 failed + errorDetail 回填；跑 task-01 测试转绿
- [x] task-03: 改 session-panel-page.tsx 实时终态：错误详情拉取条件扩展（killed+failed+interactive_interrupted 也拉），回补时翻 status=failed + errorDetail；真打断不翻
- [x] task-04: 改 run-error-item.tsx raw 首行摘要默认渲染 + 更新 run-error-item.test.tsx 断言；vitest 全绿
- [ ] task-05: 生产前端视觉验证：playwright 连生产复现页（本地构建产物或部署后），确认错误卡渲染且 raw 首行可见、真打断仍显示已中止
