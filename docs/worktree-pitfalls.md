---
author: qinyi
created_at: 2026-07-05 11:30:00
tags: [worktree, execute, 环境坑]
---

# worktree execute 阶段环境坑（项目 worktree 使用手册）

> 本文档是 multi-agent-platform 项目用 worktree 隔离时的环境坑备忘，**非 sillyspec 工具 gap**（已从 `docs/sillyspec/` 迁出）。4 个坑里坑 3 已被 sillyspec 自动解决，坑 1 sillyspec 可改进（baseline commit 加 `--no-verify`，未登记到 sillyspec gap 清单），坑 2/4 是 git worktree 固有 + 项目特定产物（sillyspec 管不了）。后续 execute 若再遇可参照。

execute 阶段 worktree（平台模式）遇到的 4 个环境问题，与具体变更无关，是 worktree 隔离机制的通用副作用。

| 坑 | sillyspec 处置 |
|---|---|
| 1. baseline checkpoint 被 pre-commit ruff 拦截 | 未处置（baseline commit 未加 `--no-verify`） |
| 2. 缺 .env | 管不了（git worktree 固有） |
| 3. 缺 node_modules | **已自动处理** ✅（`provisionDeps` junction/symlink + install 兜底） |
| 4. 缺 build-id.ts | 管不了（项目特定构建产物） |

## 1. baseline checkpoint 被 pre-commit ruff 拦截

**现象**：`sillyspec run execute` 创建 worktree 时报 `baseline checkpoint 创建失败: Command failed: git commit -m "sillyspec: baseline checkpoint for ..."`，pre-commit hook `ruff-format` / `ruff-check` 改了文件（如 `3 files reformatted`），commit 中断。

**根因**：主仓库工作区有遗留的 untracked Python 文件（如 `backend/tests/modules/workspace/test_member_runtimes.py` 等 daemon-entity-binding / daemon-version-management 遗留测试债），ruff 不合规。baseline checkpoint 流程 `git add --all && git commit` 触发 pre-commit ruff，ruff 改这些文件，commit 失败。

**修复**：执行 execute 前，先在主仓库 `cd backend && ruff format . && ruff check --fix .` 把遗留文件修合规，再重试 execute。或清理 worktree 残留（`rm -rf .sillyspec/.runtime/worktrees/<change>` + `git worktree prune` + `git branch -D sillyspec/<change>`）后重试。

**注意**：命令行 `ruff format .` 与 pre-commit hook 的 ruff 版本/规则需一致（本仓 `backend/.pre-commit-config.yaml`）。若命令行 ruff 改完仍失败，确认版本一致。

## 2. worktree 缺 .env 导致 alembic 跑不通

**现象**：worktree 内 `cd backend && uv run alembic upgrade head` 报 pydantic `Field required [type=missing]`，栈追到 `app/core/config.py:get_settings() -> Settings()`。

**根因**：worktree 从 git HEAD 创建，`.env` 被 gitignore 不在 git，worktree 没有。`migrations/env.py` 调 `get_settings()` 实例化 `Settings`，必填字段缺失。

**修复**：从主仓库 `cp backend/.env <worktree>/backend/.env`，或用环境变量。pytest 不受影响（用 test 配置）。

**建议**：迁移验证留到 verify 阶段在主仓库/PG 跑，worktree 内不强制跑 alembic upgrade。

## 3. worktree 缺 node_modules（sillyhub-daemon / frontend）

> ✅ **sillyspec 已自动处理**：`provisionDeps`（`worktree-deps.js`）在创建 worktree 时会自动把主仓库 `node_modules` 用 junction/symlink 链过来（lockfile hash 一致走快路径），失败回退 install。子代理**无需**手动 mklink。下面的手动步骤仅作 sillyspec 不可用 / link 失败时的 fallback 参考。

**现象**：worktree 内 `npx vitest` / `pnpm test` 报 `'vitest' 不是内部或外部命令` 或 `ERR_MODULE_NOT_FOUND`。

**根因**：worktree 从 git HEAD 创建，`node_modules/` 被 gitignore 不在 git。

**修复**：用 Windows junction 借主仓库 node_modules（不复制，省空间省时间）：
```bash
# git bash（注意 // 转义 + 引号防止 \U 等转义）
cmd //c 'mklink /J "<worktree>/sillyhub-daemon/node_modules" "C:\Users\qinyi\IdeaProjects\multi-agent-platform\sillyhub-daemon\node_modules"'
# 跑完测试清理（仅删 junction，不删主仓库）
cmd //c 'rmdir "<worktree>/sillyhub-daemon/node_modules"'
```
注意路径要引号包裹，否则 `C:\Users\...` 的 `\U` 在某些 shell 转义会触发"无效参数 - Users"。

## 4. worktree sillyhub-daemon/src 缺 build-id.ts（gitignored 构建生成）

**现象**：worktree 内跑 daemon vitest 全套时，`hub-client.ts:26` 导入 `./build-id.ts` 找不到，测试套件全 fail to load。

**根因**：`sillyhub-daemon/src/build-id.ts` 是 `scripts/build-bundle.sh` 构建时注入的生成文件，被 gitignore，fresh worktree 没有。

**修复**：从主仓库 `cp sillyhub-daemon/src/build-id.ts <worktree>/sillyhub-daemon/src/build-id.ts`，跑完测试 `rm` 删除（git status 不残留）。

## 通用建议

- worktree 隔离对 gitignored 文件（.env / node_modules / 构建产物）天然不友好，子代理跑测试前需准备这些。
- 全量测试尽量留到 verify 阶段在主仓库跑（worktree apply 后），worktree 内只跑相关模块单测。
- 子代理跑测试前在 prompt 里明确 junction/cp 的清理步骤，避免 worktree git status 残留。
