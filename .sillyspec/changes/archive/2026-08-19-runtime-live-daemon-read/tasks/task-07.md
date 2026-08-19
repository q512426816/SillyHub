---
schema_version: 1
doc_type: task
id: task-07
title: Remove old snapshot read path
title_zh: 删除原快照读取路径
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 7
allowed_paths:
  - backend/app/modules/runtime/service.py
goal: 移除容器 spec_root 直读逻辑
implementation: 删除 RuntimeService 中访问 spec_ws.spec_root / sillyspec.db / .runtime/ 的代码；保留 DTO schema 定义
acceptance: runtime 模块不再 import SpecPathResolver 或读取平台容器路径
verify: 静态检查确认无残留快照读取代码；测试不再写本地 db 文件
constraints: 不删除 schema.py 中 DTO 定义
---

# task-07：删除原快照读取路径
