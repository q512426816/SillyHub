---
author: flow-machine-draft
created_at: 2026-09-26T00:02:17.793Z
---
# 任务注册表（Tasks）— 2026-09-26-spec-consistency-writer

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: 新端点 GET /workspaces/{id}/spec-workspace/consistency：对账镜像磁盘树（spec_root rglob）与 Sp…
- [x] task-02: 返回结构化 DTO
- [x] task-03: spec-workspace 读模型（GET /spec-workspace）增 last_writer 字段：每次 apply_sync/apply_ops…
- [x] task-04: 写方切换（不同 principal 连续写入）记 structlog warning（双写者漂移信号）
- [x] task-05: 单测：四类分歧各一用例（构造镜像
- [x] task-06: 清单错位）+ last_writer 记录与切换告警
- [x] task-07: gen:types 契约同步
- [x] task-08: 既有 spec_workspace 测试零回归
