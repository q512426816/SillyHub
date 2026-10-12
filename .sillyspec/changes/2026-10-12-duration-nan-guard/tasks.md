---
author: flow-machine-draft
created_at: 2026-10-12T01:40:38.182Z
---
# 任务注册表（Tasks）— 2026-10-12-duration-nan-guard

- [x] task-01: duration_api_ms 差分入口改 Number.isFinite 门控（对齐同函数 total_cost_usd 既有口径），非有限值不进基线读写、payload 不携带该键（或保持 undefined 语义与既有「SDK 未报」路径一致），零新日志面
- [x] task-02: 新增用例先红后绿：duration_api_ms=NaN 时 payload 不含 duration_api_ms 键且基线 Map 不被污染（后续合法值差分仍正确）；既有 duration 差分用例全绿
- [x] task-03: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-interactive-bridge.test.ts 全文件
