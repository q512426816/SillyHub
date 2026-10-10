---
author: qinyi
created_at: 2026-10-10 23:40:00
change: 2026-10-10-linked-repos-local-echo
---

# 符号影响分析（Symbol Impact）— 2026-10-10-linked-repos-local-echo

> execute Step 1 产物。本变更整体为**新增式（additive）+ 既有文件追加**：新只读例程/
> 新端点/新 RPC method 平名注册/卡片新区块，不删除、不修改任何既有函数/类/接口签名。

- task-01: 新增式——新文件 linked-repos-snapshot.ts（纯函数 runLinkedReposSnapshot）；
  daemon.ts 在 _registerLinkedReposRpcHandler 内**追加**一个平名注册（既有方法体不动，
  protocol 零改动）。
- task-02: 新增式——linked_repos_sync.py 追加 local_snapshot 编排函数（既有
  build_sync_payload/trigger_sync 等不动）；router/schema 追加端点与模型（既有六端点不动）。
- task-03: 新增式——service.py 追加 import_repos（复用既有 create_repo/upsert_my_path，
  签名零改）；router/schema 追加。
- task-04: 新增式——卡片文件内追加「本机已有配置」区块组件（既有列表/Modal 不动）；
  lib 追加两个函数；api-types/provider-caps/openapi 为再生成产物。

结论：四 task 均无签名级变更；所有追加调用点均在对应任务 allowed_paths 内。
