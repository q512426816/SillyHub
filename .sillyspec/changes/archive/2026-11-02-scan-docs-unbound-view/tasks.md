---
author: flow-machine-draft
created_at: 2026-11-02T02:41:51.555Z
---
# 任务注册表（Tasks）— 2026-11-02-scan-docs-unbound-view

- [x] task-01: DaemonRequiredNotice 加 variant="degraded" 变体（横幅文案「当前展示工作区已有数据」口径 + 保留配置入口/引导展开/onConfigured）+ daemon-required-notice.test.tsx 补 degraded 用例与缺省回归，组件测试绿
- [x] task-02: scan-docs/page.tsx 进页解绑门槛（列表无条件拉取 + 后台 reparse 不再 gate）+ 渲染层改非阻断 degraded 横幅 + 修正 222-223 行过时 daemon 依赖注释
- [x] task-03: scan-docs-page.test.tsx 补无绑定用例（树照常渲染/横幅非阻断含配置入口/reparse 照发/详情可用）+ 有绑定回归断言（默认不渲染横幅），本变更测试面全绿
