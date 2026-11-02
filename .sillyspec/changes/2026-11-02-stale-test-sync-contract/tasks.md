---
author: flow-machine-draft
created_at: 2026-11-02T01:26:08.615Z
---
# 任务注册表（Tasks）— 2026-11-02-stale-test-sync-contract

- [x] task-01: 7 个 placeholder 主题用例改用日期前缀键（形如 2026-10-27-xxx，符合新契约合法名）后，占位行创建/change link/跨区 D-004/降级语义等原断言全部恢复且通过——测试验证的仍是占位与绑定行为本身，非快照现状
- [x] task-02: 2 个 messages 用例按新 schema 把 bg_task_final 纳入精确断言（item dict 增 bg_task_final: None / openapi properties 集合增 bg_task_final）后通过
- [ ] task-03: tagging 回滚用例 monkeypatch 缝换为 resolve_session_provider_config 后恢复 DID raise 语义并通过（回滚断言原样保留）
- [ ] task-04: 触及的四个测试文件全量绿；platform_sync + daemon 注入相邻面零回归（CLI 亲测）
