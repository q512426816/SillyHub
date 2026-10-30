---
author: flow-machine-draft
created_at: 2026-10-30T08:31:22.030Z
---
# 任务注册表（Tasks）— 2026-10-30-provider-user-share

- [x] task-01: 建 llm_provider_shares 模型+迁移+共享 DTO/service CRUD（按 username/email 解析、唯一幂等、拒绝自己/未知/禁用、列表/撤销、usable 列表）；写 backend/app/modules/llm_provider/tests/test_provider_shares.py 并跑绿。
- [x] task-02: 前端数据面——lib/api/llm-providers.ts 增 usable/共享客户端与类型；session-config-bar 改读可用列表并给共享项加「共享·来自 X」标识；补 session-config-bar.test.tsx 用例并跑绿。
- [x] task-03: 授权接线——inject_gates 创建/切换校验改为属主或共享；lease/context 会话级解析按会话属主 + 共享授权（抽 _provider_config_from_row），补 claim/切换用例并跑绿。
- [x] task-04: 设置页属主侧共享弹窗（share-provider-dialog + 供应商卡「共享」入口：按用户名/邮箱添加、列表、撤销）；确认设置页 own-only 且共享项无写入口，跑前端测试/tsc。
- [x] task-05: 撤销语义回归——补「撤销后 usable 消失 + 存量会话下一轮回落默认链」用例；确认被共享方 PATCH/DELETE/set-default/usage 仍 404/403 且无明文 key。
- [x] task-06: 总回归——重跑 llm_provider 测试、daemon lease/session_switch 相关测试、前端 session-config-bar 测试与 tsc/lint，记录结果。
