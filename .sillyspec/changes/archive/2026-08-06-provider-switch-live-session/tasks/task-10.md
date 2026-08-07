---
id: task-10
title: backend daemon critical-path unit tests
title_zh: 后端加 daemon 关键路径单测
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - backend/app/modules/llm_provider/tests/
  - backend/app/modules/daemon/lease/tests/
  - sillyhub-daemon/tests/
  - sillyhub-daemon/tests/interactive/
goal: >
  后端与 daemon 关键路径单测,覆盖凭证探测、推送调用、凭证失败回滚、helper 复用、
  markPendingSwitch、_onResult 触发 reload、reloadWithProvider resume 与 provider_config 为 null 回退本机。
implementation:
  - 后端 probe 有效凭证 + 无效 key + 网络错三态用例
  - notify 按 daemon_id 分组 + 无 active session 时 no-op
  - send_session_control 推送调用参数断言
  - set_default 与 unset_default 凭证失败回滚保留原默认
  - resolve_default_provider_config 复用 + 无默认返回 None
  - daemon markPendingSwitch 空闲立即 reload + 生成中仅标记
  - _onResult 在 turn 收尾触发 reload
  - reloadWithProvider resume 保留上下文 + null 回退本机 + 失败保留旧 query
acceptance:
  - 后端单测全绿
  - daemon 单测全绿
verify:
  - cd backend && pytest
  - cd sillyhub-daemon && pnpm test
constraints:
  - 重点覆盖凭证失败回滚 + provider_config 为 null 回退两条关键边界
  - 测试文件放各模块 tests 目录(后端 test_*.py,daemon tests/*.test.ts)
  - mock 凭证避免真实 key,禁止外发真实请求
---
