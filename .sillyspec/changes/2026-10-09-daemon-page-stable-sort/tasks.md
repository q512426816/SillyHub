---
author: flow-machine-draft
created_at: 2026-10-09T15:01:05.476Z
---
# 任务注册表（Tasks）— 2026-10-09-daemon-page-stable-sort

- [x] task-01: 改 runtime/service.py list_machines 主查询排序：online 优先保留，`last_heartbeat_at DESC` 换成 `coalesce(display_alias, hostname) ASC, id ASC`，同步 docstring/行内注释。验证：pytest test_machines_router.py 排序用例（改写后）通过
- [x] task-02: 改 list_machines 嵌套 runtimes 二次查询：`provider` 后追加 `created_at ASC, id ASC`（provider 显式 nulls_last 对齐方言）。验证：新增同 provider 稳定序用例通过
- [x] task-03: 改 grants/queries.py list_machines_shared_to_me 的 runtimes 明细查询：追加 `created_at, id` tiebreaker。验证：新增 shared 明细稳定序用例通过
- [x] task-04: 测试收口：改写 test_machines_sort_online_first_then_heartbeat_desc 为展示名升序语义 + 新增两个稳定序用例 + 文件头注释同步；跑本变更触达的相关测试文件全绿
