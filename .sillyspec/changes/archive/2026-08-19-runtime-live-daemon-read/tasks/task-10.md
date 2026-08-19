---
schema_version: 1
doc_type: task
id: task-10
title: Create daemon runtime handler
title_zh: 新建 daemon runtime handler
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 10
allowed_paths:
  - sillyhub-daemon/src/runtime-handler.ts
  - sillyhub-daemon/src/spec-sync.ts
goal: 实现 daemon 侧 runtime 数据读取业务层
implementation: 新建 RuntimeHandler 类；根据 workspace_id 推导 specCacheRoot（与 spec-sync 缓存目录一致）；提供 4 个方法
acceptance: 能正确定位 ~/.sillyhub/daemon/specs/<workspace_id>/
verify: 单元测试覆盖 workspace_id → specCacheRoot 映射
constraints: 路径推导复用已有逻辑，不新建配置项
---

# task-10：新建 daemon runtime handler
