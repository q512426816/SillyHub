---
author: flow-machine-draft
created_at: 2026-09-25T23:10:15.907Z
---
# 任务注册表（Tasks）— 2026-09-26-manifest-heal-endpoint

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: 新端点 POST /workspaces/{id}/spec-workspace/manifest-heal：body 传 paths（显式文件清单）…
- [x] task-02: 只接受显式 paths 清单（不做前缀批量——防误清整目录墓碑，单文件粒度即人工拍板单位）
- [x] task-03: 路径不在该工作区 manifest 中 → 404 语义错误
- [x] task-04: 非墓碑行跳过并计入 skipped
- [x] task-05: 鉴权 WORKSPACE_WRITE
- [x] task-06: heal 后同步关闭该工作区开放的 spec-sync 冲突行（复用 _close_open_sync_conflicts——冲突闭环本来就是全绿语义…
- [x] task-07: 服务端 structlog 记审计事件（workspace_id/paths 数/操作者身份进 audit log 若既有钩子可用…
- [x] task-08: 单测：墓碑行 heal（platform_deleted→False、exists→True、version 不变、非墓碑 skipped、404）+ heal…
- [x] task-09: 既有 spec_workspace 测试零回归
