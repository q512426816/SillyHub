---
id: task-04
title: generate_projects 一级粒度 + 去 await reparse + 去 relations 生成 + 删 reparse 方法
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@V1, D-003@V1]
allowed_paths:
  - backend/app/modules/workspace/service.py
goal: >
  重构 generate_projects：只按一级目录分组生成 5 个一级子项目 yaml（D-002）；末尾去掉 `await self.reparse()`；删除 relations 生成段；删除 reparse 方法本身（D-003）。
implementation:
  - 改 `service.py:648-654` 分组逻辑：从"`prefix = key.split('-")[0]` 按 module key 首段分组"改为"按 `_module-map.yaml` 的 module path 顶级目录（backend/frontend/daemon/sillyhub-daemon/ppm）分组"
  - 模块级（如 `backend/app/modules/auth`）归入对应一级组件，不单独成组件
  - 删除 relations 生成段：`service.py:689-699` 的 all_relations 收集 + `:716-725` 的 dedup + 写入 `project_def["relations"]`（G-05 补丁）
  - 末尾去掉 `await self.reparse()`，generate_projects 只产 yaml
  - 删除 `reparse` 方法（`service.py:748-971`）及 `_build_child_root_path` 等仅供 reparse 用的辅助方法
acceptance:
  - 对 SillyHub 重跑 generate_projects 后 `projects/*.yaml` 只剩 5 个一级子项目
  - 生成的 yaml 不再含 relations 段
  - `grep reparse backend/app/modules/workspace/service.py` 无命中（方法已删）
  - generate_projects 不再写 workspaces 表 component 行
verify:
  - cd backend && python -m pytest tests/modules/workspace/test_generate_projects.py -q
constraints:
  - 改动前先核对 task-01 的 generate_projects/reparse 调用方登记，逐一确认改后行为
  - 不动 `_module-map.yaml` 的 schema，只改分组依据
  - reparse 辅助方法仅当确认无其他调用方才删（依赖 task-01 清单）
---

