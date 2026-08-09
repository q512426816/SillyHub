---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 5a00fc7e
updated_at: 2026-08-08T15:12:18Z
generator: sillyspec-scan
---

# 关注点(Concerns)

本文件只列真实问题,依据为审计文档、代码质量加固记录与 grep 到的 TODO/FIXME/deprecated。按严重度用 🔴 / 🟡 / 🟢 分组。代码仍在演进,动手前请核实行号是否漂移(`docs/agent-platform-deep-audit-2026-07-12.md` 性质为带 file:line 的事实文档)。

## 🔴 严重(正确性 / 进度跟踪失效)

- **sillyspec.db changes 表为空**:进度跟踪系统失效(2026-07-03 重建 db 后未关联既有目录),`status / continue / resume` 失灵(同上 🔴 P0)。

### 2026-08-08 多代理审计 · 安全(越权 / 凭证泄漏 / 注入)

- **后端主密钥随子进程环境泄漏**:`tool_gateway` 的 shell_exec/run_tests(`service.py:364,414` 的 `create_subprocess_exec` 不传 env)与 `git_gateway.execute`(`service.py:184-190` 显式 `{**os.environ,...}` 注入 git 子进程,且不设 `GIT_CONFIG_GLOBAL/SYSTEM/ASKPASS`,worktree 的 `.git/config`/hooks 可被 agent 改写)使子进程继承 backend 全量环境,含 `SILLYSPEC_MASTER_KEY`(KEK,加密全部 git token / LLM api key)与 `DATABASE_URL`,一条 `printenv` 即可离线解密全平台凭证;项目已有 `worktree/exec_env.py:118 ExecEnvBuilder.build_env_vars()` 最小 env 隔离,唯独这两条路径漏接。
- **授权引擎 `workspace_id=None` 退化(系统性越权根因)**:`core/auth_deps.py:110-125`(require_permission_any 传 workspace_id=None)+ `auth/rbac.py:128-130`(has_permission 调 collect_permissions_all 取所有 workspace 权限并集)。资源级路由(按 release_id/incident_id 等操作、路径无 workspace_id 段)退化成"任一 workspace 持权即放行"→ 跨工作空间 IDOR;`release/router.py:48-56,79-86` 的 list_releases/list_approvals 连 require_permission_any 都没挂(任意登录用户可遍历任意 ws 的发布/审批)。当前仅靠种子角色 is_system + 成员白名单兜底,引擎层无平台/工作区权限区分。
- **`user:write` 持有者可提权为平台超管**:`admin/users_service.py:291-412`(update_user 仅 last-admin 保护,无支配权校验)+ `:160-235`(create_user 直接收 is_platform_admin/role_ids)+ `_validate_roles:474-491`(只校验角色存在)。任意 user:write 持有者可把自己/他人 `is_platform_admin` 翻 true 或绑 `platform_admin` 角色;叠加默认口令 `SillyHub@123`(`users_service.py:48`,create/reset 缺省密码恒为此常量,`force_change_on_next_login` 收了字段却从不强制)可建超管后用已知口令登录。
- **PPM(已上线)系统性写授权缺失**:PPM 路由只用 `get_current_principal`(纯认证),service 层多处不校验归属。最严重——项目成员自提权:任意用户 `POST /api/ppm/project-member`(`project/router.py:430-470`+`service.py:530-589`)把自己加成"项目经理"即获该项目全部数据可见权 + 工作区绑定管理权。写 IDOR 簇:problem start/execute(`service.py:512,568` 仅校验状态)、task 全部写、plan 子资源全部写(`_assert_can_operate` 全文件仅 2 处调用)、kanban 全部写(`PPM_KANBAN_VIEW` 权限已定义 `permissions.py:140` 从未使用)、project update/delete(`router.py:103-128`)。批量越权读:problem list-by-date-range(`service.py:349-370`)、plan 详情/导出(含合同金额/利润率)、task-execute、work-hour 导出(≤5000 行)均不带 data_scope。problem-change 审批流(`router.py:515-658`)前端已停用但后端仍生效且无授权。plan import_commit(`service.py:1652-1776`)信任前端回传 duty_user_id/valid,可向任意用户注入任务(对比 problem import_commit 正确地服务端重查)。
- **发布审批门可绕过**:`release/service.py:84-112`(create 不校验 `deploy_policy.min_approvers` 下界,可设 0 = 零审批部署生产)+ `:269-288`(_require_approvals 只数 approve 票,reject 完全不阻断)。
- **spec tar 软链接 → 后端任意文件读**:`spec_workspace/service.py:524-559`(_extract_spec_tar_to_staging 用 `filter="fully_trusted"` + 只校验 m.name 不校验 linkname、不跳过 symlink)+ `:616`(read_bytes 跟随软链)。含恶意软链的 tar 可把 `/etc/passwd`、`.env`、`sillyspec.db` 读入 scan_documents.content 经文档接口外泄;无单文件大小上限(DoS)。
- **change_writer doc_type 路径穿越写**:`change_writer/service.py:243-251`(doc_type 仅 min/max_length,未命中白名单时直接当文件名拼接)+ `schema.py:35`。`doc_type="../.."`(≤30 字符)可从 change_dir 一路 `..` 到 `/data` 任意位置 `write_text` 攻击者控制内容;content 字段无 max_length。
- **tool_policies 执行路径完全失效**:`tool_gateway/router.py:34-36`(execute_tool 不传 policy)+ `service.py:148-149`(policy is None → default_policy 全放行);文档引用的 `_load_policy` 方法不存在。管理员配的 blocked_commands/allowed_domains/allowed_tools/max_timeout 从不生效。
- **前端 Markdown 存储型 XSS**:`frontend/src/components/ui/markdown-text.tsx:20-34`(未配 rehype-sanitize、未限 href 协议;库 `@uiw/react-markdown-preview` 默认开 rehype-raw)。agent 输出/自定义技能/扫描仓库文档/会话日志中的任意 HTML 直接执行;配合 localStorage 的 JWT + 明文密码(见下)可接管账号。渲染点:agent-log-viewer.tsx:448、interactive-session-panel.tsx:1353/1506/1578、custom-skill-edit-dialog.tsx:265、scan-docs/page.tsx:282。
- **登录明文密码存 localStorage + 默认 admin/admin123**:`frontend/src/app/(auth)/login/page.tsx:46-53`("记住密码"明文 setItem)+ `app/m/login/page.tsx:106,134`(移动端同);源码默认值 `admin/admin123` 写进 bundle。

### 2026-08-08 多代理审计 · 资源泄漏 / 状态机

- **后端无周期性 sweeper(lease/会话/daemon 回收全失效)**:`daemon/lease/service.py:934`(handle_expired_leases_batch)、`lease_service.py:285`(alert_stuck_terminating_leases,kill-channel-unify task-11/XC-08)、`runtime/service.py:826`(cleanup_stale_runtimes)、interactive idle-session 清扫——全部只有定义和测试调用,零生产调度(无 APScheduler/Celery/后台 asyncio 循环;`main.py:71` lifespan 仅启动时一次性 cleanup_stale_runs,且只把 running AgentRun 标 failed)。daemon 崩溃后 lease 永远 claimed、AgentRun 永远 running,直到 backend 重启;kill 通道的 terminating_at 可观测性(task-11)在 prod 完全不可见。
- **worktree 资源 + 明文凭证永久泄漏(多源)**:① single/GLM 模式 mission 的 per-worker worktree 永不清理:`agent/execution.py:217-268`(建 worktree)+ `finalizer.py:405-409`(cleanup_mission 仅查 status==completed)+ 唯一调用方 `mcp_tools.py:614`/`mcp_gateway/tools.py:624` 经 `_get_main_run` 要求有 orchestrator run(single/GLM 无)→ 每条默认 mission 泄漏最多 5 个 worktree+分支。② WorktreeService 无任何按 expires_at 回收的调度(`worktree/service.py` 全文件无 reclaim/gc;`ix_worktree_expires` 索引建了从不查):过期/孤儿 lease DB 行恒 locked、文件系统(bare 克隆+worktree+gitconfig+askpass 凭证文件)永久驻留;Windows 端 `askpass.cmd` 不设 ACL(`worktree/exec_env.py:86-107`)宿主可读明文 PAT。③ change reparse 硬删 change 行级联删 agent_runs(FK CASCADE,审计数据丢失)+ worktree_leases DB 行级联删但磁盘凭证文件留孤儿(`change/service.py:1106-1109`)。
- **mission 假收敛(converged_at 早置位)**:`agent/finalizer.py:531-553`(R5 原子 claim+commit 在 finalize_execute_mission 之前)+ `daemon/lease/service.py:613-628`(complete_lease try/except 吞 converge 异常)。finalizer 抛错时 converged_at 已写、分支未合并/产物未生成/cleanup 未跑,且后续重入 rowcount==0 不再重试 → mission 静默卡"已收敛未合并"。
- **预算强收制造僵尸 lease(kill 通道回归)**:`agent/orchestrator.py:364-377`(forced_degraded 把 running worker 直接 status=killed,注释自承"纯标记终态无 lease 上下文")不调 cancel_lease,daemon 侧 lease 仍 claimed、agent 继续烧 token。与已记 `control.py:76-80` 同预算主题但属另一处(orchestrator 而非 control),性质是"主动假杀",是 kill-channel-unify(P0-2)已修复僵尸模式在新代码路径的回归。
- **scan 派发留永久孤儿 lease**:`agent/placement.py:891`(notify_interactive_dispatch 目标 daemon 离线但有其它在线时广播返回 True)+ `daemon/session/service.py:580,632`(create_session 把 delivered=True 当成功,向离线 daemon 发 SESSION_INJECT 失败仅 log.warning 不收敛)+ interactive lease `lease_expires_at=NULL`(`lease/service.py:771`,expire_leases 跳过)→ 会话留 active、run 留 pending、lease 永久悬挂(叠加无 sweeper 永不回收)。
- **Node daemon 停止/崩溃时子进程不终止**:`sillyhub-daemon/src/cli.ts:1020-1025`(全局 handler 只 logFatal 不杀子进程)+ `daemon.ts:950-1007`(stop 不 cancel 在跑 lease、不 close 交互 session)+ `daemon.ts:2120/2500`(_fire 丢 signal)+ 全仓无 `process.on('exit'/'beforeExit')`。优雅关停挂死(等所有 batch agent 跑完,最长 1800s);硬杀后 claude/codex 子进程变孤儿继续烧 token。
- **Codex 交互第二轮必崩**:`sillyhub-daemon/src/interactive/input-queue.ts:135-139`(第二次 asyncIterator 抛 SessionQueueDoubleSubscribeError)+ `codex-app-server-driver.ts:1000-1007`(_takeNextTurn 每 turn 重新订阅)。第 2 turn 必抛错→onError→session failed;单测用伪 makeInputQueue 不带守卫掩盖。
- **reload 并发产生孤儿 Claude 子进程**:`sillyhub-daemon/src/interactive/session-manager.ts:2596-2747`(reloadWithProvider 无 mutex/in-progress 守卫,status 保持 active)+ 两 fire-and-forget 触发点(~2535 空闲路径、~2892 turn 边界)。并发 reload 重叠时中间状态的 Claude 子进程(Q2)永不被 close、consume 协程僵尸,token 失控+进程泄漏线性堆积。
- ✅ 已修复(ql-20260809-003-56db) **promote 端点死路由(恒 422)**:`release/router.py:103-114`(路径无 `{workspace_id}` 占位符,但 require_permission(DEPLOY_STAGING) 依赖声明 workspace_id 必填)→ 每次请求 422 `{path:[workspace_id] Field required}`。staging 发布永久卡 draft(fastapi 0.136 已复现)。

## 🟡 中等(半成品 / 待部署 / 体验缺口)

- **预算控制只挡新派发不杀在跑的**:`backend/app/modules/agent/control.py:76-80` `can_dispatch_worker` 仅 pre-dispatch 门,已派出的 worker 不再检查,可烧穿预算;`budget_tokens` 字段全代码无任何强制点(审计发现 4 / P2-1)。
- **diff_summary 字段早有但前端零展示**:`frontend/src/lib/agent.ts:24` 已含字段,后端 `diff_collector.py` 产出,全前端仅 `tasks/[tid]/page.tsx:749-753` 一行纯文本展示(审计 P1-3)。
- **待部署验证的 migration**:daemon-entity-binding 等多个变更的 PostgreSQL migration 待 apply + 端到端部署验证;并行变更新 migration 易撞 revision/down 分叉致多 head → 启动 crash-loop(SQLite 抓不到,PG 才暴露)(`ROADMAP.md` 🟠 P1)。
- **A6 缓存 token 聚合不一致**:`sillyhub-daemon` 的 `stream-json.ts`(L461 `+=` / L549 `=` / L706 `+=`)语义微妙且 SAFE=N(改变计费数字),需真实 Claude 输出 diff 验证,六批代码质量加固均 DEFER(`docs/code-quality-hardening-2026-07-24.md` §2/§6 A6)。
- **PPM 父表删除不级联(孤儿数据)**:plan / problem / task / project 的外键为软关联无约束(migration `202607220900`),删父行不留 500 而是留孤儿子行(MED 数据质量);全域缺乐观锁;第五批仅修 file / workspace 部分,余下 DEFER(§8 G 批)。

### 2026-08-08 多代理审计 · 中等

**PPM 正确性(已上线)**
- 执行收口跨天校验可绕过:`problem/service.py:617-638`+`task/service.py:336-357`,顺序是先写 actual_end_time 用旧 actual_start_time 校验再用新 actual_start_time 覆盖 → 可落库跨天/end<start,破坏"按天求和"不变式。
- 执行人/负责人 body 可控冒名填报:`problem/router.py:504`、`task/router.py:208-229,496-508`,工时/执行记录可记到他人名下,污染统计/绩效归因。
- 收口无行锁可重复收口/丢更新:`problem/service.py:568-681`+`task/service.py:301-391`(对比 start 有 with_for_update)。
- ✅ 已修复(ql-20260809-003-56db) kanban 日期过滤 naive datetime 比 timestamptz 列:`kanban/service.py:112,118,124-131`(其余子域用 tzinfo=UTC),生产 asyncpg 可能 InterfaceError 500 或时区错移,aiosqlite 单测抓不到。
- plan change_process 并发版本链分叉:`service.py:1109-1195`(无锁,两条并发各建 draft 指向同一 parent,任务绑定最后提交者赢)。
- 同项目并发建计划绕过唯一约束:`plan/service.py:536-546`(手动 SELECT 查重)+ `model.py` PsProjectPlan 无任何 UniqueConstraint。
- 审批履历与状态变更非原子两次 commit:`plan/service.py:1089-1091,1178-1182,1484-1488`(第二次 commit 失败丢审计履历,出现"已完成但无审批记录")。
- workbench 待办分页 total 截断 + `_TODO_SOURCE_LIMIT=200`:`workbench/service.py:42,448-546`(某源>200 条永不出现、源①②无 ORDER BY 跨页重复/漏项)。
- 项目 delete CASCADE 删成员但不失效权限缓存:`project/service.py:226-230`(对比成员 CRUD 调了 invalidate_all_permissions,被删项目原经理 300s 缓存 TTL 内仍持越权范围)。
- 导入上传大小校验在 `file.read()` 之后:`plan/router.py:373-374`(2GB 文件先撑爆内存再被 413 拒)。

**网关 / 外部集成**
- mcp webhook SSRF:`mcp_gateway/router.py:207`+`service.py:549-552`(url 无 scheme/私网校验,可注册内网/云元数据 `169.254.169.254` 回调)。
- worktree clone repo_url 无 scheme 白名单:`worktree/git_runner.py:79`(`ext::` 可 backend 容器内 RCE / `file://` 读本地 / 任意 ssh SSRF)。
- http_get SSRF 重定向不复查 + IPv6 私网绕过:`tool_gateway/service.py:537`+`tool_policy.py:302`(follow_redirects=True 不重跑校验;_check_not_private_ip 仅 AF_INET,不挡 ::1/fc00::)。
- git_operation_logs.args_json 明文存含 token 参数:`git_gateway/service.py:246`(redact_output 只处理 output 不处理 args,PAT 落库 + 经 API 回显)。
- 对外 MCP dispatch_worker 的 worktree_path 无校验:`mcp_gateway/tools.py:346`+`agent/execution.py:203-204`(backend 对绝对路径零校验直接作 worker cwd;最终可利用性依赖 daemon 端 allowed_roots)。
- askpass 脚本/gitconfig 注入:`worktree/exec_env.py:89,91,78,82`(token/git_username 未转义,Unix 双引号不防 `$(...)`、Windows cmd 不防 `&|`)。

**认证**
- refresh token 60s 宽限窗口内重放不触发吊销:`auth/service.py:299-317`+`config.py:67-75`(默认 60s,被窃旧 token 在窗口内可静默换新有效对且不触发 reuse 检测)。
- 用旧 refresh token 调 /auth/logout 会 revoke_all_user_sessions:`auth/service.py:132-144,298-317`(误杀该用户全部设备会话 DoS,与"logout 幂等"契约冲突)。
- API key 认证对全表未吊销 key 做 O(n) bcrypt 扫描:`auth/api_key_service.py:227-238`(无 DB 侧索引收窄,可用性 DoS,占满 to_thread 线程池)。
- API key 认证绕过 login_enabled:`api_key_service.py:222,244`(禁用登录无法真正锁死 API key 通道)。
- 登录用户名时序预言机:`auth/service.py:93-96`(不存在用户 `or` 短路不跑 bcrypt,响应时序可枚举存在的 active 用户名)。
- JWT secret_key 最小长度仅 16:`config.py:37`(HS256 共享密钥,低熵可离线爆破/伪造,且无轮换机制)。

**长尾模块**
- incident 状态机无转换校验:`incident/service.py:99-133`(任意 status 互跳,终态可复活)。 ⚠️ 部分修复(ql-20260809-003-56db):update 的 severity 校验已补齐与 create 对称;**status 转换校验(终态可复活)仍待办**。
- task reparse "未解析到就全删":`task/service.py:159-161,197-200`(破坏性硬删无阈值,解析结果为空时该 change 下全部既有 task 被删)。
- workflow spec_guardian 是死代码:`workflow/spec_guardian.py:193`(run_guard 全仓仅测试引用,G3-G7 质量/文档/组件/未解决 reject 门从未生效)。
- /system-status 无鉴权泄漏系统指标:`health/router.py:80-126`(cpu/mem/disk 用量 + COUNT,匿名可调 + 轻 DoS)。
- /health 不探测对象存储 MinIO:`health/router.py:32-67`(MinIO 宕仍 status=ok,可用性信号失真)。

**sillyhub-daemon(Node)**
- runtime-lock 失效锁回收 TOCTOU:`runtime-lock.ts:212-218,225-227`(stale 回收用普通 writeLockFile 非 O_EXCL,可双实例,打破单实例 invariant)。
- host_fs 符号链接逃逸:`file-rpc.ts:70-99`(assertWithinAllowedRoots 仅 pathResolve 不 realpath;interactive 路径已用 PolicyEngine+realpath 兜住,host_fs RPC 没)。
- spec 打包整树入内存 OOM:`spec-sync.ts:434-467`(packSpecDir 一次性 Buffer.concat,repo-native 含 `.runtime/worktrees` 可达 2GB)。
- 多个无界 Map/数组终态不清:`daemon.ts:692`(_interactiveFlatSeq)、`session-manager.ts:431`(_pendingInjectCount)、`:64`(subagentDepth)、`codex-app-server-driver.ts:~1061`(pendingServerRequests)。
- uncaughtException 被吞保活:`cli.ts:1023-1025`(与 Node 官方"应退出"建议冲突,可能带病运行)。

**前端**
- 登出不清 react-query 缓存:`components/app-shell.tsx:239-256`(QueryClient 为 App 单例,公共设备跨用户数据残留)。
- SSE token 走 URL query:`lib/agent-stream.ts:103`+`lib/daemon.ts:823`(EventSource 无法设 header 把长生命周期 JWT 拼进 url,泄漏到反代/日志/Referer)。
- ✅ 已修复(ql-20260809-003-56db) daemon SSE 每条报文 console.log:`lib/daemon.ts:923`(生产噪声 + 泄漏前 150 字)。
- PPM 多处提交按钮无 loading 双击重复创建(已上线):`ppm/problem-list/_problem-drawer.tsx:71`、`components/ppm-project-plan-form.tsx:280`、`ppm/task-plans/page.tsx:389`、`ppm/problem-list/page.tsx:453`。
- 看板过滤竞态旧结果覆盖新:`stores/kanban.ts:103-139`(切筛选慢响应覆盖快响应)。
- 周计划搜索框逐键触发 1 万行请求:`ppm/weekly-plan/page.tsx:565-571,131-156`(load 随 projectName 每键变身份,本意回车搜索)。
- agent 日志无虚拟化 O(N²):`components/agent-log-viewer.tsx:1093`(全仓零 React.memo,每条 SSE 全量重渲染)。
- ✅ 已修复(ql-20260809-003-56db) daemon 机器卡升级按钮忽略 upgrading 双发自更新:`components/daemon/machine-card.tsx:222-234`。

**core 基础设施**
- /health、/version 每次请求 fork git 阻塞事件循环:`config.py:293-311`(resolved_commit_sha @property 未缓存)+`health/router.py:64,75`(探针周期性触发,COMMIT_SHA 未烘焙的部署每次 spawn git)。
- ✅ 已修复(ql-20260809-003-56db) 错误响应 request_id 与中间件/日志不一致:`errors.py:337-342`(_request_id 读 header 不读 request.state)+`main.py:178-186`(排障追踪链断裂)。
- proxy_create_change 60s 轮询占 DB 连接:`change_writer/proxy.py:136-173`(请求内 while True 占住 asyncpg 连接,N 个并发可耗尽连接池)。

## 🟢 低(代码质量 / 维护性 / 体验)

### 代码质量

- **spec_profile 关键逻辑未实现(TODO 占位)**:`backend/app/modules/spec_profile/provider.py:75`("TODO: implement in follow-up task")、`policy.py:61`("TODO: implement stage conflict detection")、`policy.py:97`("TODO: implement document conflict detection")——阶段冲突与文档冲突检测尚未实现,模块为骨架。backend 源码 TODO 全集中在此模块。
- **daemon interactive 兼容入口 @deprecated**:`sillyhub-daemon/src/interactive/types.ts:212`、`claude-sdk-driver.ts:220` / `:240` 三处标注 `@deprecated`(task-02/03 driver provider-neutral 化后保留的兼容别名),应在确认无外部引用后清理。frontend 与 daemon 源码无 TODO/FIXME/HACK 标记。
- **N+1 与索引债(DEFER)**:约 10 处 N+1 查询(`list_daemon_instances`、`get_pending_leases`、`dialogs`、`import_commit`、`_find_role_members`、`_cleanup_before_dispatch`、`reparse`、`placement`、`list_missions` 等);六批加固已改 6 处批量化(B2/B3-B5/B6-B11)+ 3 处索引(`agent_run_workspaces.agent_run_id` / `PlanTask.ps_plan_node_detail_id` / `daemon_task_leases (runtime_id,status,created_at)`,migration `202607250100`),余下因"查询逻辑改动有风险 / 低频导入 N 小"DEFER(`code-quality-hardening-2026-07-24.md` §2/§5/§6/§8 DEFER 清单)。
- **session-manager `_store` end/fail 不清**:`sillyhub-daemon/src/interactive/session-manager.ts:1777` 附近,MEDIUM 内存泄漏;`_store.delete` 会与 `get()` 校验 / list / flush 落盘 / restore 交织,需设计"哪些 session 可驱逐 + 与持久化协调",六批 DEFER(§9 ND)。
- **死代码残留**:`agent/service.py:177` tool_failure 监控死代码(LOW,后端算了 `service.py:64-223` 但注释明说 non-blocking/no alert/no display,P3-2);frontend `lib/daemon.ts` `streamQuickChat` 已在第四批 F7 删除、第五批 G3 清注释。
- **god 文件未拆分**:daemon `daemon.ts` / `task-runner.ts` 高耦合(lease payload 鸭子类型几十处),无低风险切片,六批维持不做。
- **commit hook 可被复合命令绕过**:`git add && git commit` 以 `git add` 开头会绕过 claude PreToolUse 层(仅触发 git pre-commit 的 ruff,不触发 mypy + 前端全量检查)。

### 2026-08-08 多代理审计 · 低 / 小瑕疵

- **全域缺乐观锁(具体高价值点)**:除已记通用项外,本次定位最具体点——PPM 收口(`problem/service.py:568-681`、`task/service.py:301-391`)、role_name 整字段并发覆盖丢角色(`project/service.py:564-581`)、plan change_process(`service.py:1109-1195`)、release 同用户并发双投撞唯一约束返 500(数据完整性已由 DB 保护,仅错误码不优雅)。
- **incident 时间戳不一致**:`model.py:36-41,59-64` 用已弃用 `datetime.utcnow()`(naive),与 release 用 `datetime.now(UTC)`(aware)不一致;resolved 回退 open 不清 resolved_at/resolved_by。
- **settings 多处 UUID 转换畸形返 500 非 422**:`settings/router.py:297,317,342` 手转 `uuid.UUID`,畸形串抛 ValueError(其它模块用 `uuid.UUID` 路径参自动 422)。
- ✅ 已修复(ql-20260809-003-56db) **knowledge parser 大文件先整读再截断**:`knowledge/parser.py:29-33`(size>1MB 仍 read_text 整文件再 `[:250KB]` 切片,GB 级内存尖峰)。
- **文件上传整文件入内存**:`file/router.py:56`+`storage/minio_backend.py:61-64`(put_object 只收 bytes 不支持流式/分片,50MB×并发 OOM)。
- **S3 默认凭证 minioadmin/minioadmin**:`config.py:235-236`(无 environment=="prod" 时禁止默认值的校验)。
- **前端 ~21 处 async useEffect 无 cancelled 守卫 + 大量 fire-and-forget setTimeout(setState)**:settings/git-identities/admin-users/runtimes/ppm 多页/mission-console 等(unmount race,React 18 静默但 stale state);已有 ~28 处正确用 cancelled/AbortController 范式可对齐。
- ✅ 已修复(ql-20260809-003-56db) **Node daemon 残留调试 log**:`session-manager.ts:2602,2723,2740`(`[reload-diag]` console.log 打印 agentSessionId;实测三处 `[reload-diag]` 已全删、session-manager.ts console.log 归零)。
- **前端杂项**:审批中心"查看详情"死按钮(`approvals/page.tsx:345`)、admin/llm-provider/agent-profile 多处操作按钮无 in-flight 锁(双发,多数幂等或报错)。
- **scan_docs/list_ 全表扫大文本无分页**:`scan_docs/service.py:45-72`(`func.lower(content).like`,workspace 文档多时性能下降)。

### 依赖风险

- **sillyhub-daemon pnpm overrides 硬钉 Claude Agent SDK 多平台子包**:`sillyhub-daemon/package.json` 的 `pnpm.overrides` 将 win32/linux/darwin 的 x64/arm64/musl 共 8 个平台子包全部绑定到 `npm:@anthropic-ai/claude-agent-sdk@0.3.181`,主依赖也硬钉 `0.3.181`;升级需同步改 8 条 override + 主依赖,跨平台打包链路长,任一平台 SDK 子包缺失即安装失败。
- **asyncpg 在 Windows 装不上**:后端生产用 PostgreSQL(asyncpg),本地开发用 Docker 起 Postgres、后端连容器;backend 测试须用 `backend/.venv/Scripts/python.exe`(全局缺 aiobotocore)。生产 asyncpg 与单测 aiosqlite 走不同 async 驱动,存在 JSONB / 数组 / UPSERT 方言差异风险。
- **daemon bundle / self-update 版本对齐**:光 `cp bundle` 无效,daemon 按 backend manifest 对齐 bundle(升降级都 `need_restart` 退出);`pnpm bundle` 报 `Cannot find module` 多为 `.pnpm` 真实包目录空,需 `pnpm install --force` 才真重下。
- **migration 链断裂**:SQLite 单测验不到 PG 方言差异与多 head;部署前必跑 `alembic heads` 核实单头,并行变更各写 migration 易撞 revision/down 分叉;子代理手算 revision 图漏 merge revision 会误报多 head,以官方 `alembic heads` 为准。
- **SillySpec 工具本身**:21 份已处理工具 bug 存 `docs/sillyspec/finished/`,活跃坑存 `docs/sillyspec/`;`sillyspec --done` 平台 sync 可能挂起(未连接时进程不退出),需 timeout 包裹并以 `--status` 为准。
- **本机多 daemon 实例**:连本地(`daemon-start.bat`)与连远程两类并存,停止按 `--server` 区分别误杀;无自动拉起;多实例会导致 WS 重连风暴。
- **部署 compose 瞬态冲突 / 端口**:`docker compose up` 报容器名 conflict 多为瞬态已自愈,看 `docker compose ps` 实际状态而非急着 `rm -f` 在跑容器;本机访问 docker 映射端口(8001/3001)用 `127.0.0.1`,`localhost` 解析 IPv6 连不通。
- **frontend 双 UI 体系 + 双浏览器自动化**:同时引入 antd 6 + Tailwind 3.4 + @xyflow/react,样式混合类名 / 优先级冲突需持续维护;同时声明 `@playwright/test` ^1.60 与 `puppeteer` ^24.43 两套浏览器自动化依赖,职责重叠且仓库内无独立 playwright config。

## ✅ 已解决（2026-08-06 scan 刷新核实时核实）

以下曾列入 🔴/🟡，经对照当前代码（HEAD `5a00fc7e`）核实已由对应变更修复，移出活跃关注点：

- **interactive kill 假停 / MissionControl.cancel 造僵尸（原 🔴 P0-1/P0-2）**：已由 `2026-08-05-daemon-kill-channel-unify`（merge `99aeb696`，已入 main）统一 kill 通道修复。`backend/app/modules/daemon/lease_service.py` 原 `_ws_cancel_stub`（只打日志不发 WS）已移除，改由 `_send_interactive_cancel`(:550) 实际调用 `DaemonWsHub.send_session_control`(:608) 下发 INTERRUPT→END；`backend/app/modules/agent/control.py:114` `MissionControl.cancel` 现委托 `lease_svc.cancel_lease(r.id)` 收尾每个 active worker。来源 `docs/agent-platform-deep-audit-2026-07-12.md` 发现 1/2。
- **写代码 team mission 断 2 处 + 共享 worktree 硬阻塞（原 🟡 P2-2）**：已由 `2026-07-12-worker-worktree-isolation` + finalizer wiring 修复。`backend/app/modules/agent/execution.py` `collect_completed_artifacts`(:297) 现持久化 `kind="patch"` 的 `AgentArtifact`(:340，供 Finalizer 合并)；`dispatch_worker`(:145) 现为每个 worker 在 `ws.root_path/.worktrees/<run.id>/` 建 per-worker git worktree 副本并作 root_path 下发(:135-177，并发写不互覆)；`finalize_execute_mission`(`backend/app/modules/agent/finalizer.py:219`)已有调用点(`finalizer.py:535`、`mcp_tools.py:255`)。原 D-006 延后项已实现。
- **scan 文档全量结构性过期（原 🔴，source_commit 停在 ba87eec）**：本变更 `2026-08-06-scan-doc-drift-gate` 已把 8 篇 scan 的 `source_commit` 刷新到 `5a00fc7e` 并新增 warn-only drift 检测门（`scripts/scan-drift-check.py` + `.github/workflows/scan-drift.yml`）。残余风险：门为 warn-only 不自动修，scan 仍需人工 LLM 重跑；但过期现已可见（CI warn + PR 评论），不再是隐形债。
