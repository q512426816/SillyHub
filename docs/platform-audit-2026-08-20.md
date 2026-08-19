# 平台全量审计问题清单（2026-08-20）

> 审查方式：6 个子代理并行交叉审查（后端安全 / 后端质量性能 / 前端 / sillyhub-daemon / SillySpec 契合度 / 仓库卫生部署），主代理对 P0/P1 逐条人工复核（读源码确认）。
> 复核标记：✅ = 主代理已读源码确认属实；🤖 = 子代理证据充分未逐行复核。
> 状态：待修复 / 已修复 / 不修（含理由）。

## 一、P0（可直接利用的严重漏洞）

| ID | 问题 | 位置 | 复核 | 状态 |
|----|------|------|------|------|
| DA-1 | daemon shell 回退路径 spawn 参数零转义：`.bat/.ps1/wrapper` 及 `.cmd` 解析失败时走 `shell:true`，cursor 分支把用户完整 prompt、backend 下发的 model 作位置参数拼进 cmd.exe 命令行，含 `&`\|`>` 等元字符即命令注入 | sillyhub-daemon/src/task-runner.ts:1183-1193、src/adapters/stream-json.ts:290-308 | ✅ | 已修复（2026-08-20）|

## 二、P1（安全/数据完整性/阻塞 CI）

### 后端安全

| ID | 问题 | 位置 | 复核 | 状态 |
|----|------|------|------|------|
| BS-1 | 管理员建户与重置密码用硬编码默认口令 `SillyHub@123`，无首登改密，知道源码即可接管任意新建/重置账号 | backend/app/modules/admin/users_service.py:50,223,784 | 🤖 | 已修复（2026-08-20）|
| BS-2 | spec 同步 tar 解包 `filter="fully_trusted"`：成员名预检在解包前做（符号链接未落盘，resolve 识不破），「先符号链接成员→再经其写文件」可逃逸 staging 实现任意文件写 | backend/app/modules/spec_workspace/service.py:719 | ✅ | 已修复（2026-08-20）|
| BS-3 | 登录限流 IP 取 XFF 最左段（客户端自报可伪造），换假 IP 即绕过 5 次/分钟限流+失败计数+验证码 | backend/app/modules/auth/router.py:46-56 | ✅ | 已修复（2026-08-20）|
| BS-4 | PPM plan 子域写接口仅认证不授权（IDOR）：里程碑 ps_plan_node、里程碑明细、模板 PlanNode/PlanNodeDetail/PlanNodeModule 的 update/delete 无归属校验，任意登录用户可改删全平台计划数据（PPM 已上线） | backend/app/modules/ppm/plan/router.py:224-296,397-409,595-608,708-719 + service.py 对应方法 | ✅ | 已修复（2026-08-20）|

### 后端质量/性能

| ID | 问题 | 位置 | 复核 | 状态 |
|----|------|------|------|------|
| BQ-1 | 任务计划 Excel 导出走分页 page_size=200 静默截断，超 200 行丢数据无提示（工时导出走 list_for_export limit=5000，不一致） | backend/app/modules/ppm/task/router.py:244-267 | ✅ | 已修复（2026-08-20）|
| BQ-2 | knowledge 服务 4 个 async 方法同步全树解析（rglob+read）占事件循环；get 单个文件也全量重扫（scan_docs 已改线程版，此处漏改） | backend/app/modules/knowledge/service.py:50,57,72,78 + parser.py:34-41 | 🤖 | 已修复（2026-08-20）|
| BQ-3 | `create_change` async 内同步 mkdir + 3 次 write_text 占事件循环（同文件 267-270 已按规范用 to_thread，自相矛盾） | backend/app/modules/change_writer/service.py:144-158 | 🤖 | 已修复（2026-08-20）|
| BQ-4 | 周计划导出模板 `Path("templates/...")` 依赖 CWD，仅 Docker WORKDIR=/app 下成立，仓库根启动即 FileNotFoundError（违反跨平台规则 13） | backend/app/modules/ppm/plan/router.py:920 | 🤖 | 已修复（2026-08-20）|

### 前端

| ID | 问题 | 位置 | 复核 | 状态 |
|----|------|------|------|------|
| FE-2 | `tsc --noEmit` exit 1：测试文件引用组件已删除的 `__setBindingMap` 导出（TS2305）+ unknown→ReactNode（TS2322），阻塞 CI 类型门禁 | frontend/src/components/sessions/__tests__/new-session-form.test.tsx:47,97,858,927、workspace-session-picker.test.tsx:66 | ✅ | 已修复（2026-08-20）|

### daemon

| ID | 问题 | 位置 | 复核 | 状态 |
|----|------|------|------|------|
| DA-2 | `get_spec_bundle` RPC 无 allowed_roots 守卫，恶意/失陷 backend 可打包宿主任意路径 `.sillyspec` 整树外传（同文件其余 host_fs handler 均有校验） | sillyhub-daemon/src/daemon.ts:2383-2395 | ✅ | 已修复（2026-08-20）|
| DA-5 | shell:true 路径下 `_killChild` 只杀 cmd.exe 包装层，agent 孙进程成孤儿继续烧 token（runtime-handler 已有 taskkill /PID /T /F 范式未复用） | sillyhub-daemon/src/task-runner.ts:2234-2241 | ✅ | 已修复（2026-08-20）|

### CI

| ID | 问题 | 位置 | 复核 | 状态 |
|----|------|------|------|------|
| HY-1 | sillyhub-daemon 144 个测试文件无任何 CI（backend/frontend CI 齐全），daemon 承担文件系统与策略执行属安全敏感组件 | .github/workflows/ | 🤖 | 已修复（2026-08-20）|

### SillySpec 契合度

| ID | 问题 | 位置 | 复核 | 状态 |
|----|------|------|------|------|
| SS-1 | 工具 doctor 僵尸/孤儿对账依赖外部 sqlite3 CLI（本机无），catch 静默回退 known=∅ → 必然把全部活跃目录误报「孤儿目录（可清理）」并指引 rm -rf；应改用仓内 db-engine.js(node:sqlite) | sillyspec/src/stages/doctor.js:69,50,71,357 | 🤖 | 已修复（2026-08-20）|
| SS-2 | stage-machine 提示「可用 doctor 清理」幽灵行，但 doctor 对幽灵行仅 WARNING 无清理动作 → 主仓 52 条残留记录永远清不掉（提示与能力不符） | sillyspec/src/progress/stage-machine.js:184,191 + doctor-diagnostics.js:391 | 🤖 | 已修复（2026-08-20）|

## 三、P2（应修）

| ID | 问题 | 位置 | 状态 |
|----|------|------|------|
| BS-5 | OpenAPI 三端点（/api/docs /redoc /openapi.json）无条件开放，匿名可枚举全部攻击面 | backend/app/main.py:192-194 | 已修复（2026-08-20）|
| BS-6 | /api/system-status 匿名返回用户数/业务统计/CPU内存磁盘 | backend/app/modules/health/router.py:80-126 | 不修（首页看板匿名用，需产品决策，另开变更） |
| BS-7 | MinIO 凭证默认 minioadmin/minioadmin 无告警 | backend/app/core/config.py:255-256 | 已修复（2026-08-20）|
| BS-9 | Content-Disposition ASCII 回退 filename 未转义引号（file/explorer 两处） | backend/app/modules/file/router.py:106、explorer/router.py:92 | 已修复（2026-08-20）|
| BS-10 | worktree clone 失败 stderr 原样回传可泄内嵌 token 的 repo URL | backend/app/modules/worktree/git_runner.py:88-91 | 已修复（2026-08-20）|
| BS-11 | backend/.env 有 4+ 键不在 .env.example（SILLYSPEC_MASTER_KEY 等），部署漏配走降级 | backend/.env.example | 已修复（2026-08-20）|
| BS-12 | 自改密码无复杂度校验（bootstrap 有黑名单未复用） | backend/app/modules/auth/schema.py:51 | 已修复（2026-08-20）|
| BQ-5 | 6 个模型 naive `datetime.utcnow` 与全库 aware 混用（需配 alembic 迁移） | incident/worktree/git_gateway/git_identity/llm_provider/tool_gateway 的 model.py | 不修（涉及 DB 数据迁移+全链路比较逻辑，需完整 SillySpec 变更） |
| BQ-6 | mission scope 预检 N+1（每 workspace 1-2 查） | backend/app/modules/agent/router.py:1147-1171 | 不修（性能优化需基准测试，另开变更） |
| BQ-7 | gate 孤儿回收逐行 session.get(Change) | backend/app/modules/change/dispatch.py:1249-1253 | 已修复（2026-08-20）|
| BQ-8 | 「查 SpecWorkspace 失败 except:pass」样板复制 ≥7 处，DB 故障静默降级无日志 | knowledge/quicklog/scan_docs/change/dispatch/workspace/agent 各 service | 不修（抽公共 helper 属重构，另开变更） |
| BQ-9 | 问题变更导出无上限全表 SELECT 进 Excel | backend/app/modules/ppm/problem/service.py:965-971 | 已修复（2026-08-20）|
| BQ-10 | create_tables.py 过期（缺 19 个模块模型，索引只在 alembic），误导新环境初始化 | backend/create_tables.py | 已修复（2026-08-20）|
| BQ-11 | seed_workbench_demo.py 一次性演示种子残留 | backend/seed_workbench_demo.py | 已修复（2026-08-20）|
| BQ-12 | ppm 两个 router 逐行相同的 _build_excel_response + 12 处 SessionDep 别名重复 | backend/app/modules/ppm/plan/router.py:1022、problem/router.py:672 | 已修复（2026-08-20）|
| BQ-14 | 工时导出端点伪装分页参数（page_size=20 无效果） | backend/app/modules/ppm/task/router.py:634 | 已修复（2026-08-20）|
| FE-3 | stage-team-config.tsx 生产零引用（含孤儿测试） | frontend/src/components/stage-team-config.tsx | 已修复（2026-08-20）|
| FE-4 | workspace-binding-dialog.tsx 仅存在于注释（含孤儿测试） | frontend/src/components/workspace-binding-dialog.tsx | 已修复（2026-08-20）|
| FE-5 | use-agent-runs.ts 空占位文件 | frontend/src/lib/use-agent-runs.ts | 已修复（2026-08-20）|
| FE-9 | 审批卡每卡无条件 1s setInterval 永不停，多卡同屏每秒 N 次重渲染 | frontend/src/components/permission-approval-card.tsx:74 | 已修复（2026-08-20）|
| DA-3 | list_dir/list_roots RPC 显式豁免白名单，backend 可枚举全盘目录结构 | sillyhub-daemon/src/daemon.ts:2364-2373 | 不修（目录浏览器设计豁免，加开关需产品决策，记录） |
| DA-4 | host_fs 穿越校验只做词法 pathResolve 不解析 symlink/junction（path-utils 已有 resolveRealPath 未用） | sillyhub-daemon/src/host-fs-handler.ts 多处 | 已修复（2026-08-20）|
| DA-6 | host_fs.run_command env 合并允许覆盖 PATH → 白名单命令可被解析到任意可执行文件 | sillyhub-daemon/src/host-fs-handler.ts:1015-1035 | ✅待修复（剔除 PATH/PATHEXT/SystemRoot） |
| DA-7 | config.json 含 api_key/token 明文且无 0600（credentials.json 有） | sillyhub-daemon/src/config.ts:578-586 | 已修复（2026-08-20）|
| DA-9 | codex close() fire-and-forget 未 await，终态上报先于进程清理 | sillyhub-daemon/src/interactive/session-manager.ts:2297 | 不修（低风险，另开变更顺手做） |
| DA-10 | WS RPC 分发无在途上限，可被打满 | sillyhub-daemon/src/ws-client.ts:427 | 不修（需设计信号量策略，另开变更） |
| DA-11 | src/index.ts W0 占位注释严重失实 + .gitkeep 残留 | sillyhub-daemon/src/index.ts | 已修复（2026-08-20）|
| DA-12 | spikes/06-mcp-server 已结题吸收进 src 仍被跟踪 | sillyhub-daemon/spikes/06-mcp-server/ | 已修复（2026-08-20）|
| DA-13 | toRpcError 两份「字符级对齐」复制实现 | sillyhub-daemon/src/file-rpc.ts:208、host-fs-handler.ts:220 | 已修复（2026-08-20）|
| DA-15 | agent-detector 用 exec 引号拼接跑 --version，与 cmd-shim 体系脱节 | sillyhub-daemon/src/agent-detector.ts:358-364 | 已修复（2026-08-20）|
| HY-4 | meta.json（worktree 状态文件含他机绝对路径）被 git 跟踪，几乎每次提交变动 | 根目录 meta.json | 已修复（2026-08-20）|
| HY-5 | dev compose postgres/redis/minio 端口无 127.0.0.1 前缀 + 弱默认口令（prod 已收紧，dev 未同步） | deploy/docker-compose.dev.yml | 已修复（2026-08-20）|
| HY-6 | litellm-db 密码保留弱默认 litellm（同文件其余均 :?must set） | deploy/docker-compose.yml:184,218、dev.yml:62,84 | 已修复（2026-08-20）|
| HY-7 | .env.example 管理员密码为可用弱口令 Admin123!@#，README 只提醒改 SECRET_KEY | deploy/.env.example:99 | 已修复（2026-08-20）|
| SS-3 | 工具仓 3 个未提交完整特性（taskcard/worktree-apply/gates CRLF）借 symlink 生产运行，npm 正式 3.26.12 不含 | sillyspec 仓未提交改动 | 已修复（2026-08-20）|
| SS-4 | 主仓 .sillyspec：52 条幽灵记录 + 12 孤儿目录 + 5 份 .bak(4MB) + ~100 run-id 残留 + 空嵌套 .runtime/.sillyspec | .sillyspec/ | 已修复（2026-08-20）|
| SS-5 | 2026-08-19-sessions-workspace-selector 活跃 change（meta.json 指向）无 DB 行 | .sillyspec/changes/ | 已修复（2026-08-20）|

## 四、P3（低成本顺手修）

| ID | 问题 | 位置 | 状态 |
|----|------|------|------|
| HY-8 | actions/checkout 版本不一致（v6.0.2 vs v4） | .github/workflows/ | 已修复（2026-08-20）|
| HY-9 | backend-ci 注入不存在的 DATABASE_URL/REDIS_URL 死配置 | backend-ci.yml:50-51 | 已修复（2026-08-20）|
| HY-10 | scripts/test_scan_drift_check.py 测试无 CI 执行 | scan-drift.yml | 已修复（2026-08-20）|
| HY-11 | Makefile help 漂移 + daemon-* 四目标漏 .PHONY | Makefile | 已修复（2026-08-20）|
| HY-12 | 根 node_modules/ 孤儿（无 package.json，仅 .vite 缓存） | 根目录 | 已修复（2026-08-20）|
| HY-13 | .sillyspec-platform-cleaned 已 tracked，gitignore 规则失效 | 根目录 | 已修复（2026-08-20）|
| HY-14 | README 漂移 3 处（服务数、make test/lint 描述、结构图缺目录） | README.md | 已修复（2026-08-20）|
| FE-8 | aggregations.ts 全仓唯一显式 any | frontend/src/lib/ppm/aggregations.ts:119 | 已修复（2026-08-20）|

## 五、本地物理垃圾（不入 git，直接删）

- `deploy/images.tar.gz` 343MB（docker save 产物，可由脚本重建）
- 根目录 `.venv-spike/ .mypy_cache/ .pytest_cache/ .ruff_cache/ .playwright-mcp/ .worktrees/ .coverage` 约 52MB（均已 gitignore）

## 六、明确不修（记录理由）

| ID | 理由 |
|----|------|
| FE-1 | refreshToken 存 localStorage 是 design §3 既定权衡（已否决 middleware 方案），有单飞刷新+重试防护；中期演进 httpOnly cookie，需完整变更 |
| BS-8 | SSRF DNS 重绑定窗口需自定义 transport 做 IP pinning，需 spike 验证 |
| BQ-13 / DA-14 | 5 个 500 行级后端函数 + 3 个 3000-4000 行 daemon 文件拆分属大重构，走完整 SillySpec 流程 |
| FE-6 | ui/card.tsx 零引用但属 shadcn kit 完整性，保留 |
| FE-7 | 组织树双胞胎组件合并属重构 |
| FE-10 | 4 个 PascalCase 组件改名属纯风格，git mv 会污染 blame，下次动到再改 |
| HY-15 | .codex/skills 落后 3 条目，若非全量镜像则无需同步（待确认定位） |
| BS-6 | system-status 匿名是首页看板既定用法，收紧需前端配合 |

## 七、修复批次规划

1. **批次 A（后端安全）**：BS-2、BS-3、BS-4、BS-1、BS-9、BS-10、BS-12
2. **批次 B（后端质量）**：BQ-1、BQ-4、BQ-2、BQ-3、BQ-7、BQ-9、BQ-14、BQ-10、BQ-11、BQ-12、BS-5、BS-7、BS-11
3. **批次 C（daemon）**：DA-1、DA-2、DA-5、DA-6、DA-4、DA-7、DA-11、DA-12、DA-13、DA-15
4. **批次 D（前端）**：FE-2、FE-3、FE-4、FE-5、FE-9、FE-8
5. **批次 E（卫生/CI/部署）**：HY-1~HY-14、本地垃圾删除
6. **批次 F（SillySpec 工具+契合度）**：SS-1、SS-2（工具仓修复+提交）、SS-4、SS-5（主仓状态清理）

> 状态更新随修复进度回填本文件。
>
> **2026-08-20 修复收尾**：P0×1 + P1×12 + P2/P3 快赢项全部修复并分 5 个 quick 提交
> （ql-20260820-002~005 + 工具仓 12515f8）。验证基线：后端全量 pytest 4642 通过
> （19 failed/20 errors 基线债同步清零）、daemon vitest 2447 通过、前端 vitest 1695
> 通过 + tsc 0 错；ruff/mypy 全绿。遗留大重构项见「六、明确不修」。
