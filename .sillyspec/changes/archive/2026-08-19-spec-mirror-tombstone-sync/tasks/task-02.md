---
id: task-02
title: manifest 逐行对齐（墓碑替代全表 wipe）
title_zh: SpecFileManifest 逐行对账对齐
author: qinyi
created_at: 2026-08-19T22:40:00
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: []
provides:
  - contract: manifest 逐行对齐（landed → upsert version+1/exists=True；converged → exists=False 墓碑）
    fields: [rel_path, content_hash, version, exists]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
goal: >
  删除 service.py 922-930 的全表 DELETE SpecFileManifest 块，改为逐行对齐：
  tar 命中文件 upsert（version+1/exists=True），对账删除文件置 exists=False 墓碑
implementation:
  - merge 循环把 (rel_path → ch) 存入 dict 供对齐复用
  - IN 预取该 workspace 全部 manifest 行
  - landed_paths：有行更新 hash/version+1/exists=True；无行插 version=1
  - converged_rel_paths（task-01 返回）：有行 exists=False+version+1；无行不动
  - 单 commit；加注释说明沿用原 wipe 位置（最终 commit 后独立短事务）语义等价
acceptance:
  - 无全表 DELETE
  - 被删文件行 exists=False；命中文件 version 递增
constraints: >
  对齐 design Non-Goals：不动 apply_ops / daemon / CLI / 前端 / api-types；不做后台任务、UI 入口、migration。
verify:
  - pytest 用例：manifest 无全表 DELETE（对齐前后行数断言）

---
