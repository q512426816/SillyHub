---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 在 backend 新增 skills bundle 打包与分发端点（manifest + tar.gz）供 daemon 拉取同步
implementation: 新增 backend 端点 GET /api/daemon/skills/latest/manifest 返回 manifest.json（版本=git sha + 文件列表 + 各文件 sha256）和 GET /api/daemon/skills/latest/bundle 返回 sillyspec-skills-<sha>.tar.gz；打包脚本把 .claude/skills/sillyspec-* 目录打为 tar.gz + 生成 manifest；仿 daemon install bundle 分发
acceptance: 两个端点 200 返回正确 manifest（含版本+sha256）和 tar.gz bundle；tar.gz 解压后含 sillyspec-* skills；manifest 的 sha256 与 bundle 内容一致
verify: uv run pytest backend/tests/...（skills bundle 端点单测：manifest 字段 + bundle 解压 + sha256 校验）
constraints: bundle 格式对齐 D-008（tar.gz + manifest.json 含版本+sha256）+ task-03 消费契约（manifest 字段名/版本字段一致）；端点路径 /api/daemon/skills/latest/* 仿 daemon install；不引新打包依赖（用 stdlib tarfile/hashlib 或既有工具）
depends_on: []
covers: [FR-03, D-002@V1, D-008@V1]
---

# task-06: backend skills bundle 打包分发端点

## 验收标准

A. backend 新增 GET /api/daemon/skills/latest/manifest 返回 manifest.json（含版本字段=git sha、文件列表、每个文件 sha256），GET /api/daemon/skills/latest/bundle 返回 tar.gz（含 .claude/skills/sillyspec-* 全部 skills）。
B. bundle 内文件 sha256 与 manifest 中记录一致；解压后含 sillyspec-verify/execute/brainstorm 等核心 skill 文件；版本字段在 skills 未变更时稳定、变更后变化。
C. backend `uv run pytest -q` 全绿，新增端点单测覆盖"manifest 字段完整""bundle 解压内容""sha256 校验一致"三条，且不影响既有 /api/daemon/* 端点（零回归）。
