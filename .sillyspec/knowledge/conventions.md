---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 项目约定 (Conventions)

## SillySpec 文档驱动开发流程

本项目使用 SillySpec 文档驱动开发（见 `.claude/CLAUDE.md` 硬性规则）：

- **执行顺序：文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收**
- 禁止无文档改代码、禁止先写代码再补文档
- 新功能/大改动走完整流程：`sillyspec run brainstorm` → plan → execute → verify
- 小修复/小调整：`sillyspec run quick`
- 修改代码前必须说明依据的文档路径；实现完成后对照文档验收
- 本项目未正式上线，数据可清空，不考虑版本迭代兼容
- 提交被 hook 拦截时禁止跳过，必须解决问题再提交

## 子项目构建 / 测试 / lint 命令

monorepo 根无统一命令，必须 cd 到对应子项目：

| 子项目 | 技术栈 | test | lint |
|---|---|---|---|
| backend | FastAPI + uv | `cd backend && uv run pytest` | `cd backend && uv run ruff check .` |
| frontend | Next.js + pnpm | `cd frontend && pnpm test` | `cd frontend && pnpm lint` |
| sillyhub-daemon | Node + pnpm (ESM) | `cd sillyhub-daemon && pnpm test` | `cd sillyhub-daemon && pnpm lint` |

frontend/daemon 构建用 `pnpm build`；backend（Python）无独立 build 步骤。

## 目录约定

- `backend/` — FastAPI 后端（app/core 基础设施 + app/modules/<domain> 业务模块）
- `frontend/` — Next.js 14 前端（src/app App Router）
- `sillyhub-daemon/` — Node.js 本地守护进程（src/，ESM）
- `deploy/` — Docker Compose 部署配置
- `docs/` — 项目级设计文档
- `.sillyspec/` — SillySpec 规范、扫描文档、变更、知识库

## 提交规范

commit message 用类型前缀 + 中文描述，例：`fix(agent-run): 修复调度 scan 链路`、`feat(frontend): 新增 SSE hook`。常见前缀：feat / fix / docs / refactor / test / chore。
