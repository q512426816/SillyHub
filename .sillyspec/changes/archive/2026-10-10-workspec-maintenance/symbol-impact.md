---
author: qinyi
created_at: 2026-10-10 19:30:00
change: 2026-10-10-workspec-maintenance
---

# 符号影响分析（Symbol Impact）— 2026-10-10-workspec-maintenance

> execute Step 1 产物。本变更整体为**新增式（additive）**：新表/新端点/新 RPC method 字符串值/
> 新组件 import，不删除、不修改任何既有函数/类/接口签名。逐 task 结论如下（调用点搜索：
> rg 验证 include/挂载/handler 注册形态）。

- task-01: 新增式——三个新 SQLModel 表类（WorkspaceLinkedRepo/Path/SyncState）+ 新迁移文件；
  不触既有模型签名；调用点=task-02/03 的 service（均在各自 allowed_paths）。
- task-02: 新增式——新建 schema/service/router 三文件；既有文件仅 backend/app/main.py 追加
  import + include_router 两行（sibling 挂载，仿 members_router 先例 backend/app/main.py:867
  附近；rg 实测 main.py 现有 include_router 52 处，追加不破坏）；无 class 构造/接口/DTO 签名变更。
- task-03: 新增式——新文件 linked_repos_sync.py（RPC 编排）；backend/app/modules/daemon/
  router/machines.py 追加一个端点函数（router 已经 daemon/router/__init__.py:310 挂载，不改挂载）；
  workspace linked_repos router.py/service.py 为 task-02 新建文件的追加（sync 端点 + summary 填充）；
  RPC method 为新字符串值 `linked_repos_sync`（protocol 消息层 method 字段，非类型签名变更）。
- task-04: 新增式——sillyhub-daemon/src/protocol.ts 加 RPC method 类型值（union/常量追加）；
  daemon.ts 追加 handler 注册（既有分发 switch/map 的一个新分支）；无既有函数签名变更。
- task-05: 新增式——新组件/新 lib；既有文件仅 frontend/src/app/(dashboard)/workspaces/[id]/
  page.tsx 追加 import + 卡片挂载一行；无组件 props 接口变更。
- task-06: 再生成产物（api-types.ts/openapi.json/provider-caps.ts）+ lib/linked-repos.ts 内部
  类型替换为生成类型引用（文件内 private interface，无外部消费者）。

结论：六 task 均无签名级变更（无 class 构造参数/接口/DTO/API client 签名的增删改）；
所有追加式调用点（main.py include、daemon handler 注册、page.tsx 挂载）均已列于对应 task
的 allowed_paths 内，无范围外调用点。
