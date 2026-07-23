---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 让 server-local 模式容器自带 sillyspec skills 并对齐 stage 投递 prompt+env
implementation: 修改 backend Dockerfile 加 COPY .claude/skills/ /app/.claude/skills/（sillyspec skills 进镜像）；server-local stage 投递路径对齐 task-01/02 的 prompt+env 双通道（skill 调用指令 + STAGE_META env，不写 CLAUDE.md）；server-local 不走 daemon skill 同步（容器自带）
acceptance: server-local 容器内 /app/.claude/skills/ 含 sillyspec-* skills；server-local stage 投递同样用 skill 指令 prompt + STAGE_META env；server-local claude 能调 sillyspec skills
verify: docker build backend 镜像 + 容器内检查 /app/.claude/skills/ 含 sillyspec-*（或 CI build 单测）；backend uv run pytest -q server-local stage 相关测试零回归
constraints: 兼容 server-local（容器模式，不走 daemon skill 同步，靠镜像自带）；不破坏既有 server-local stage 流程；stage_meta 对齐 task-01 的 StageDispatchMeta（同字段）
depends_on: [task-01]
covers: [FR-06]
---

# task-07: server-local skills（容器 COPY + stage 对齐）

## 验收标准

A. backend Dockerfile 新增 COPY .claude/skills/ /app/.claude/skills/，docker build 后容器内 /app/.claude/skills/ 含 sillyspec-verify 等核心 skill 文件（构建产物可验证）。
B. server-local 模式 stage 投递与 daemon-client 一致使用 skill 调用指令 prompt + STAGE_META env（task-01 的 StageDispatchMeta 字段），不再写 CLAUDE.md；server-local claude 在容器内能调 sillyspec skills（容器自带，不经 daemon skill-manager 同步）。
C. backend `uv run pytest -q` 全绿，server-local 既有 stage 投递相关测试零回归（CLAUDE.md 不被覆盖、stage_meta 传递对齐 daemon-client 路径）。
