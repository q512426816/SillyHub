# 未分类知识

> 项目特定的架构经验、历史记录、尚未提炼成通用 pattern 的知识。
> 已分类的迁移到：`sillyspec-gotchas.md`（工具坑）/ `testing-gotchas.md`（测试坑）/ `patterns.md`（架构）/ `known-issues.md`（项目坑）/ `conventions.md`（约定）。
> 已修复项保留并标注状态，便于回溯。INDEX.md 不索引本文件——条目成熟后请迁出到分类文件并加 INDEX 索引。

（2026-09-28 清账：本文件原有 41 条（40 个 `##` 条目 + 1 条丢标题的 SSE 路由条目）已全部迁出到五个分类文件并在 INDEX.md 补索引，见变更 2026-09-28-knowledge-inbox-clear。当前收件箱为空，新踩坑从下方追加。）

## vi.doMock 计划生效前先动态 import 了依赖方，会以"真实 store 代际"冻结被测模块

`frontend/src/lib/__tests__/token-refresh.test.ts` 的隔离范式是 beforeEach `resetModules` + `vi.doMock("@/stores/session", mockStore)` 后动态 `import("@/lib/token-refresh")`。新增用例若为了取同一代际的 `ApiError` 而**先** `await import("@/lib/api")`，会连带把 token-refresh 以**真实 zustand store**（未 mock）代际加载——随后 `loadTokenRefresh` 里的 doMock 对已缓存模块不再生效，`ensureFreshAccessToken` 读真实 store（refreshToken=null）早退返回 null，被测的 5xx/408 抛错路径被静默绕过（症状：期待 reject 的断言收到 resolve，且**不报错**）。正确顺序恒定：**先** `loadTokenRefresh(mockStore)`，**再** `await import("@/lib/api")` 取同类代际的类（instanceof 才能匹配）。来源：2026-10-16-fix-auth-random-logout task-03（红阶段 2 用例假红→排序修正后 14/14）。

## xfail(strict=False) 会把「顺带的无关失败」一起吞成假绿——清偿时先跑真断言

`backend/tests/modules/auth/test_refresh_grace_window.py` 两处历史 `xfail(strict=False)`（红-绿分阶段遗留）：标记本意只针对当时的过渡态，但 strict=False 下**任何**失败都被容忍——用例 2/3 实际因「邮箱形式账号（`u2@example.com`）传给纯 username 登录（D-001）」而持续失败，被 xfail 吞成假绿数月无人发现。清偿 xfail 必须按「先去掉标记跑一次真断言，再修真实原因」顺序（本次即：去掉后暴露 login 失败 → 改 username 形式即绿）。判据：过期 xfail 的 reason 里出现「届时……移除」承诺时，凡承诺成立（前置改造已落地）即应即时清偿。来源：2026-10-16-fix-auth-random-logout task-02。


## 跨仓 worktree task 用直接 git commit，wt-commit 只认主仓 worktree

`sillyspec wt-commit --change <变更名>` 固定在**主仓** worktree（`.sillyspec/.runtime/worktrees/<变更名>`）跑 `git add/commit`；跨仓 task（task 卡 `repo: sillyspec` 等）的 worktree 是 `<变更名>--<repo-key>` 后缀目录，在跨仓 worktree 内跑 wt-commit 会被 CLI 当成 sillyspec 仓自己的项目实例（找它自己的 .sillyspec）报「worktree 不存在」。正确做法：跨仓 worktree 内直接 `git -C <worktree> add + commit`（execute step 指引「跨仓 worktree task」段本就钉了此方式），apply 阶段 CLI 统一把跨仓 worktree 交付 patch 回对应主工作区。另注意 wt-commit 的 `-m` 缺失会报错（不是可选参数）。来源：task-05/task-02 提交实操（2026-10-09-tombstone-conflict-root-fix）。

## 【待确认】daemon 集成测试的 daemon.start() 被系统代理黑洞拖死（npm view 30s×2）

`daemon.start()` 链上 `runPreflight`（preflight.ts runSillySpecCheck）与 `_registerDaemon` 的 `probeLatest`（sillyspec-manager.ts，未注入 sillyspecManager 时）各起一次 `npm view sillyspec version --prefer-online` 子进程；npm 12 在 Windows **遵循系统代理**（WinINET ProxyServer，如 Clash 127.0.0.1:7897），代理对 npm 流量黑洞时每次外呼挂满 runCmd 的 30s 超时帽 → 每个 `daemon.start()` 用例白付 30-60s，满套件整文件超时（2026-10-10 实测 daemon-borrow-sandbox 全红、daemon-kind-dispatch 20 用例 60s 超时；主仓 HEAD 对照复现=环境归因非代码回归）。`npm_config_registry`/`npm_config_proxy` env 钉法无效（系统代理优先级更高）。**修法（2026-10-10-borrow-sandbox-workspace-context task-04 已示范）**：测试文件 `vi.mock('../src/preflight.js', ...)` no-op 掉 runPreflight（182s→1.3s）+ 构造器注入 no-op `sillyspecManager`（官方注入口，daemon.ts ctorOpts）；不断言 preflight 行为的用例组语义无损。候选推广：daemon-kind-dispatch.test.ts 等所有真起 daemon.start() 的测试文件同款 mock（待确认后可立独立小变更）。来源：task-04 排障（reg query ProxyEnable=1 ProxyServer=127.0.0.1:7897 + spawn 计时二分定位）。

## pi 1.0+ 原生 MCP：PI_CODING_AGENT_DIR 重定向后 mcp.json 平铺在目录根（无 agent 子层）

pi 1.1.0 内置 MCP 客户端（pi mcp 子命令 / --no-mcp 开关 / mcp__<server>__<tool> 命名空间），配置读 ~/.pi/agent/mcp.json（全局）或 .pi/mcp.json（项目）。设 PI_CODING_AGENT_DIR 重定向后 pi root 直接对应 agent 层——per-session MCP 配置必须写 `<PI_CODING_AGENT_DIR>/mcp.json`（平铺），不是 `<dir>/agent/mcp.json`；格式与 codex 同风格 `{"mcpServers": {name: {command, args?, env?}}}`，per-server env（MCP_SESSION_ID）经条目 env 字段透传。`pi mcp list --json` 可离线验证连接与工具枚举。来源：2026-10-10-all-engines-mcp-injection task-01/task-05（SPIKE-00）。

## @modelcontextprotocol/sdk 1.29 高级 API 是 registerTool（tool() 旧三参形状已不兼容）

sdk 1.29 的 McpServer 注册工具用 `server.registerTool(name, { description, inputSchema: ZodRawShape }, handler)`；旧 `server.tool(name, schemaShape, handler)` 三参形状会抛 "expected a Zod schema or ToolAnnotations"。inputSchema 要 Zod raw shape——纯 JSON schema 对象不行，无参工具可省略 inputSchema。来源：2026-10-10-all-engines-mcp-injection SPIKE-00 echo server 实测。

## daemon mcp-server 的 env 契约：MCP_SERVER_BACKEND_URL + MCP_TOOLSET（file/mission_worker 两档）

daemon 侧 stdio MCP server（mcp-server.js）从 env 读 backend URL：键名是 `MCP_SERVER_BACKEND_URL`（不是 MCP_HUB_BASE_URL），token 走 `MCP_SERVER_DAEMON_API_KEY`（X-API-Key 优先）+ `MCP_SERVER_DAEMON_TOKEN`（Bearer）；工具集由 `MCP_TOOLSET` env 控制且仅认字面量 file / mission_worker，拼写错误或漏配**容错回落编排 5 工具**（不报错）——手动探测时工具集不对先查这个键。上传 fail-closed：MCP_ALLOWED_ROOT 未设时 upload_file 一律拒绝。来源：2026-10-10-all-engines-mcp-injection task-09 端到端实测。


## 【待确认】async session rollback 后访问 ORM 对象属性触发 MissingGreenlet（异常路径标量先捕获）

SQLAlchemy async（expire_on_commit 语义）下，`await session.rollback()` 会 expire 会话内全部 ORM 对象——异常处理路径里再访问 `obj.attr`（哪怕记日志 `str(agent_run.id)`）会触发同步 lazy load → `MissingGreenlet: greenlet_spawn has not been called`，且该异常常发生在 except 块自身，把原异常吞成误导性的 greenlet 报错（2026-10-12-session-defects task-08 实证：auto_resume 压缩失败分支 rollback 后记日志访问 agent_run.id 连环爆）。修法：进入可能 rollback 的 try 前把异常路径需要的标量先捕获（`co_run_id = str(agent_run.id)`），rollback 后需要对象时经 `await session.get(Model, pk)` 异步重载再操作。来源：task-08（commit 954cb88f 修正过程）。

（fake timers waitFor 条目已确认，迁出至 testing-gotchas.md——2026-10-13-session-change-files-hover 归档）

## 【待确认】require_permission 隐式 Path(workspace_id) 依赖：平台级（无 ws 前缀）端点直接 422

`auth_deps.require_permission(Permission.X)` 的 checker 签名含 `workspace_id: Annotated[uuid.UUID, Path(...)]`——路由路径里没有 `{workspace_id}` 时 FastAPI 请求校验直接 422（`loc=["path","workspace_id"]`，报错像路由冲突极具迷惑性；本变更新端点 GET /api/deploy-records 实测踩中，路由匹配调试零收获）。平台级端点（聚合多 workspace / 无 ws 前缀）应使用 `require_permission_any`（auth_deps.py 注释口径「used by APIs without ws_id」）。判别信号：422 details 里 loc 指向 path 参数名而非业务字段。来源：2026-10-14-deploy-release-notes task-02（router.py 注释留痕）。

## 【待确认】.zcode 部分 skill 文件在 main 是已跟踪文件：git rm --cached 会把分支做成「删除态」

`.zcode` 整体在 .gitignore，但 sillyhub-docker-deploy 等 skill 文件历史上已入库跟踪（gitignore 对已跟踪文件无效；`git ls-tree main -- <path>` 可判）。worktree 里改这类文件后 `git add` 被拒（按 ignore 规则报错，需 -f）；若误跑 `git rm --cached` 再 amend，分支相对 main 变成 375 行全删——merge 会把 skill 文件从 main 抹掉。正确姿势：确认 tracked 后 `git add -f`，diff main..HEAD --stat 应显示 +N 修改而非 N deletions。来源：2026-10-14-deploy-release-notes task-06 收口提交实操。

## monkeypatch has_permission 必须双 patch（auth_deps 导入时绑定 + rbac 模块属性）
`backend/app/core/auth_deps.py:40` 是 `from app.modules.auth.rbac import has_permission`（导入时绑定）——只 patch `app.modules.auth.rbac.has_permission` 不会影响 `require_permission` 门控依赖（改的是 rbac 模块属性，auth_deps 里的名字仍指向原函数，403 用例会被放行成 200）；只 patch `auth_deps.has_permission` 又管不到端点函数内联 `from app.modules.auth.rbac import has_permission` 的取值源。写权限相关端点测试（mock 放行/拒绝）时两处都要 patch（来源 task-02，2026-10-15-platform-knowledge-search；实证：test_knowledge_search_requires_knowledge_read 首轮 200 未 403）。

## 并行会话删主仓 frontend/node_modules 顶层链接——worktree 与主仓前端全瘫（vitest not found）
现场：worktree frontend 的 node_modules 是指向主仓的 junction；主仓 node_modules 顶层目录从数百个被删到 26 个（.bin 消失、顶层包链接消失，仅 .pnpm store 完好）。症状链：worktree `pnpm exec vitest` 报 vitest not found；绕 .pnpm 直连 `node vitest.mjs` 报 Cannot find module 'vitest/config'（模块解析链断，绕不过）。修复：worktree frontend 内 `pnpm install --force`（经 junction 重建主仓顶层链接；普通 install 可能命中缓存不修——规则 21 既有口径）后再 `pnpm install` 补全；修完主仓与 worktree 均恢复。判断根因是并行会话的 install/清理动作打到共享 node_modules——多会话共用主仓 node_modules 时这是结构性竞态，建议会话内避免任何 node_modules 级清理（来源 task-05，2026-10-15-knowledge-search-pgvector 实证）。

## 生产小内存服务器（1.6G）容器内跑大模型嵌入不可行——本机嵌入+SSH 隧道直写生产库 + 六连坑
2026-10-15-knowledge-search-pgvector 部署实证。**核心结论**：backend 容器 mem_limit 800m（后提 1100m）内跑 fastembed 全量嵌入（6712 chunks）被 cgroup OOM 连续杀（模型 ~350M + 服务本体 515M 合计超容器限额；杀掉的是 cgroup 内最大进程，dmesg 有 "Memory cgroup out of memory" 可查）。**终解** = 本机（20 核）嵌入 + `ssh -L 15432:<PG容器IP>:5432` 隧道直写生产 DB（228.7s 全量建库一次完成），服务器容器只跑查询。**六连坑**（同批量部署会再踩）：① 容器内后台进程用 `docker exec` 不加 `-d` 会随 ssh 会话结束被杀（长任务必须 `docker exec -d` + 容器内日志文件轮询）；② `docker cp` 进容器的脚本随容器重建蒸发（命令链须先 cp 再跑）；③ 模型缓存挂载目录必须容器 uid 可写（chown/chmod——否则 fastembed 静默卡死加载，无报错）；④ PG 容器端口未映射宿主（known-issues 既有），ssh -L 转发目标必须写**容器 IP** 而非 127.0.0.1；⑤ SQLAlchemy `with_variant` 列取不到方言方法（`embedding.cosine_distance` 在 JSON 基类型 InstrumentedAttribute 上不存在）——PG 专有算子走原生 `text()` SQL + `CAST(:qv AS vector)`；⑥ 决策库跨变更重号 + 模板化同标题条目（多个「## D-001@v1 风险与死路（design 槽4 收割）」）使 `(workspace_id, spec_path, anchor, title)` 唯一约束在真实语料下必撞——切块键改行号坐标 `(spec_path, start_line)` 或去 uq。

## 平台 spec 清单唯一索引静默损坏（容器反复被杀后遗症）——归档后平台仍显示「进行中」+ spec-sync 恒 422
现象：变更本地已归档并推送，平台变更中心仍显示进行中、不在归档列表；CLI 文件树同步恒 HTTP 422（「同步包无效：源文件缺失的重命名操作必须携带文件内容」），而终态墓碑（status=archived）上行正常。根因：生产 `spec_file_manifest` 的 `ux_spec_manifest_ws_path (workspace_id, path)` 唯一索引**静默损坏**（索引缺项——走索引查不到实际存在的行，谓词相同、禁索引强扫即命中），apply_ops 预取 miss → rename 被判 R-07「源文件缺失」→ 422。坏索引同时放行了重复插入：4 个高频热文件（knowledge/INDEX.md、decisions/backend.md、frontend.md、scan/CONVENTIONS.md）各混入 1 条 v1/v2 幻影行（upsert 漏检变 INSERT）。amcheck 全库扫描再揪出 **17 个额外坏索引**（RBAC/changes/workspaces/scan_docs/change_documents 等唯一索引——「item order invariant violated」「high key invariant violated」），共 18 个；唯一表查重仅 spec_file_manifest 有重复。护栏：① 容器反复被杀/重启风暴后必须对 DB 跑 `CREATE EXTENSION amcheck` + 逐索引 `bt_index_check(oid, true)`（heapallindexed 专查「堆有行、索引缺项」，本例 360 索引扫出 18 坏）；② REINDEX（CONCURRENTLY 亦然）报 "could not create unique index ... duplicated" = 坏索引已放行重复行的信号——先备份→按 max version 保留真身去重→再重建（去重 DELETE 也要禁索引扫描，防走坏索引漏删）；③ 索引损坏的指纹：同一谓词「带索引 0 行 / 禁索引 1 行」且逐条件单独查都命中——遇 SQL 语义矛盾先怀疑索引；④ 平台「归档后仍进行中」排查序：终态墓碑是否上行 → 文件树 spec-sync 是否 200 → DB manifest 是否有 changes/archive/ 行。证据：备份表 `spec_file_manifest_dup_backup_20261016`（8 行）留档服务器；修复后 amcheck checked=360 bad=0；重推同步 26 文件落地（archive 25 行/active 0 行）。

## 平台知识搜索「首搜建库地雷」——未建索引工作区的第一次搜索必超时（大语料 OOM 整栈停摆）
2026-10-16 生产实证（第二次容器内嵌入事故）：用户在平台搜 sillyspec 工作区 → 该 ws 无 knowledge_search_state 行 → 懒同步走全量建库 → 容器内嵌入（mem_limit 1100m 也扛不住 6625 chunks）→ backend OOM(137) 被杀 → 整栈随后被手动停掉。**小语料也一样超时**：2 核嵌入速率 ~2.6 chunks/s，几百 chunks 就是数分钟，nginx 掐断连接后 uvicorn 取消请求任务 → 建库事务回滚 → 重试永远从头再来——**未建索引的 ws 搜索永远 504/超时**。运维解（本次实证）：从服务器 tar 拉 ws 语料（knowledge+docs）到本机 → `prod-index-batch.py` 模式（隧道直写生产库，embedder 单次加载循环建库，108 md/7 ws 共 28.7s）批量预建；指纹含 mtime 但 tar 保 mtime + 内容 hash 吸收漂移，建完服务器首查 0.8s 直查零重建。**根治缺口（待代码变更）**：`search_sync`/端点应支持「服务器禁建库」开关（如 KNOWLEDGE_SEARCH_SERVER_BUILD=0 → 无 state 行时跳过建库直接词面降级 + reason=index_not_built），新工作区首搜不再地雷；建库一律外部机器（本机隧道）预建。
