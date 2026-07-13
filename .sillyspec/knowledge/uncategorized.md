# 未分类知识

> 项目特定的架构经验、历史记录、尚未提炼成通用 pattern 的知识。
> 已分类的迁移到：`sillyspec-gotchas.md`（工具坑）/ `testing-gotchas.md`（测试坑）/ `patterns.md`（架构）/ `known-issues.md`（项目坑）。
> 已修复项保留并标注状态，便于回溯。INDEX.md 不索引本文件——条目成熟后请迁出到分类文件并加 INDEX 索引。

## 2026-06-30 — install.sh 改动需重建 backend 镜像才下发（baked into image）+ bash heredoc \${VAR} 转义陷阱

- **生效路径**：`sillyhub-daemon/scripts/install.sh` 不是运行时读取，而是 backend 镜像构建时 `COPY scripts/install.sh /app/daemon-dist/install.sh`（backend/Dockerfile:86）baked 进镜像，由公开端点 `/daemon/install.sh` 下发（`app/modules/daemon/dist_router.py`，无 /api 前缀）。改 install.sh 后必须**重建并重新部署 backend 镜像**，新安装的用户才拿到新版；仅改文件不重建，下发的仍是旧镜像里的 install.sh。`config.py` 的 `daemon_dist_dir` 仅在测试用 tmp_path 覆盖，生产是镜像内固定路径。
- **heredoc 转义陷阱**：bash 无引号 heredoc（`<<EOF`）中，`\${VAR}` 的反斜杠会转义 `$` → 输出字面 `${VAR}` 不展开；要展开须让 `$` 前无反斜杠，或用 `\\` 分隔。install.sh 生成 `.cmd` wrapper 时写 `"${win_bin_dir}\${BUNDLE_NAME}"`，Windows 路径反斜杠紧贴 `${` 触发此陷阱，生成的 .cmd 含字面量 `${BUNDLE_NAME}`。修复：bundle 路径改用 cmd 内置 `%~dp0`（=该 .cmd 自身所在目录，自相对、bash heredoc 不碰 `%`、不依赖运行时 PATH）。
- **本机已装实例**：install.sh 重建下发只影响**新安装**；本机已生成的 `~/.sillyhub/daemon/bin/sillyhub-daemon.cmd` 需手工修或重装才修复。

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

## 2026-06-15 — Alembic migration 目录与 schema 领先版本号的处理

- **目录路径**：`backend/alembic.ini` 的 `script_location = migrations`，所以 migration 文件真实路径是 `backend/migrations/versions/`，**不是**默认的 `backend/alembic/versions/`。确认 head 用 `cd backend && alembic history` / `alembic heads`。
- **schema 领先 alembic 版本号**：当 model 先加列但漏补 migration 时，开发库会因某次 SQLModel `metadata.create_all` / 手动改动已把列加进表，而 `alembic_version` 表还停在旧 head。此时 `alembic upgrade head` 对新 migration 的 `ADD COLUMN` 报 `DuplicateColumnError`。
- **正确处理**（不破坏数据、不手动改表）：`alembic stamp <新revision>` 把版本号对齐到新 migration（告诉 alembic「列已存在，版本到此」），再 `alembic downgrade -1` + `alembic upgrade head` 往返验证双向 DDL。`stamp` 是 alembic 处理「schema 已手动变更但版本号滞后」的标准手段。
- **干净库不受影响**：全新库 upgrade head 会从建表 migration 顺序执行到新 ADD COLUMN，列那时不存在，正常通过——这正是补 migration 要解决的「干净部署必崩」。
- **模块文档惯例**：`backend/migrations/versions/**` 不命中任何业务模块 glob（如 `backend/app/modules/agent/**`），故 migration 改动跳过模块文档同步。

## 2026-06-17 — login_enabled 必须在 get_current_user 检查，不能只在 login 入口 [🟢 已修复]

- 仅在 `auth/service.py:login()` 检查 `user.login_enabled` 是不够的：用户已持有有效 JWT，管理员调用 `disable-login` 后，旧 token 在自然过期前仍能访问所有 `/api/*` 端点。
- 必须在 `backend/app/core/auth_deps.py:get_current_user()` 内补一道 `if not getattr(user, "login_enabled", True): raise AuthUserLoginDisabled(...)`，配合 `users_service._revoke_sessions()` 在 disable-login 时把 sessions 全部标记 revoked_at，才能让 token 立即失效。
- **已修复**（2026-07-05 核实，commit `d62ec975`）：`backend/app/core/auth_deps.py:78-79` 已有 `if not getattr(user, "login_enabled", True): raise AuthUserLoginDisabled(...)`。本条保留作安全模式回溯。
- E2E 验证：disable-login 后立刻拿旧 token GET `/api/auth/me`，期望 401；用密码重新登录，期望 401 + `HTTP_401_AUTH_USER_LOGIN_DISABLED`。

## 2026-06-19 — alembic.ini 注释含 UTF-8 em-dash 导致 Windows gbk configparser 崩溃 [🟢 已修复]

- 现象：Windows 中文 locale 下 `uv run alembic <cmd>` 报 `UnicodeDecodeError: 'gbk' codec can't decode byte 0x94`。根因：`backend/alembic.ini` 注释含 UTF-8 em-dash（`—` = e2 80 94），alembic `compat.read_config_parser` 用 locale 默认编码（Windows zh = gbk/cp936）读 ini 解码失败。
- `PYTHONUTF8=1` / `python -X utf8 -m alembic` **均无效**（alembic compat 层不走 utf8 mode；直接 `configparser.read()` + `-X utf8` 能读，但 alembic CLI 入口路径不行）。
- **已修复**（2026-07-05 核实）：`backend/alembic.ini` em-dash 计数为 0，注释已改 ASCII。
- 通用坑：Windows 本地跑 alembic 的项目，alembic.ini / 其他 .ini 注释避免 UTF-8 特殊标点（em-dash/智能引号），用 ASCII。

## 2026-06-20 — cursor-agent 官方 ps1 版本目录正则不匹配新版目录命名，导致 cursor 完全不可用 [🟢 已修复]

- 现象：daemon 注册的 cursor runtime 版本显示「待识别」（实际注册 'unknown'），cursor task 启动即崩（exit 1）。其他 provider 正常。daemon 心跳/在线正常（因为 resolveBinPath 找到 cursor-agent.cmd 就算 available，与版本探测是否成功无关）。
- 根因：cursor-agent 官方安装在 `%LOCALAPPDATA%\cursor-agent\`，`cursor-agent.cmd` → `cursor-agent.ps1`。ps1 用正则 `^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` 找 `versions/` 下最新版本目录，但新版 cursor 的目录名是 `YYYY.MM.DD-HH-MM-SS-commit`（含时分秒、多段 `-`），`-` 后非纯十六进制 → 不匹配 → ps1 `Write-Error "No version directories found"` + `exit 1`。
- 修复（ql-20260620-002-f8c1）：daemon 侧绕过 ps1 —— 新增 `resolveCursorVersionEntry` 扫描 versions 目录取最新；`agent-detector` cursor 版本探测 fallback 取目录名作版本；`cmd-shim` 模式0 把 `cursor-agent.ps1` 解析为 version 目录的 `node.exe index.js` 入口让 task-runner 直跑。
- 通用坑：第三方 CLI 的启动包装脚本（.ps1/.cmd）若用正则找自更新版本目录，正则可能跟不上自身新版目录命名格式变化。遇到「CLI `--version` / 启动报奇怪错误且 exit 1、但二进制确实存在」时，先检查其包装脚本的版本查找逻辑是否过时，必要时绕过包装层直接调 version 目录的真实入口。

## 2026-06-21 — ETL 迁移函数执行顺序依赖 maps 构建时机，ppm 模块整表成孤儿

- `backend/scripts/migrate_from_ruoyi.py` 的 `migrate_plan_node_module.plan_node_id` 实际指向 `ps_plan_node`（里程碑，非 plan_node 模板），但原 main() 把它排在 `migrate_ps_plan_node`（构建 `maps["ps_plan_node"]`）之前 → `map_fk` 全失败 → `fallback_keep=True` 保留源数字 ID → 被 ALTER varchar→uuid 迁移丢弃为 NULL → 模块成孤儿。
- 排查线索：对照组 `migrate_ps_plan_node_detail`（排在 ps_plan_node 之后）正常映射，唯独 module 全军覆没；"子表全空"时优先查 FK 列 NULL 比例即可定位，别只盯前端。
- 修复（ql-20260621-004-f2a1）：main() 顺序调整，module 移到 ps_plan_node 之后；已落地的孤儿用 `backend/scripts/resync_modules.py`（幂等 DELETE+INSERT，id 用确定性 uuid5）重同步。
- 通用坑：ETL 脚本里各 `migrate_*` 函数依赖前序函数构建的 maps dict，新增/调整迁移函数时务必确认其 `map_fk` 依赖的 map_key 已由排在前面的函数构建。

## 2026-06-22 — 单类巨石拆 facade+子包的 import 策略（避免 module-level 循环 / 跨域调用 / 测试 patch 跟随）

> 来源：2026-06-22-daemon-service-split（DaemonService 3324 行拆 runtime/lease/run_sync/session/patch 5 子包）。decisions.md D-005/D-006。

- **循环 import 坑**：facade 顶部模块级 `from .subpackage.service import SubService` + 子 service 顶部 `from .service import SomeError`（异常类暂留 facade）= 双向模块级循环，import 即 `ImportError`。
- **解法（D-005）**：facade `__init__` 内**函数级 lazy import** 子 service 类（router.py:624 同款模式），子 service 顶层 import facade 异常类。依赖单向（子→facade），循环解除。
- **跨域调用（D-006）**：子 service 调未迁/跨域方法持 `self._facade` 引用——facade `__init__` 构造子 service 后注入 `self._x._facade = self`，方法体 `self._facade.cross_domain_method()`。`TYPE_CHECKING` import facade 类型避免运行时循环。全部子域迁完后 facade 保留委托，引用继续兼容，**不耦合 Wave 顺序**。
- **测试 patch 跟随**：模块级符号（如 `get_redis`）从 facade 迁子 service 后，测试 `patch("...daemon.service.get_redis")` 失效，patch 目标必须跟随到子包模块（`...daemon.run_sync.service.get_redis`）。源码 API 零变化，仅 patch 物理位置变。
- **grep 调用点范围**：迁移方法时 grep 调用点必须搜 `router.py` + 全 `backend/app/` + `tests/`，不能只搜当前文件——router 可能直接调 service 私有方法。
- **异常类最终归位**：收尾阶段把异常类从 facade 迁各子包定义 + facade re-export（显式列出禁 `import *`），此时 facade 可模块级 re-export 子包符号（子包不反向 import facade，单向无循环）。
- **通用**：任何"单类拆子包 + facade 兼容（签名不变/router 零改动）"的重构适用此 import 策略组合。

## 2026-06-24 — Codex Interactive Session 沉淀的通用经验

> 来源：2026-06-23-codex-interactive-session（D-001@v1 ~ D-010@v1）。把单一 provider 的 interactive session 控制层抽象成 provider-neutral driver 的实践。

- **Provider driver 抽象（D-001@v1, D-009@v1）**：把 SessionManager 从「只驱动单一 provider SDK」改为「按 provider 选 driver」。`SessionManagerDeps.drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>`，driver 契约 provider-neutral（`start`/`consume`/`interrupt`），driver 内部各自做 provider 协议 ↔ provider-neutral `UserTurnInput` 转换。session 生命周期层不依赖具体 SDK 类型；新增 provider 只加 driver，不触碰 SessionManager 控制面。
- **Codex app-server stdio JSON-RPC 长驻 driver（D-002@v1, D-004@v1）**：`codex app-server --listen stdio://` 作为长驻子进程，driver 内做 `initialize` → `notifications/initialized` → `thread/start` → 串行 `turn/start`；`thread/resume(threadId)` 支持 reopen/recovery；消息映射成 flat message 上报 backend。interactive 与 batch 是**两套审批策略隔离点**，别共用审批状态。
- **Fail-closed 审批策略（D-006@v1, D-008@v1）**：provider-neutral server request 默认走 `PermissionResolver`，backend send 失败/超时/session 已结束/driver 被 interrupt 时返回 deny/cancel，**绝不无条件自动 accept**。权限 deny 时返回**空 profile**（不扩权），而非按请求 granted。
- **MCP elicitation 复杂场景如实标注（D-008@v1, D-010@v1）**：可归一化成现有 `AskUserDialogCard` 的简单 form/url 才阻塞等待用户；不支持的复杂 schema fail-closed 并上报 error，**不写成「全面支持 MCP elicitation」**。
- **缺 thread id 的 Codex session 不能伪造（D-007@v1）**：ended/failed Codex session 若缺 threadId，应显示失败且**不伪造新 thread**（避免历史串线）。

## 2026-06-24 — interactive driver 自行 spawn 时漏接 resolveWindowsCmdShim 致 Windows spawn EINVAL

> 来源：ql-20260624-002-b2f7（codex-app-server-driver）。batch task-runner 早有 resolveWindowsCmdShim，interactive codex driver 漏接。

- 现象：codex interactive session 在 Windows 永远起不来，daemon 日志 `interactive_session_create_failed code=EINVAL error=spawn EINVAL`。
- 根因：agent-detector 在 Windows 给的是 npm cmd-shim `codex.cmd`；driver 直接 `spawn(codex.cmd, args, {stdio})` 无 shell/无 wrapper 解析 → Windows CreateProcess 对 `.cmd/.bat/.ps1` 返回 EINVAL。batch `task-runner.ts` 早用通用 `cmd-shim.ts` 的 `resolveWindowsCmdShim`，唯独 interactive codex driver 漏接。
- codex 特殊点：cmd-shim 引用的不是真 .exe 而是 `codex.js`（node ESM 入口），`codex.js` 内部 `stdio:"inherit"` spawn 真 `codex.exe`，故解析结果 = `node.exe + [codex.js]`。
- 通用坑（防回归）：**任何自己 `child_process.spawn` 的路径**（interactive driver / 新 provider runtime / 任何长驻 stdio 子进程），Windows 上 spawn agent-detector 给的 `.cmd/.bat/.ps1` wrapper 前必须先 `resolveWindowsCmdShim` 解析成 `{exe, prependArgs}` 再 `spawn(exe, [...prependArgs, ...业务args], {shell:false})`，解析失败才回退 `shell:true`。新增 interactive driver 时对照 `task-runner.ts` 接线，别各自 spawn——否则只在 Windows 环境暴露（posix CI 跑不到，易漏）。

## 2026-06-24 — codex turn 收敛强契约：turn/completed 不可被 parse 吞信号

> 来源：ql-20260624-007-a9e3（json-rpc.ts parseTurnCompleted）。

- **turn/completed 是 codex 的 claude-result 等价收尾信号**：codex app-server 是被动 server，单 turn 完成后不自动 exit，**唯一**的单 turn 收尾信号就是 turn/completed notification。
- **强契约不可吞**：parseTurnCompleted 原在 `params.turn` 缺失/非 object 时 `return null`，把收尾信号当"非法 notification"吞掉 → complete event 不产出 → consume 卡在 `await currentTurnPromise` → `notifyRunResult` 永不执行 → backend AgentRun 永卡 active。对齐 claude：result 一到即 `onResult`，零吞信号；codex 同理：turn/completed 一到必产 complete event（params.turn 异常时降级 unknown→driver 转 failed 上报）。
- **为什么 claude 不卡、codex 卡**：claude 走 SDK 强契约（每 turn 必 yield result，generator 自然结束）；codex 靠自己 spawn+readline 解析 turn/completed 推断 turn 边界，信号被吞就永久挂起。
- **daemon-network-resilience 变更救不了这种卡死**：那个变更针对"回传调用失败"（notifyRunResult 调了但网络丢）；这里是"压根没调 notifyRunResult"。属更上游缺陷。
- 诊断兜底：codex 子进程 stdout 现已落盘 `~/.sillyhub/daemon/runs/codex-interactive/<sessionId>.log`，下次卡死秒级看 turn/completed 是否到达。
- 用户决策：**不加 turn 超时兜底**（会误杀推理模型正常长 turn），靠对齐 claude 强契约（不吞收尾信号）根治。

## 2026-06-26 — daemon allowed_roots 只管 list_dir RPC，不管 CC 执行 cwd

> 来源：2026-06-26-daemon-root-path-translation execute（design D-002 superseded）。

- daemon `assertWithinAllowedRoots`（`sillyhub-daemon/src/file-rpc.ts`）只被 `listDir` 调用（list_dir RPC），**不用于 CC 执行的 cwd/文件访问**。CC 的 cwd 由 `task-runner.ts` `prepareWorkspace` 分支0 `statSync(rootPath)` 决定，CC 访问文件走 OS 权限（独立进程）。
- 设计 daemon 侧"放行 CC 访问"类功能时，勿误以为 allowed_roots 管 CC 执行——它只管 daemon 自身的 list_dir RPC（前端浏览目录场景）。CC 能否在项目根执行 + 访问源码，取决于 backend 下发的 root_path 是否为 daemon 可 statSync 的宿主机路径。

## 2026-07-01 — Next.js rewrite proxy 对长请求 socket hang up + daemon 分发以 git SHA 为版本号

- **Next.js rewrite proxy 超时**：frontend `next.config.mjs` 用 `rewrites` 把 `/api/:path*` 代理到 backend（Next.js 14.2.5 standalone node server，非 nginx）。backend 处理慢（>~20-30s）时 proxy 端 `socket hang up / ECONNRESET` 返 500 给浏览器，但 backend 仍在后台跑完（业务成功、前端误报）。根治：耗时端点改 SSE 流式（text/event-stream 长连接 + 阶段事件 + 长阻塞段每 5s yield `: keepalive` 注释行保活），前端原生 fetch+ReadableStream 解析（不复用 JSON 的 apiFetch）。参考范式：`agent/router.py:_SSE_HEADERS` + `StreamingResponse(gen, media_type="text/event-stream")`。
- **daemon 分发以 git SHA 为版本号**：`pnpm bundle` 的 `BUILD_ID={commit-sha}-{timestamp}`（build-bundle.sh 写 src/build-id.ts），backend `/daemon/latest.json` 分发此 version，daemon `preflight` 启动时比较本地 vs 服务器 SHA 决定是否自更新。**未 commit 的 daemon 改动 bundle 后 BUILD_ID 仍是当前 HEAD SHA**——若用户 daemon 已是该 SHA，preflight 判定版本相同不更新，新代码不生效。故 daemon 改动必须**先 commit（新 SHA）→ 再 bundle → 再 rebuild backend**，分发版本才会递增。
- **apply_sync 黑盒 vs SSE 分阶段**：原 `apply_sync`（写盘+reparse 整体返回 int）无法在 SSE 中途 yield reparse 阶段进度。解法：提取 `_write_spec_root`（写盘+commit clean）供 apply_sync 与 SSE 生成器共用，SSE 顺序调 `_write_spec_root`→`_reparse_phase(scan_docs)`→`_reparse_phase(change)`，每步 yield 事件。两阶段 reparse 各自 try/except 设 dirty 不阻断（D-003，docs/changes 独立数据，部分成功优于全失败）。

## 2026-07-08 — daemon 列表测试造 status 必须符合 cleanup_stale_runtimes 不变量

> 来源：2026-07-07-daemon-machine-runtime-hierarchy task-04 排序用例。

- `list_machines` / `list_runtimes_page` 进入先调 `cleanup_stale_runtimes()`（DEFAULT_RUNTIME_STALE_SECONDS=45）：选 `status='online'` 且心跳 >45s（或 NULL）的 instance 改 offline，**不反向 resurrect**（offline→online 由心跳端点主动刷新）。
- 测试造 data：设 `status="online"` 的 instance，`last_heartbeat_at` 必须 `<45s`（如 `now - timedelta(seconds=30)`），否则 cleanup 改 offline 污染排序/统计断言；设 `status="offline"` + 新心跳的 instance 保持 offline（cleanup 不 resurrect），可安全验证"online 优先于心跳新鲜度"。
- 通用坑：调用 `list_*`（内部 cleanup）的测试，造的 instance.status 必须与 last_heartbeat_at 一致（online ⟺ <45s），不能凭空设 online + 老 heartbeat。

## 2026-07-08 — Pydantic 必填派生字段不能用 model_validate(ORM)+model_copy 两段式

> 来源：2026-07-07-daemon-machine-runtime-hierarchy task-03/04（_build_machine_read bug，task-04 测试捕获）。

- 现象：DTO 含必填派生字段（如 `runtime_count: int` 无 default），用 `Model.model_validate(orm_instance)` + `model_copy(update={派生字段: 值})` 两段式构造时，`model_validate` 在 `model_copy` 填值**前**就抛 `ValidationError: Field required`（ORM 无此属性）。
- 解法：派生字段在构造时显式传——全字段直构 `Model(field1=orm.x, ..., 派生字段=value)`；或给派生字段加 `default=0`（model_validate 用 default 不崩，model_copy 覆盖真实值，适合派生字段总有组装覆盖的场景）。
- 对比 `_runtime_read`（router.py:433）用 model_validate + model_copy 不崩，因 DaemonRuntimeRead 所有字段在 ORM 都有或 optional；DaemonMachineRead 崩是因 runtime_count/online_runtime_count 必填且 ORM 无。
- 通用坑：DTO 有"派生/聚合"必填字段（不在源 ORM 上）时，避开 model_validate(ORM) 两段式，用全字段直构或给派生字段 default。

## 2026-07-13 — backend rebuild apt 连不上 deb.debian.org（base image digest 漂移致 apt 缓存失效裸奔）

> 来源：ql-20260713-001-9f3e（install.sh 修复 ql-20260710-003 上线时触发）。与 [[2026-06-30 — install.sh 改动需重建 backend 镜像才下发]] 同属 daemon 分发链路。

- 现象：`docker compose up --build` 重建 backend 在 `[runtime 3/14] RUN apt-get update` 报 `Could not connect to deb.debian.org`（Connection refused）→ `Unable to locate package curl/git` → 整个 build 失败。运行中的旧容器不受影响（仍 healthy）。
- 根因：runtime stage 的 apt 层平时缓存命中不需联网；当 base image `python:3.12-slim` 上游 digest 漂移（docker hub 重新推送同 tag），FROM 层变化使后续所有层缓存失效，apt-get update 需重新联网，而 deb.debian.org 在国内网络不可达——pip（tsinghua）/npm（npmmirror）都已配国内源，唯独 apt 漏配。
- 修复（ql-20260713-001-9f3e）：backend/Dockerfile L66-76 在 apt-get update 前加 `find /etc/apt \( -name sources.list -o -name '*.sources' \) -exec sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' {} +`。trixie 用 DEB822 `/etc/apt/sources.list.d/debian.sources`，旧版用 `sources.list`，find 双覆盖；找不到文件时 `-exec` 不执行、退出码仍 0，无副作用。
- 通用坑：Dockerfile 多阶段里 pip/npm 配了国内镜像但 apt 漏配是常见隐患——平时缓存命中掩盖了 apt 源不可达，一旦 base image digest 漂移或 `--no-cache` 就裸奔 build 失败。新项目 Dockerfile apt 层统一配国内源，与 pip/npm 对齐。
