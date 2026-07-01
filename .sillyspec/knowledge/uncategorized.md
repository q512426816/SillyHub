# 未分类知识

> execute/quick 执行中发现的坑暂存于此，用户审阅后归类到对应文件并更新 INDEX.md。

## 2026-06-30 — install.sh 改动需重建 backend 镜像才下发（baked into image）+ bash heredoc \${VAR} 转义陷阱

- **生效路径**：`sillyhub-daemon/scripts/install.sh` 不是运行时读取，而是 backend 镜像构建时 `COPY scripts/install.sh /app/daemon-dist/install.sh`（backend/Dockerfile:86）baked 进镜像，由公开端点 `/daemon/install.sh` 下发（`app/modules/daemon/dist_router.py`，无 /api 前缀）。改 install.sh 后必须**重建并重新部署 backend 镜像**，新安装的用户才拿到新版；仅改文件不重建，下发的仍是旧镜像里的 install.sh。`config.py` 的 `daemon_dist_dir` 仅在测试用 tmp_path 覆盖，生产是镜像内固定路径。
- **heredoc 转义陷阱**：bash 无引号 heredoc（`<<EOF`）中，`\${VAR}` 的反斜杠会转义 `$` → 输出字面 `${VAR}` 不展开；要展开须让 `$` 前无反斜杠，或用 `\\` 分隔。install.sh 生成 `.cmd` wrapper 时写 `"${win_bin_dir}\${BUNDLE_NAME}"`，Windows 路径反斜杠紧贴 `${` 触发此陷阱，生成的 .cmd 含字面量 `${BUNDLE_NAME}`。修复：bundle 路径改用 cmd 内置 `%~dp0`（=该 .cmd 自身所在目录，自相对、bash heredoc 不碰 `%`、不依赖运行时 PATH）。
- **本机已装实例**：install.sh 重建下发只影响**新安装**；本机已生成的 `~/.sillyhub/daemon/bin/sillyhub-daemon.cmd` 需手工修或重装才修复。

## 2026-06-25 — execute 启动前主仓库规范文件必须 commit（worktree apply 前提）

- `sillyspec run execute` 创建 worktree 时，baseline = 主仓库当前 HEAD + overlay（staged 文件）。若 brainstorm/plan 产出的规范文件（proposal/design/plan/tasks）staged 未 commit，`sillyspec worktree apply` 陷死循环：apply 第一校验要主仓库 clean（staged commit/stash），但 commit 规范使 HEAD 推进 → base hash 校验失败；stash 规范则 overlay 的 plan.md 在主仓库不存在 → patch 失败。
- 正确做法：**execute 启动前先把规范文件 commit**（主仓库 clean），再 run execute（worktree baseline 基于规范已 commit 的 HEAD，apply 时主仓库 = base，校验通过）。
- 本次 `2026-06-25-admin-users-org-tree` 因 execute 前规范未 commit，worktree apply 失败，改用 worktree→主仓库手动 cp（改动经 task-05/10 测试验证后 cp），属 workaround。

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

## 2026-06-22 — 单类巨石拆 facade+子包的 import 策略（避免 module-level 循环 / 跨域调用 / 测试 patch 跟随） [待确认]

> 来源：2026-06-22-daemon-service-split（DaemonService 3324 行拆 runtime/lease/run_sync/session/patch 5 子包）。decisions.md D-005/D-006。

- **循环 import 坑**：facade 顶部模块级 `from .subpackage.service import SubService` + 子 service 顶部 `from .service import SomeError`（异常类暂留 facade）= 双向模块级循环，import 即 `ImportError: cannot import name ... (partially initialized module)`。facade 冒烟能过**仅因子包当时是空壳**；子包一旦顶层 import facade 符号就爆。task-01 蓝图"顶部单向 import"的假设在子包 import 异常类时破产。
- **解法（D-005）**：facade `__init__` 内**函数级 lazy import** 子 service 类（router.py:624 同款模式），子 service 顶层 import facade 异常类。依赖单向（子→facade），循环解除。
- **跨域调用（D-006）**：子 service 调未迁/跨域方法（W4 时 `_get_lease_and_verify_token` 还在 facade）持 `self._facade` 引用——facade `__init__` 构造子 service 后注入 `self._x._facade = self`，方法体 `self._facade.cross_domain_method()`。`TYPE_CHECKING` import facade 类型避免运行时循环。全部子域迁完后 facade 保留委托，引用继续兼容，**不耦合 Wave 顺序**。
- **测试 patch 跟随**：模块级符号（如 `get_redis`）从 facade 迁子 service 后，测试 `patch("...daemon.service.get_redis")` 失效，patch 目标必须跟随到子包模块（`...daemon.run_sync.service.get_redis`）。源码 API 零变化，仅 patch 物理位置变。迁移含 get_redis/redis 调用的方法时必查测试 patch 目标。
- **grep 调用点范围**：迁移方法时 grep 调用点必须搜 `router.py` + 全 `backend/app/` + `tests/`，不能只搜当前文件——router 可能直接调 service 私有方法（如 `svc._get_owned_runtime`，task-02 曾漏 router.py:622 致 ws_rpc 6 用例 AttributeError 回归）。私有辅助删 facade 前必全 grep。
- **异常类最终归位**：收尾阶段把异常类从 facade 迁各子包定义 + facade re-export（显式列出禁 `import *`），子包改子包直引（不再 import facade），此时 facade 可模块级 re-export 子包符号（子包不反向 import facade，单向无循环）。
- **通用**：任何"单类拆子包 + facade 兼容（签名不变/router 零改动）"的重构适用此 import 策略组合。

## 2026-06-23 — execute worktree 无 node_modules + 子代理 cwd 需显式 worktree 路径

- SillySpec execute 的隔离 worktree（`.sillyspec/.runtime/worktrees/<change>`）是 baseline 快照，**不含 node_modules**（gitignore），worktree 内无法直接跑 tsc/vitest/lint。
- 解法：PowerShell `New-Item -ItemType Junction` 把主仓库 `frontend/node_modules` 链到 `worktree/frontend/node_modules`（junction 免管理员，比 `cmd mklink /J` 引号嵌套更稳）。
- Agent 子代理 cwd 可能**不随父 session 的 EnterWorktree 切换**（本次 task-01 子代理把产物写到了主仓库而非 worktree）。解法：子代理 prompt 显式给 worktree 绝对路径前缀；审查用 `git status` + `ls worktree` 确认落点，错位则 `cp` 统一到 worktree + 主仓库 `git checkout` 恢复。
- Radix Dialog 测试：`DialogContent` role=dialog 可 `getByRole`；但标题含 `·`（middle dot）字符，`getByText` 正则易因字符/文本节点分割失败，改 `within(dialog).getAllByText(/runtime名/)` 限定作用域更稳。

## 2026-06-23 — /runtimes Codex 对话不能走 interactive SessionManager [已被 2026-06-23-codex-interactive-session 覆盖]

> 本条是历史记录。codex-runtime-conversation-fix 临时降级时记录的"Codex 不能走 interactive"已过时——本变更已把 Codex 纳入 provider driver interactive 路径，Codex runtime 会话改回 `InteractiveSessionChatSection` 主路径。

- **已被覆盖**：Codex 现已走 provider driver interactive 路径。daemon `SessionManager` 通过 `_getDriver(provider)` 选 `ClaudeSdkDriver` 或 `CodexAppServerDriver`，`create(provider="codex")` 不再抛 `UnsupportedProviderError`；backend `SessionService.reopen_session()` provider gate 放开为 `{claude, codex}`；frontend `RuntimeSessionDialog` Codex 走 `InteractiveSessionChatSection`，`QuickChatSessionSection` 降级为非 /runtimes 主路径（全局能力保留）。
- 历史降级路径（仅供回溯）：codex-runtime-conversation-fix 临时把 Codex 分流到 `/api/daemon-chat` quick-chat SSE（`quickChat` 创建 run、`streamQuickChat` 订阅、下一轮用 `prev_run_id` 接 `session_id`），规避 daemon `UnsupportedProviderError`。该降级已被本变更覆盖，不要据此把 Codex 混入 quick-chat 面板或拒绝 interactive provider。

## 2026-06-24 — Codex Interactive Session 沉淀的通用经验

> 来源：2026-06-23-codex-interactive-session（D-001@v1 ~ D-010@v1）。把单一 provider 的 interactive session 控制层抽象成 provider-neutral driver 的实践。

- **Provider driver 抽象（D-001@v1, D-009@v1）**：把 SessionManager 从「只驱动单一 provider SDK」改为「按 provider 选 driver」。`SessionManagerDeps.drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>`，driver 契约 provider-neutral（`start`/`consume`/`interrupt`），driver 内部各自做 provider 协议 ↔ provider-neutral `UserTurnInput` 转换。session 生命周期层（create/inject/interrupt/end/reopen/recovery）不依赖具体 SDK 类型；`InputQueue` 队列元素也放宽为 provider-neutral。好处：新增 provider 只加 driver，不触碰 SessionManager 控制面。
- **Codex app-server stdio JSON-RPC 长驻 driver（D-002@v1, D-004@v1）**：`codex app-server --listen stdio://` 作为长驻子进程，driver 内做 `initialize` → `notifications/initialized` → `thread/start` → 串行 `turn/start`（一次只一个 running turn，`turn/completed` 后才消费下一条，避免 app-server 内并发 turn）；`thread/resume(threadId)` 支持 reopen/recovery；`turn/started` 保存 `turnId` 供 `turn/interrupt` 打断；消息映射成 flat message（`event_type`+`content`+`metadata`+`session_id=threadId`）上报 backend，不把 app-server schema 泄漏到 backend。`adapters/json-rpc.ts` 既有 batch 解析能力可抽取复用——但注意 interactive 与 batch 是**两套审批策略隔离点**（batch 走 TaskRunner 执行协议，interactive 走 SessionManager 的 PermissionResolver/dialog hook），别共用审批状态。
- **Fail-closed 审批策略（D-006@v1, D-008@v1）**：provider-neutral server request 默认走 `PermissionResolver`，backend send 失败/超时/session 已结束/driver 被 interrupt 时返回 deny/cancel，**绝不无条件自动 accept**（否则 Codex 行为比 Claude 更危险）。`manual_approval+ask_user_only=true` 时普通 command/file/permission request allow-through（只记录 metadata），仅阻塞 `request_user_input`/可归一化 MCP elicitation；`ask_user_only=false` 时普通 request 走前端审批卡。权限 deny 时返回**空 profile**（不扩权），而非按请求 granted。
- **MCP elicitation 复杂场景如实标注（D-008@v1, D-010@v1）**：可归一化成现有 `AskUserDialogCard` question/options UI 的简单 form/url 才阻塞等待用户；不支持的复杂 schema fail-closed 并上报 error log 说明「暂不支持」，**不写成「全面支持 MCP elicitation」**。文档与代码须一致，避免夸大未实现能力。
- **AgentRunLog 无 metadata 列对 flat message 的影响**：Codex flat message 的 `metadata`（如 tool_use 的工具名/参数、turn id）若要完整展示，需确认 `AgentRunLog` 是否有 metadata 列承载；无列时只能塞进 `content` 或丢失细节。落地 Codex driver 前先核对 `AgentRunLog` 表结构与 `RunSyncService.submit_messages()` 落库字段，避免 flat message 的 metadata 静默丢失。
- **缺 thread id 的 Codex session 不能伪造（D-007@v1）**：ended/failed Codex session 若缺 `agent_session_id`/threadId，不能可靠 reopen，应显示失败且**不伪造新 thread**（避免历史串线）。daemon recovery 同理：session store 缺 threadId 标 recovery failed，不伪造。

## 2026-06-24 — interactive driver 自行 spawn 时漏接 resolveWindowsCmdShim 致 Windows spawn EINVAL

> 来源：ql-20260624-002-b2f7（codex-app-server-driver）。batch task-runner 早有 resolveWindowsCmdShim，interactive codex driver 漏接。

- 现象：codex interactive session 在 Windows 永远起不来，daemon 日志 `interactive_session_create_failed code=EINVAL error=spawn EINVAL`（4ms 失败，进程根本没起，不是握手问题）。
- 根因：agent-detector 在 Windows 给的是 npm cmd-shim `codex.cmd`；driver 直接 `spawn(codex.cmd, args, {stdio})` 无 shell/无 wrapper 解析 → Windows CreateProcess 对 `.cmd/.bat/.ps1` 返回 EINVAL。batch `task-runner.ts:705-713` 早用通用 `cmd-shim.ts` 的 `resolveWindowsCmdShim`（支持 codex.cmd 模式1=`{exe:node.exe,prependArgs:[codex.js]}` / claude.cmd 模式2 / cursor ps1 模式0），唯独 interactive codex driver 漏接。claude SDK driver 因 SDK 内部 spawn 无法传 shell，改用自带的 `resolveClaudeExecutable` 转 wrapper→真 .exe。
- codex 特殊点：cmd-shim 引用的不是真 .exe 而是 `codex.js`（node ESM 入口，package.json type:module），`codex.js` 内部 `stdio:"inherit"` spawn 真 `codex.exe`（`@openai/codex-win32-x64/vendor/.../bin/codex.exe`），故解析结果 = `node.exe + [codex.js]`，`spawn(node.exe, [codex.js, ...args])` 等价原生 `codex.cmd`，stdio 经 inherit 直通。
- 通用坑（防回归）：**任何自己 `child_process.spawn` 的路径**（interactive driver / 新 provider runtime / 任何长驻 stdio 子进程），Windows 上 spawn agent-detector 给的 `.cmd/.bat/.ps1` wrapper 前必须先 `resolveWindowsCmdShim` 解析成 `{exe, prependArgs}` 再 `spawn(exe, [...prependArgs, ...业务args], {shell:false})`，解析失败才回退 `shell:true`。新增 interactive driver 时对照 `task-runner.ts:705-713` 接线，别各自 spawn——否则只在 Windows 环境暴露（posix CI 跑不到，易漏）。

## 2026-06-24 — codex turn 收敛强契约：turn/completed 不可被 parse 吞信号

> 来源：ql-20260624-007-a9e3（json-rpc.ts parseTurnCompleted）。codex interactive turn 卡死（AgentRun 永不收敛 → inject 报 `already has an active run`）根因。

- **turn/completed 是 codex 的 claude-result 等价收尾信号**（QUICKLOG-qinyi-2026-06-23:113 实测 codex 简单 turn 必发完整事件流末尾 turn/completed / :178 明确"与 claude result 等价"）。codex app-server 是被动 server，单 turn 完成后不自动 exit，**唯一**的单 turn 收尾信号就是 turn/completed notification。
- **强契约不可吞**：parseTurnCompleted（`adapters/json-rpc.ts`）原在 `params.turn` 缺失/非 object 时 `return null`，把收尾信号当"非法 notification"吞掉 → complete event 不产出 → consume 卡在 `await currentTurnPromise`（`codex-app-server-driver.ts:774`，无超时兜底）→ `reportResult`/`notifyRunResult` 永不执行 → backend AgentRun 永卡 active。对齐 `claude-sdk-driver.ts:391-393`：result 一到即 `onResult`，零吞信号；codex 同理：turn/completed 一到必产 complete event（params.turn 异常时降级 unknown→driver 转 failed 上报）。
- **为什么 claude 不卡、codex 卡**：claude 走 SDK 强契约（每 turn 必 yield result，generator 自然结束）；codex 靠自己 spawn+readline 解析 turn/completed 推断 turn 边界，信号被吞就永久挂起。
- **daemon-network-resilience 变更救不了这种卡死**：那个变更针对"回传调用失败"（notifyRunResult 调了但网络丢）；这里是"压根没调 notifyRunResult"（consume 卡死到不了回传）。属更上游缺陷，该变更 plan 漏了这条。
- 诊断兜底：codex 子进程 stdout 现已落盘 `~/.sillyhub/daemon/runs/codex-interactive/<sessionId>.log`（本次新增，CodexStartOptions.sessionId 串入），下次卡死秒级看 turn/completed 是否到达 / payload 长啥样。
- 用户决策：**不加 turn 超时兜底**（会误杀推理模型正常长 turn），靠对齐 claude 强契约（不吞收尾信号）根治。

## 2026-06-25 — antd v5 两字中文按钮 autoLetterSpacing 致 DOM 字间空格（测试 getByRole 匹配失败）

> 来源：2026-06-25-frontend-error-handling task-07（runtimes/page.test.tsx Modal.confirm 测试）。

- 现象：antd v5 `Modal.confirm({ okText: "移除", cancelText: "取消" })` 的两字中文按钮，DOM 渲染为 `<span>移 除</span>` / `<span>取 消</span>`（字间插空格，autoLetterSpacing 特性）。测试 `getByRole("button", { name: "移除" })` 严格匹配失败。
- 根因：antd v5 对中文等 CJK 文本默认开启 `autoLetterSpacing`（ConfigProvider 可关），渲染时在字符间插入空白节点提升可读性，破坏 `aria-label`/name 严格匹配。
- 解法：测试用正则 `/移\s*除/` / `/取\s*消/` 兼容字间空白；或关 `autoLetterSpacing`（但影响视觉一致性，不推荐）。前端测试断言中文按钮一律用 `\s*` 兼容。

## 2026-06-25 — SillySpec plan→execute contract：task 编号须严格按拓扑 Wave 递增

> 来源：2026-06-25-frontend-error-handling plan step8/10（contract 校验失败排查）。

- 现象：plan.md 按 brainstorm 的 3 Wave 分组时，task 编号（task-04 daemon 在 W3）与拓扑 Wave 顺序冲突，contract 校验报「task id 重复/不连续：期望 task-04 实际 task-03」。
- 根因：SillySpec execute contract 校验器按 plan.md 文本里 `task-0N` 出现顺序期望严格递增，且把任务总表的 `task-0N` 引用也计入。若 task 编号不按拓扑 Wave 递增（如 W2 含 task-06 而 W3 是 task-04），校验失败。
- 解法：①task 文件编号按拓扑 Wave 严格递增（W1=01,02..; W2=03,04..; 不回跳）；②plan.md 里 `task-0N` 仅保留在 Wave checkbox 行（9 行严格递增），任务总表/关键路径/AC/覆盖矩阵用纯数字编号（01/02）不带 task 前缀，避免被校验器重复计数；③AC 行不要用 `- [ ]` checkbox 格式（会被误当 task 行），用普通列表。
- 已记 docs/sillyspec/brainstorm-supersede-dref-false-warning.md（supersede 校验误报）属同类 SillySpec 校验工具缺陷。

## 2026-06-26 — daemon allowed_roots 只管 list_dir RPC，不管 CC 执行 cwd [待确认]

> 来源：2026-06-26-daemon-root-path-translation execute（design D-002 superseded）。

- daemon `assertWithinAllowedRoots`（`sillyhub-daemon/src/file-rpc.ts:66`）只被 `listDir` 调用（`daemon.ts:1710`，list_dir RPC），**不用于 CC 执行的 cwd/文件访问**。CC 的 cwd 由 `task-runner.ts:323` `prepareWorkspace` 分支0 `statSync(rootPath)` 决定，CC 访问文件走 OS 权限（独立进程）。
- 设计 daemon 侧"放行 CC 访问"类功能时，勿误以为 allowed_roots 管 CC 执行——它只管 daemon 自身的 list_dir RPC（前端浏览目录场景）。CC 能否在项目根执行 + 访问源码，取决于 backend 下发的 root_path 是否为 daemon 可 statSync 的宿主机路径（backend 侧 container→host 改写，本次变更修复）。

## 2026-06-26 — sillyspec execute 的 exec-run ID 可能复用旧目录，review.json 残留需先 Read 再覆盖 [待确认]

> 来源：2026-06-26-daemon-root-path-translation（task-01~06 review.json 全是 admin-org 残留）。

- `sillyspec run execute` 的 exec-run ID（如 `exec-2026-06-24-100156`）可能复用旧变更的 execute-runs 目录，导致 `tasks/task-XX/review.json` 是**旧变更的残留**（changedFiles/reviewerNotes 是旧变更的）。
- 写 review.json 前必须先 Read（发现残留）再 Write 覆盖，否则 Write 报 `File has not been read yet`。残留会误导后续审查。

## 2026-06-26 — sillyspec plan postcheck 多变更环境校验错变更（progress.json 空 + sort reverse） [待确认]

> 已记 `docs/sillyspec/plan-postcheck-multi-change-bug.md`（完整根因+workaround）。此处知识库索引。

- plan step 4 postcheck 的 `resolveChangeDir` 读空 `progress.json` → 回退 `sort().reverse()` 取字典序最大目录（`workspace-*` 排在 `2026-*` 前），校验了别人的变更卡住当前 plan。
- workaround：写 `progress.json` `{"currentChange":"<变更名>"}` + task 放 `tasks/` 子目录。

## 2026-07-01 — Next.js rewrite proxy 对长请求 socket hang up + daemon 分发以 git SHA 为版本号

- **Next.js rewrite proxy 超时**：frontend `next.config.mjs` 用 `rewrites` 把 `/api/:path*` 代理到 backend（Next.js 14.2.5 standalone node server，非 nginx）。backend 处理慢（>~20-30s）时 proxy 端 `socket hang up / ECONNRESET` 返 500 给浏览器，但 backend 仍在后台跑完（业务成功、前端误报）。无显式 proxyTimeout 配置项（standalone server.js 生成，不易 patch）。根治：耗时端点改 SSE 流式（text/event-stream 长连接 + 阶段事件 + 长阻塞段每 5s yield `: keepalive` 注释行保活），前端原生 fetch+ReadableStream 解析（不复用 JSON 的 apiFetch）。参考范式：`agent/router.py:_SSE_HEADERS` + `StreamingResponse(gen, media_type="text/event-stream")`。
- **daemon 分发以 git SHA 为版本号**：`pnpm bundle` 的 `BUILD_ID={commit-sha}-{timestamp}`（build-bundle.sh 写 src/build-id.ts），backend `/daemon/latest.json` 分发此 version，daemon `preflight` 启动时比较本地 vs 服务器 SHA 决定是否自更新。**未 commit 的 daemon 改动 bundle 后 BUILD_ID 仍是当前 HEAD SHA**——若用户 daemon 已是该 SHA，preflight 判定版本相同不更新，新代码不生效。故 daemon 改动必须**先 commit（新 SHA）→ 再 bundle → 再 rebuild backend**，分发版本才会递增。同理 backend 镜像 rebuild 才把新 daemon bundle（`additional_contexts: daemon`）bake 进镜像。
- **apply_sync 黑盒 vs SSE 分阶段**：原 `apply_sync`（写盘+reparse 整体返回 int）无法在 SSE 中途 yield reparse 阶段进度。解法：提取 `_write_spec_root`（写盘+commit clean）供 apply_sync 与 SSE 生成器共用，SSE 顺序调 `_write_spec_root`→`_reparse_phase(scan_docs)`→`_reparse_phase(change)`，每步 yield 事件。两阶段 reparse 各自 try/except 设 dirty 不阻断（D-003，docs/changes 独立数据，部分成功优于全失败）。
