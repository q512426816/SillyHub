---
author: qinyi
created_at: 2026-10-10 23:15:00
---
# 任务清单（Tasks）— 2026-10-10-linked-repos-local-echo

> 本文件为任务唯一真相。plan 阶段展开任务卡；此处登记骨架与 FR 对应。

- [x] task-01: daemon 只读快照——linked_repos_snapshot RPC（spawn workspace status --json + config cat 解析 repos 段，归一零写盘）+ 测试（FR-01）
- [x] task-02: backend 快照端点与对照——GET local-snapshot（RPC 编排+三态对照+降级）+ 测试（FR-01/FR-02）
- [x] task-03: backend 导入端点——POST import（复用 create_repo/upsert_my_path 逐条幂等）+ 测试（FR-03）
- [x] task-04: 前端本机现状区——三态徽标/刷新/勾选导入/离线占位 + gen:types 再生成（FR-04）
