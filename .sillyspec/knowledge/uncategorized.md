# 未分类知识

> execute/quick 执行中发现的坑暂存于此，用户审阅后归类到对应文件并更新 INDEX.md。

## 2026-06-03 — Claude Code PreToolUse hook 拦截 git commit

- `.claude/settings.json` 是 Claude Code hook 配置，只会拦截 Claude Code 自己发起的工具调用；普通终端或 IDE 里的 `git commit` 仍然只走 Git hooks。
- Windows 下用 `bash .claude/hooks/*.sh` 容易命中 WSL bash，并且 CRLF shell 脚本会触发 `$'\r': command not found` / `pipefail\r` 错误；跨平台 hook 优先用 `node .claude/hooks/*.cjs`。
- Claude Code `PreToolUse` 推荐用 `hookSpecificOutput.permissionDecision="deny"` 和 `permissionDecisionReason` 阻断工具调用；`continue:false` 是停止后续处理，不等同于 deny 当前 Bash 工具调用。

## 2026-06-03 — pytest patch 函数内局部导入的目标

- 被测函数内部用 `from app.core.db import get_session_factory`（函数级局部导入）时，`patch("app.modules.agent.service.get_session_factory")` 会报 `AttributeError: module does not have the attribute`，因为该名字从未绑定到 service 模块命名空间。
- 正确做法：patch 源头模块属性 `app.core.db.get_session_factory`。局部导入每次执行时从源模块取属性，patch 源头才能拦截。
- 同理适用于任何「函数内 import」的 mock。模块级 import 才 patch 使用方模块。

## 2026-06-03 — 无本地 venv 时在 Docker 后端容器跑 pytest

- 本机只有 Windows Store 的 python stub（exit 49 不执行），项目走 Docker 部署无 venv。
- 主机 F 盘挂载在后端容器 `/host-projects`，git worktree 可经 `/host-projects/WorkNew/SillyHub/.sillyspec/.runtime/worktrees/<change>` 访问。
- 生产镜像 venv 缺 pytest，但 `pip install pytest` 装到 `~/.local`(user-site)，venv python 默认不加载；运行时 `sys.path.insert(0, site.getusersitepackages())` 后 `pytest.main()` 即可。
- 用 `PYTHONPATH=<worktree>/backend` 让测试 import 命中 worktree 改动代码，不污染容器 /app（镜像层）。
- 验证回归：在 `/host-projects/.../backend`(main) 上跑同样测试对比，区分预存失败与本次引入的回归。

## 2026-06-03 — execute 的 worktree 基线不含未提交改动

- `sillyspec worktree create` 从最新 commit（HEAD）干净 checkout，**不包含主工作区里 staged/未提交的改动**。如果上一个变更（如 quick 流程）的代码改动只 `git add` 未 commit，worktree 里看到的是改动前的旧版文件。
- 后果：execute 子代理在 worktree 内基于过时基线实现，可能写出与已存在（但未提交）改动冲突、甚至撤销前序成果的代码。本次 task-04 子代理就因 worktree 内 page.tsx 缺少上一轮 quick 加的 verify_result/module_impact/DOC_LABELS，用了错误的 OPTIONAL_DOCS 列表。
- 规避：execute 前确认相关前序改动已 commit；或像本次一样，发现基线不符时在**主工作区**（正确基线）重做改动、worktree 仅作隔离参考。审查子代理产出时务必对比主工作区当前真实文件，不要盲信子代理"按蓝图实现"的报告。

## 2026-06-05 — sync_stage_status 找不到 change_key 的 dual-db 问题

- SpecWorkspace（platform-managed）和 workspace root_path 各有独立的 `.sillyspec/.runtime/sillyspec.db`。
- `_resolve_db_path` 优先用 SpecWorkspace.spec_root，但 Agent worktree 里的 SillySpec CLI 写入的是 workspace root_path 下的 sillyspec.db。
- `sync_stage_status` 在 spec_root 的 db 里找不到 change_key → `synced=False` → `auto_dispatch_next_step` 不触发 → `complete_stage` 不执行 → `human_gate` 永远是 `none`。
- 修复：`_resolve_db_path` 增加 fallback，change_key 不在首选 db 时自动切换到 root_path db。

## 2026-06-05 — auto_dispatch_next_step 只在 has_pending_step 时触发

- `agent/service.py` 原逻辑：`if sync_result.synced and sync_result.has_pending_step` 才调用 `auto_dispatch_next_step`。
- brainstorm 完成时所有 steps completed → `has_pending_step=False` → 不调用 → `complete_stage` 永远不执行。
- 修复：条件改为 `sync_result.synced and (sync_result.has_pending_step or sync_result.stage_completed)`。

## 2026-06-05 — complete_stage 不调用 reparse 导致文档不全

- Agent 生成文件后写入磁盘，但 `complete_stage` 只更新 DB 状态（current_stage, human_gate），不同步 `change_documents` 表。
- 前端看到的文档列表来自 DB，磁盘上的新文件（design.md, requirements.md, tasks.md）不会出现。
- 修复：`auto_dispatch_next_step` 在调用 `complete_stage` 前先 `reparse` 同步文档。

## 2026-06-14 — sillyspec DB 清理：SQLite PRAGMA foreign_keys 默认关闭致 CASCADE 失效

- `.sillyspec/.runtime/sillyspec.db` 的 stages/steps 表虽声明 `REFERENCES changes(id) ON DELETE CASCADE`，但 SQLite 默认 `PRAGMA foreign_keys=OFF`，`DELETE FROM changes` **不会**级联删 stages/steps，残留孤儿行。
- 清理孤儿变更记录（如无日期前缀的 `unified-agent-execution`）时，必须手动按外键依赖顺序：先 `DELETE FROM steps WHERE stage_id IN (SELECT id FROM stages WHERE change_id=X)`，再 `DELETE FROM stages WHERE change_id=X`，最后 `DELETE FROM changes WHERE id=X AND name='...'`（双条件防 id 复用误删）。
- 验证：`SELECT COUNT(*) FROM stages WHERE change_id=X` 应为 0，`SELECT COUNT(*) FROM steps WHERE stage_id IN (SELECT id FROM stages WHERE change_id=X)` 应为 0。

## 2026-06-14 — plan/execute 子代理可能把 CWD 设到变更目录，产生嵌套 .sillyspec 副作用

- 现象：`.sillyspec/changes/<change>/.sillyspec/.runtime/sillyspec.db` 出现二级 runtime（含独立 db/wal/shm/artifacts/user-inputs.md），与根目录 `.sillyspec/.runtime/` 重复。
- 成因：plan/execute 某些步骤的子代理或命令把工作目录设到了变更目录内，sillyspec 在那里又初始化了一个 .runtime。
- 影响：归档时会带入垃圾；两个 sillyspec.db 容易混淆哪个是活跃的。
- 排查：对比两个 db 的最后修改时间（`stat -f "%Sm %N"`），最新修改的是活跃 DB；plan 阶段时间戳的是死 DB。
- 处理：`rm -rf .sillyspec/changes/<change>/.sillyspec`（确认非活跃后）；知识库审阅阶段务必检查变更目录是否干净。

## 2026-06-15 — Alembic migration 目录与 schema 领先版本号的处理

- **目录路径**：`backend/alembic.ini` 的 `script_location = migrations`，所以 migration 文件真实路径是 `backend/migrations/versions/`，**不是**默认的 `backend/alembic/versions/`。确认 head 用 `cd backend && alembic history` / `alembic heads`。
- **schema 领先 alembic 版本号**：当 model 先加列但漏补 migration 时，开发库会因某次 SQLModel `metadata.create_all` / 手动改动已把列加进表，而 `alembic_version` 表还停在旧 head。此时 `alembic upgrade head` 对新 migration 的 `ADD COLUMN` 报 `DuplicateColumnError`。
- **正确处理**（不破坏数据、不手动改表）：`alembic stamp <新revision>` 把版本号对齐到新 migration（告诉 alembic「列已存在，版本到此」），再 `alembic downgrade -1`（DROP，证明 downgrade 正确）+ `alembic upgrade head`（ADD，证明 upgrade 正确，等价干净库场景）往返验证双向 DDL。`stamp` 是 alembic 处理「schema 已手动变更但版本号滞后」的标准手段。
- **干净库不受影响**：全新库 upgrade head 会从建表 migration 顺序执行到新 ADD COLUMN，列那时不存在，正常通过——这正是补 migration 要解决的「干净部署必崩」。
- **模块文档惯例**：`backend/migrations/versions/**` 不命中任何业务模块 glob（如 `backend/app/modules/agent/**`），且既往 agent_runs 系列 migration 均不写入 agent 模块变更索引，故 migration 改动跳过模块文档同步。

