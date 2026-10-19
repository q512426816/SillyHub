---
author: flow-machine-draft
created_at: 2026-10-19T01:56:39.052Z
---
# 任务注册表（Tasks）— 2026-10-19-shared-agent-onboarding-hint

- [x] task-01: session-panel-page.tsx 接预会话门控数据——新增 sharedAgentOnboarding 轻量查询（listDaemonMachines limit=1、enabled=预会话态、staleTime 30s）与 noOwnNoSharedMachine / firstOnlineSharedAgent 派生；验证：pnpm exec tsc --noEmit 0 错
- [x] task-02: 默认选中 effect + 手动交互守卫（preProfileTouchedRef；onProvisionalSwitch 档案分支置位）；验证：单测「默认选中」「手动选不指定后不再覆盖」绿
- [x] task-03: 预会话区引导提示条（data-testid=pre-session-shared-agent-hint，含智能体名/读源码不受限/写限共享输出目录/可切换指引）；验证：单测断言提示渲染与文案
- [x] task-04: fail-open 分支核对（有自有或共享机器/共享智能体全离线/机器请求失败 → 不选中不提示）；验证：单测三分支绿
- [x] task-05: 聚焦测试文件全量跑绿 + tsc 0 错收口；验证：vitest run 该文件全过、tsc --noEmit 干净
