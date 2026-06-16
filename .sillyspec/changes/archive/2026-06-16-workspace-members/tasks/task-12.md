---
id: task-12
title: git commit + push origin main（发布 gate）
priority: P0
estimated_hours: 0.5
depends_on: [task-11]
blocks: []
allowed_paths: []
---

# Task-12 — git commit + push origin main

## 1. 目标

把整个 `2026-06-16-workspace-members` 变更的产出（后端 schema/service/router/装载/tests + 前端 lib/components/page/layout + sillyspec change 文档）作为一个原子提交推送到 `origin/main`，让远端成为 source of truth，task-11 已验证的 Docker e2e 行为在 CI/部署环境可重现。

依据文档：

- `plan.md` §"Wave 5：集成 + 部署 + 推送" 第 54 行：`task-12: git commit + push origin main`
- `plan.md` §"验收标准"（9 条）— 全部由 task-10/11 落地，task-12 仅做发布
- `CLAUDE.md`（项目硬性规则）：第 9 条 "代码提交如果被 hook 拦截了禁止跳过，需要解决问题再提交"
- `proposal.md` §"成功标准"（8 条）— 由本 commit 落地后生效

## 2. 修改文件

**本任务不直接修改任何代码 / 文档文件**，仅做 git 操作（add / commit / push）。但 commit 的**变更集**会包含 task-01..11 产出的全部文件，分类如下：

| 类别 | 路径（由 task-01..09 创建/修改） | 操作 |
|------|----------------------------------|------|
| SillySpec 文档 | `.sillyspec/changes/2026-06-16-workspace-members/{proposal.md, design.md, requirements.md, plan.md, tasks.md, tasks/task-01..12.md, prototype-members.html}` | 新增（A） |
| 后端 schema | `backend/app/modules/workspace/schema.py` | 修改（M） — 新增 6 个 Pydantic schema |
| 后端 service | `backend/app/modules/workspace/members_service.py` | 新增（A） |
| 后端 router | `backend/app/modules/workspace/members_router.py` | 新增（A） |
| 后端装载 | `backend/app/main.py` 或 `backend/app/modules/workspace/router.py` | 修改（M） — include members_router |
| 后端测试 | `backend/tests/modules/workspace/test_members_router.py` | 新增（A） — ≥15 用例 |
| 前端 lib | `frontend/src/lib/workspace-members.ts` | 新增（A） — 6 个 API client 函数 |
| 前端 components | `frontend/src/components/workspace-member-add-dialog.tsx` | 新增（A） |
| 前端 components | `frontend/src/components/workspace-tabs.tsx` | 新增（A） — task-08 |
| 前端 layout | `frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx` | 新增（A） — task-08 |
| 前端 page（Overview） | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 修改（M） — task-08 微调 |
| 前端 page（Members） | `frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx` | 新增（A） — task-09 |

> 实际变更集以 `git status --porcelain` 输出为准；task-12 不增删任何文件，只把它们打成一个 commit。

## 3. 实现要求

### 3.1 提交前检查（顺序不可交换）

1. **确认工作区干净意图**：执行 `git status --porcelain` 检查所有变更都属于本变更集；若有与本变更无关的杂项改动（如 IDE 配置、临时调试代码），先 `git stash` 或剔除，**禁止**把无关改动一起 commit。
2. **确认 task-10/11 已 PASS**：本任务的 `depends_on: [task-11]` 暗含 backend pytest 全过 + frontend `pnpm lint && pnpm build` 全过 + Docker e2e 通过；若 task-11 未完成，**禁止**执行本任务。
3. **确认 main 分支**：`git branch --show-current` 输出必须是 `main`；当前不在 main 时先 `git checkout main`（本变更不走 feature branch + PR 流程，见 §6 非目标）。

### 3.2 命令序列（接口定义）

```bash
# 1. 暂存所有变更集文件（按路径精确 add，避免 git add -A 误带 .env / 构建产物）
git add backend/app/modules/workspace/schema.py \
        backend/app/modules/workspace/members_service.py \
        backend/app/modules/workspace/members_router.py \
        backend/app/main.py \
        backend/tests/modules/workspace/test_members_router.py \
        frontend/src/lib/workspace-members.ts \
        frontend/src/components/workspace-member-add-dialog.tsx \
        frontend/src/components/workspace-tabs.tsx \
        frontend/src/app/\(dashboard\)/workspaces/\[id\]/layout.tsx \
        frontend/src/app/\(dashboard\)/workspaces/\[id\]/page.tsx \
        frontend/src/app/\(dashboard\)/workspaces/\[id\]/members/page.tsx \
        .sillyspec/changes/2026-06-16-workspace-members/

# 2. 跑 pre-commit hook（ruff-format + ruff-check --fix）
#    若 hook 修改了文件（ruff 重新格式化），需要重新 git add
git commit -m "$(cat <<'EOF'
feat(workspace): add members management API + UI

- backend: 6 endpoints (list/search/add/update/remove/transfer-ownership)
- backend: members_service with role whitelist + last-owner guard
- frontend: Members tab + add dialog + role dropdown
- tests: 15+ pytest cases covering FR-01..06
- closes .sillyspec/changes/2026-06-16-workspace-members
EOF
)"

# 3. 如果第 2 步 hook 报错（ruff 修了文件 / 检查失败）：
#    - 重新 git add 修改过的文件
#    - 重新 git commit（创建 NEW commit，禁止 --amend）
#    重复直到 hook 全过

# 4. 推送
git push origin main

# 5. 如果 push 被拒（! [rejected] main -> main (fetch first)）：
#    远程领先，需要 rebase
git pull --rebase origin main
git push origin main
```

### 3.3 commit message 风格约束

- **type**：`feat`（本变更引入新功能，不是 fix/chore）
- **scope**：`workspace`（与 design.md / proposal.md 一致）
- **subject**：英文，祈使句，≤ 72 字符：`add members management API + UI`
- **body**：bullet list，每条以 `- ` 开头，描述一个面向读者的变化点（不是文件清单）
- **footer**：`- closes .sillyspec/changes/2026-06-16-workspace-members` 引用变更目录
- **签名**：不加 `Co-Authored-By` / `Generated with Claude Code`（参照最近 10 个 commit，**均无** AI 签名；项目惯例是纯作者署名，由 git user `qinyi` 自动提供）

## 4. 接口定义

### 命令序列（输入 → 期望输出）

| 步骤 | 命令 | 期望输出 | 失败处理 |
|------|------|----------|----------|
| S1 | `git status --porcelain` | 列出 ~12 个文件，全部在本变更 §2 路径清单内 | 有无关文件 → stash 或剔除后重试 |
| S2 | `git add <paths>` | 静默成功 | 路径含括号/方括号需转义（bash）或单引号包裹 |
| S3 | `git commit -m "..."` | pre-commit hook 全过 → 输出 `<sha> main: feat(workspace): ...` | hook 失败 → §5 边界 B-1 |
| S4 | `git push origin main` | `To github.com:.../multi-agent-platform.git ... main -> main` | rejected → §5 边界 B-4 |
| S5 | `git log --oneline -1` | `<sha> feat(workspace): add members management API + UI` | — |

### commit 对象结构

```
commit <40-char-sha>
Author: qinyi <qinyi@users.noreply.github.com>  # 取自 git config
Date:   <task-12 执行时间>

    feat(workspace): add members management API + UI

    - backend: 6 endpoints (list/search/add/update/remove/transfer-ownership)
    - backend: members_service with role whitelist + last-owner guard
    - frontend: Members tab + add dialog + role dropdown
    - tests: 15+ pytest cases covering FR-01..06
    - closes .sillyspec/changes/2026-06-16-workspace-members
```

## 5. 边界处理

1. **B-1：pre-commit ruff fix 后必须重新 add**。`.pre-commit-config.yaml` 配置了 `ruff check --fix`（line 16）会自动改文件；ruff 改完文件后 pre-commit 框架会**终止本次 commit**（exit 1，提示 "files were modified by this hook"）。处理：`git add -u`（重新暂存被 ruff 改过的已跟踪文件）+ `git status` 确认无 unstaged 改动 → 重新 `git commit -m "..."`（**创建 NEW commit**，禁止 `--amend`，因为前一次 commit 根本没产生，amend 会改到错误的父 commit）。

2. **B-2：禁止 `--no-verify` 绕过 hook**。CLAUDE.md 硬性规则第 9 条 + Claude Code Git Safety Protocol 明确禁止。即使 hook 修了 10 次文件，也要逐次解决，不能跳过。

3. **B-3：commit message 格式 follow 历史**。最近 10 个 commit 全部是 `<type>(<scope>): <subject>` 格式（feat/fix/chore + agent/settings/daemon/runtimes/auth/workspace 等 scope）。本 commit 必须 follow：`feat(workspace): ...`。**禁止**用 `Update files` / `WIP` / `misc` 等无意义 message。

4. **B-4：push 被拒不可 force**。若远程 main 领先（如队友或另一台机器先推了 commit），`git push` 报 `! [rejected] main -> main (fetch first)`。处理：`git pull --rebase origin main`（把本地新 commit rebase 到远程之上，不产生 merge commit）→ `git push origin main`。**禁止** `git push --force` / `--force-with-lease`（Claude Code Git Safety Protocol + 主分支保护）。

5. **B-5：hook 修复引入新改动时的 commit 策略**。如果 ruff fix 后又手动修了别的问题（如测试 typo），需要把这些改动一并加入。两种选择：
   - **首选**：在 commit **之前** 把所有改动 add 完毕（S1 之前的状态就该是 task-10/11 验收后的最终状态）
   - **次选**：commit 已产生后才发现遗漏 → 创建**新的** follow-up commit（如 `fix(workspace): ruff format + missing test fixture`），**禁止** `git commit --amend` 已 push 的 commit（会重写历史）。

6. **B-6：push 中断 / 网络抖动**。`git push` 中断后，先 `git status` 看本地与远程是否同步（`git log origin/main..main` 应为空或仅本 commit）。若远程实际已收到但本地以为失败，`git fetch origin` 后再判断，避免重复 push 或误 rebase。

7. **B-7：commit 中混入 `.env` / `node_modules` / `__pycache__`**。S1 必须人工核对 `git status --porcelain` 输出，发现以下任何文件立即剔除（`git restore --staged <file>` + 从工作区删除或加 `.gitignore`）：
   - `.env` / `.env.local` / `*.key` / `credentials.json`
   - `frontend/node_modules/**`
   - `backend/.venv/**` / `**/__pycache__/**` / `**/*.pyc`
   - `frontend/.next/**`（Next.js 构建产物）

## 6. 非目标

- **不创建 PR**：本变更直接 commit 到 main + push（项目惯例，见最近 10 个 commit 全部直推 main，无 PR 痕迹）。若未来引入 GitHub Flow / protected branch + PR 流程，本任务范围外。
- **不改 main 分支保护规则**：不动 GitHub repo settings 的 branch protection；不动 `.github/`；不动 CODEOWNERS。
- **不打 tag**：不创建 `v*` / `release-*` tag；本变更不是 release。
- **不动 CHANGELOG / VERSION 文件**：项目当前无 CHANGELOG.md / VERSION 文件，本任务不引入。
- **不触发 CI 改造**：不动 `.github/workflows/`；若 push 后 CI 跑了现有 workflow 并失败，那是另一个 fix 范围，不在 task-12。
- **不 amend 历史 commit**：即使发现 task-01..09 的早期 commit 有 typo，也不 rebase 改写历史；统一在本 commit 中体现最终状态。
- **不重写远端**：禁止 `git push --force` / `--force-with-lease` / `git push --no-verify`。

## 7. 参考

### 最近 5 个 commit message 风格（git log --format="%s" -5）

```
fix(agent): execution-context ownership by membership, not created_by
feat(settings): password reset returns auto-generated plaintext password
chore: add SillySpec change docs, CLAUDE.md, and frontend spec config
feat(settings): user management v2 — session revoke, workspace query, drawer enhancement
fix(daemon): --api-key CLI option now reaches the wire
```

**风格归纳**：

- `<type>(<scope>): <subject>` — Conventional Commits
- type ∈ {feat, fix, chore, docs, refactor}
- scope ∈ {agent, settings, daemon, runtimes, auth, workspace, sillyspec, ...}（小写、单数）
- subject 英文、祈使句、≤ 72 字符、首字母小写、不加句号
- 复杂变更用 `—`（em dash）+ 简述子项（如 `user management v2 — session revoke, workspace query, drawer enhancement`）

### pre-commit 配置

- `backend/.pre-commit-config.yaml`（line 1-19）：
  - `ruff-format`：`uv run ruff format`，作用于 .py 文件
  - `ruff-check`：`uv run ruff check --fix`，作用于 .py 文件
- **无 mypy hook**（项目未配置）、**无 eslint hook**（pre-commit 仅管 Python；frontend lint 由 task-10 的 `pnpm lint` 在 commit 前手动跑）

### git remote / 分支

- `git remote -v` 输出 `origin` 指向 `multi-agent-platform` 仓库
- 当前分支 `main`，与 `origin/main` 在 task-12 之前应为 up-to-date（除非队友有新提交，见 B-4）

### 项目硬性规则（CLAUDE.md）

- 第 6 条："实现完成后，对照文档验收" — task-12 之前的 task-10/11 已对照 plan.md 9 条验收标准 + proposal.md 8 条成功标准完成
- 第 9 条："代码提交如果被 hook 拦截了禁止跳过，需要解决问题再提交" — 见 B-1 / B-2

## 8. TDD 步骤

**N/A** — 本任务是发布 gate，不写自动化测试。验证手段见 §9 验收标准（全部是 git 命令的输出断言，可手动复核）。

## 9. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | pre-commit hook 全过 | `git commit` 命令成功创建 commit（无 hook 失败 / 无 "files were modified by this hook" 提示）；最终 `git log -1 --format="%s"` 显示 `feat(workspace): add members management API + UI` |
| AC-2 | commit 含完整变更集 | `git show --stat HEAD` 列出的文件覆盖 schema / service / router / 装载 / tests / lib / components / page / layout / sillyspec change 文档（≥ 12 个文件，分类见 §2）；无 `.env` / `node_modules` / `.next` / `__pycache__` 等垃圾文件 |
| AC-3 | push 成功 | `git push origin main` 输出 `<old_sha>..<new_sha>  main -> main`；`git rev-parse HEAD` 与 `git rev-parse origin/main` 输出一致（本地与远程同步） |
| AC-4 | git log 显示新 commit | `git log --oneline -3` 第一行为本 commit；GitHub 远端仓库 main 分支头部 commit 与本地一致（可在浏览器刷新 GitHub repo 页面确认） |
| AC-5 | commit message 格式合规 | subject = `feat(workspace): add members management API + UI`（≤ 72 字符，type/scope/subject 三段齐全）；body 含 5 行 bullet list（4 个改动点 + 1 个 closes 行）；无 AI 签名（无 `Co-Authored-By` / `Generated with`） |
| AC-6 | 工作区最终干净 | task-12 完成后 `git status` 输出 `nothing to commit, working tree clean`；无残留 staged / unstaged 改动 |

## 10. 风险与回滚

- **风险 R-1**：pre-commit 反复失败（ruff 修了又修）。**缓解**：在 commit 前先手动跑一次 `cd backend && uv run ruff format && uv run ruff check --fix`，提前把所有 Python 文件格式化到位；frontend 跑 `cd frontend && pnpm lint --fix`。这样 commit 时 hook 一次通过。
- **风险 R-2**：commit 后才发现漏了某个文件（如 `members/page.tsx`）。**缓解**：在 S1 `git status --porcelain` 时逐文件核对 §2 清单；若 commit 已 push，创建 follow-up commit 而非 amend（见 B-5）。
- **风险 R-3**：push 时远程有队友的新 commit（rebase 冲突）。**缓解**：`git pull --rebase origin main`；若产生冲突，**停止** task-12，回到 task-11 状态评估冲突（可能需要回到 task-09/10 修复）；**禁止** `git rebase --abort` 后 force push 覆盖队友提交。
- **风险 R-4**：commit message 写错 scope（如写成 `feat(members): ...`）。**缓解**：scope 必须是 `workspace`（与 design.md / proposal.md 模块归属一致）；若已 push，接受现状或创建一个 `chore: rename scope` 的空 commit 修正（不推荐 amend 历史）。
- **回滚**（极端情况：push 后发现严重 bug 需要撤回）：
  1. **首选**：`git revert <sha>` 创建一个反向 commit（保留历史，安全）
  2. **次选**（仅当 main 未被其他人拉取时）：`git reset --hard HEAD~1` + `git push --force-with-lease origin main` — **需要用户明确授权**，task-12 自身不执行
  3. 本任务的回滚成本 = 1 个 revert commit + 1 个 fix commit + 1 个 re-push commit，约 0.5h
