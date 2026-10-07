---
author: flow-machine-draft
created_at: 2026-10-07T15:19:41.486Z
---
# 决策记录（Decisions）— 2026-10-07-ci-failures-sweep

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：test_files_router 若未来 fixture 只剩归档 change，next(... location=="active") 会 StopIteration——但两活跃 change 是 fixture 固定资产，风险极低。试过放弃：为 FR-04 新增 takeover 端点归档 409 端到端用例——放弃，takeover 前置校验链（原机四级钉定/provider 行解析）夹具过重，且其写入口经 create 链已被 test_session_create_on_archived_returns_409 的 ensure_writable 守卫用例覆盖，加重复用例只增脆弱面。
