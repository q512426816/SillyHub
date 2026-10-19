---
author: flow-machine-draft
created_at: 2026-10-19T02:23:47.129Z
---
# 任务注册表（Tasks）— 2026-10-19-hide-shared-profile-in-session

- [x] task-01: session-config-bar.tsx 加 visibleProfiles 派生——真会话过滤共享条目（按 sharedProfileIds，active 失败空集不过滤）、当前 agentProfileId 豁免保留；下拉渲染换 visibleProfiles；验证：tsc 0 错
- [x] task-02: 预会话（provisional）分支共享条目置顶（普通档案保原序）；验证：单测断言渲染顺序
- [x] task-03: 聚焦测试——真会话隐藏 / 当前共享档案豁免 / 预会话置顶+共享标识（既有标识用例迁预会话）；验证：vitest 该 describe 全绿
- [x] task-04: 全量聚焦文件跑绿 + tsc 收口；验证：vitest run session-config-bar.test.tsx 全过、tsc --noEmit 干净
