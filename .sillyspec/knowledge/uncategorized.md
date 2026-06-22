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

## 2026-06-17 — audit_hooks 只在测试 lifespan 注册，生产审计要业务代码显式写 AuditLog

- `backend/app/core/audit_hooks.py` 提供了 SQLAlchemy `after_flush` 事件钩子，但 `register_audit_hooks()` 仅在 `tests/conftest.py` 的测试 lifespan 调用，**生产 `backend/app/main.py` 的 lifespan 没注册**。
- 后果：依赖 "audit_hooks 自动捕获" 的 service（roles/organizations CRUD）写完代码跑通单测，但部署后 `audit_logs` 表没有任何 `role.*` / `organization.*` 行；E2E 审计覆盖检查会暴露（如 e2e.sh E2E-07）。
- 规避：业务 service 自己写 `AuditLog` 行，参考 `users_service.py` 的模式（id/workspace_id=None/actor_id/action/resource_type/resource_id/details_json/timestamp）。或在 main.py lifespan 显式调用 `register_audit_hooks(engine)`，但要先验证 hooks 对所有 ORM 模型的覆盖面。
- 排查：`docker compose ... exec -T postgres psql -U platform -d platform -tAc "SELECT action, count(*) FROM audit_logs GROUP BY action ORDER BY action"` 看是否有 `user.*` / `role.*` / `organization.*` 三类。

## 2026-06-17 — login_enabled 必须在 get_current_user 检查，不能只在 login 入口

- 仅在 `auth/service.py:login()` 检查 `user.login_enabled` 是不够的：用户已持有有效 JWT，管理员调用 `disable-login` 后，旧 token 在自然过期前仍能访问所有 `/api/*` 端点。
- 必须在 `backend/app/core/auth_deps.py:get_current_user()` 内补一道 `if not getattr(user, "login_enabled", True): raise AuthUserLoginDisabled(...)`，配合 `users_service._revoke_sessions()` 在 disable-login 时把 sessions 全部标记 revoked_at，才能让 token 立即失效。
- E2E 验证：disable-login 后立刻拿旧 token GET `/api/auth/me`，期望 401；用密码重新登录，期望 401 + `HTTP_401_AUTH_USER_LOGIN_DISABLED`。

## 2026-06-18 — MENU_PERMISSION_GROUPS 跨 menu 重复 permission.key 导致测试 queryByLabelText 失败

- 当 MENU_PERMISSION_GROUPS 中同一个 permission.key 出现在多个 menu（如 `user:read` 在 `git-identities`/`users`/`settings` 三处；`workspace:read` 在 7 个 overview 菜单；`platform:admin` 在 `api-keys`/`runtimes`/`settings`），picker 三级渲染会为每个出现位置生成一个独立 checkbox，aria-label={p.key} 在 DOM 中重复。
- 后果：React Testing Library 的 `screen.queryByLabelText("user:read")` / `getByLabelText("user:read")` 抛 `getMultipleElementsFoundError`，传统单元素断言失败。
- 规避（不修改 picker 实现，仅调整测试）：
  - 全局计数断言：折叠某 menu 前后用 `screen.getAllByLabelText("user:read").length` 比较，期望减少 1（其他 menu 的同 key checkbox 仍在）。
  - 容器内查询：`within(menuContainer).getByLabelText(p.key)`，需要先通过 menu label 文本定位容器。
  - 单 menu 单 key 校验：选 only-once 的 key 做断言（如 `organization:read` 只在 organizations menu 出现）。
- 前端 UI 取舍：是否让 picker 去重展示同一 permission.key？本变更选择不去重（每个 menu 完整显示其 permissions），原因：(1) 管理员能直观看到"该 menu 需要哪些权限"；(2) onChange 已经全局生效，勾选一次即同步所有位置；(3) 去重会让某些 menu 的"权限列表"看似稀疏，破坏 picker 的"权限-菜单映射"信息密度。后续如需去重，建议在 menu 头部加"已勾选 N 项，M 项与其他菜单共享"提示。

## 2026-06-19 — alembic.ini 注释含 UTF-8 em-dash 导致 Windows gbk configparser 崩溃 [待确认]

- 现象：Windows 中文 locale 下 `uv run alembic <cmd>` 报 `UnicodeDecodeError: 'gbk' codec can't decode byte 0x94`。根因：`backend/alembic.ini` 注释含 UTF-8 em-dash（`—` = e2 80 94），alembic `compat.read_config_parser` 用 locale 默认编码（Windows zh = gbk/cp936）读 ini 解码失败。
- `PYTHONUTF8=1` / `python -X utf8 -m alembic` **均无效**（alembic compat 层不走 utf8 mode；直接 `configparser.read()` + `-X utf8` 能读，但 alembic CLI 入口路径不行）。
- 修复：alembic.ini 注释 em-dash 改 ASCII（`—` → `--`），根除所有 Windows 本地 alembic 操作的编码崩溃。
- 通用坑：Windows 本地跑 alembic 的项目，alembic.ini / 其他 .ini 注释避免 UTF-8 特殊标点（em-dash/智能引号），用 ASCII。

## 2026-06-19 — 全 Docker 部署项目本地 PG 容器端口未映射 host，host 跑 alembic/pytest 连不上 [待确认]

- 现象：本项目全 Docker 部署（backend + postgres 同 compose 网络），`docker ps` 显示 postgres 容器 `5432/tcp` 但**无 `0.0.0.0:5432->5432` host 映射**；worktree backend 无 `.env`。后果：host 上 `uv run alembic upgrade` / 并发 pytest 连 `localhost:5432` 失败（[WinError 1225] 拒绝连接）。
- 影响：需 host 连 PG 的验证（alembic online 往返、PostgreSQL 并发证明 AC-04 等）本地受限，只能用 offline SQL + metadata 对比 / SQLite fixture 等效验证，online apply 待 CI/部署补。
- 通用坑：全 Docker 部署项目，host 上跑需 DB 的命令（alembic / 并发测试）前，先确认 PG 容器端口映射到 host；否则用 `docker exec` 进容器跑，或 SQLite fixture 等效验证 + 标注"PG 并发证明待 CI 补"。



## 2026-06-20 — cursor-agent 官方 ps1 版本目录正则不匹配新版目录命名，导致 cursor 完全不可用 [已修复]

- 现象：daemon 注册的 cursor runtime 版本显示「待识别」（实际注册 'unknown'），cursor task 启动即崩（exit 1）。其他 provider 正常。daemon 心跳/在线正常（因为 resolveBinPath 找到 cursor-agent.cmd 就算 available，与版本探测是否成功无关）。
- 根因：cursor-agent 官方安装在 `%LOCALAPPDATA%\cursor-agent\`，`cursor-agent.cmd` → `cursor-agent.ps1`。ps1 用正则 `^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` 找 `versions/` 下最新版本目录，但新版 cursor 的目录名是 `YYYY.MM.DD-HH-MM-SS-commit`（含时分秒、多段 `-`），`-` 后非纯十六进制 → 不匹配 → ps1 `Write-Error "No version directories found"` + `exit 1`。该查找在 `$args` 之前执行、与传参无关，所以 `--version`、task 执行任何调用都崩。
- 关键事实：`versions/<ver>/` 目录结构完整（`node.exe` + `index.js` + package.json），ps1 的 `node.exe index.js $args` 调法本身正确，只是它自己找不到目录。直接 spawn `versions/<latest>/node.exe index.js <args>` 正常工作（exit 0 + STDOUT 输出目录名作版本号）。
- 修复（ql-20260620-002-f8c1）：daemon 侧绕过 ps1 —— 新增 `resolveCursorVersionEntry` 扫描 versions 目录取最新；`agent-detector` cursor 版本探测 fallback 取目录名作版本；`cmd-shim` 模式0 把 `cursor-agent.ps1` 解析为 version 目录的 `node.exe index.js` 入口让 task-runner 直跑。
- 通用坑：第三方 CLI 的启动包装脚本（.ps1/.cmd）若用正则找自更新版本目录，正则可能跟不上自身新版目录命名格式变化。遇到「CLI `--version` / 启动报奇怪错误且 exit 1、但二进制确实存在」时，先检查其包装脚本的版本查找逻辑是否过时，必要时绕过包装层直接调 version 目录的真实入口（node.exe + 入口 js）。

## 2026-06-21 — ETL 迁移函数执行顺序依赖 maps 构建时机，ppm 模块整表成孤儿

- `backend/scripts/migrate_from_ruoyi.py` 的 `migrate_plan_node_module.plan_node_id` 实际指向 `ps_plan_node`（里程碑，非 plan_node 模板），但原 main() 把它排在 `migrate_ps_plan_node`（构建 `maps["ps_plan_node"]`）之前 → `map_fk` 全失败 → `fallback_keep=True` 保留源数字 ID → 被 `202607220900` ALTER varchar→uuid 迁移（`CASE WHEN uuid 正则`）丢弃为 NULL → 模块成孤儿，里程碑详情页"模块"子表全空。
- 排查线索：对照组 `migrate_ps_plan_node_detail`（排在 ps_plan_node 之后）正常映射 1702 条，唯独 module 全军覆没；"子表全空"时优先查 FK 列 NULL 比例即可定位，别只盯前端。
- 修复（ql-20260621-004-f2a1）：main() 顺序调整，module 移到 ps_plan_node 之后、ps_plan_node_detail 之前（detail 的 module_id 也依赖 `maps["module"]`）；已落地的孤儿用 `backend/scripts/resync_modules.py`（复用 ETL 辅助函数，幂等 DELETE+INSERT，id 用确定性 uuid5）重同步。
- 通用坑：ETL 脚本里各 `migrate_*` 函数依赖前序函数构建的 maps dict，新增/调整迁移函数时务必确认其 `map_fk` 依赖的 map_key 已由排在前面的函数构建。

## 2026-06-22 — antd v5 DatePicker 周几/日历表头显示英文，仅 ConfigProvider locale 不够

- 现象：ppm 里程碑明细的 DatePicker 日历表头星期显示英文（Su/Mo/Tu…），即便 `antd-providers.tsx` 已配 `ConfigProvider locale={zhCN}`。
- 根因：antd v5 DatePicker 内部用 dayjs 渲染日历表头（一二三四五六日）、月份名、周起始日，这些取自 **dayjs 全局 locale**，而非 antd ConfigProvider 的 locale。`ConfigProvider locale={zhCN}` 只影响 antd 自有文案（「今天」按钮、placeholder、空状态），管不到日历表头星期。
- 修复（ql-20260621-004-c4a1）：`antd-providers.tsx` 补 `import 'dayjs/locale/zh-cn'; dayjs.locale('zh-cn');`，与 ConfigProvider locale 双保险。
- 通用坑：antd v5 全家桶（DatePicker / RangePicker / Calendar / TimePicker）的日历本地化 = `ConfigProvider locale`（antd 文案）+ `dayjs.locale`（日历表头/边界/月份）**缺一不可**。配了 ConfigProvider 仍显示英文星期，第一时间查 `dayjs.locale` 是否全局设过——项目里多处 `import dayjs` 用 `.format()` 不报错，易误以为 locale 已就绪。

## 2026-06-22 — sillyspec execute worktree 内跑 pnpm 后 Bash cwd 持久，致 sillyspec 命令在子项目上下文重置 [待确认]

- 现象：execute Wave 验证时 `cd {worktree}/frontend && pnpm typecheck/test`，之后 `sillyspec run execute --done` 在 worktree/frontend 子目录运行，CLI 检测到 frontend 子项目，**重新初始化 execute**（project 由 multi-agent-platform 变 frontend、steps 从 14 变 12、从 Step 1 重开），主仓库 progress 未记录该 Wave 完成（progress show 显示 Wave ⬜）。
- 根因：Bash 工具 cwd 在调用间持久；sillyspec 命令对 cwd 敏感——在 worktree/frontend（子项目根）跑会切到该子项目上下文，而非主仓库的 multi-agent-platform 变更。
- 规避：worktree 内只跑 `pnpm`/`rg`/`git`（测试/验证），**所有 sillyspec 命令（`run`/`--done`/`progress`）必须在主仓库根 cwd 跑**；每次 `cd {worktree}/frontend` 后，下一条 sillyspec 命令前显式 `cd 主仓库根`。
- 排查：progress show 发现 Wave 未记录 + CLI 输出 project 字段变化（frontend 而非 multi-agent-platform）即为此坑；补救：回主仓库 cwd 重跑该 Wave 的 `--done`。
