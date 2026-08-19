---
schema_version: 1
doc_type: task
id: task-02
title: Implement ProgressManager.dump
title_zh: 实现 ProgressManager.dump 只读查询
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 2
allowed_paths:
  - sillyspec/src/progress.js
goal: 从 sillyspec.db 读取进度数据并返回统一结构
implementation: 在 ProgressManager 新增 dump(specDir) 方法：resolveSpecDir → 打开 sqlite 只读连接 → 读 changes/stages/steps/project 表 → 组装数据结构
acceptance: 有数据返回项目/阶段/步骤；无数据返回 null；不修改任何表
verify: sillyspec 仓单元测试覆盖空库、单 change、多 stage
constraints: 只读；不写 db；不触发任何 stage/complete 逻辑
---

# task-02：实现 ProgressManager.dump 只读查询
