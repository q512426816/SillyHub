
## ql-20260821-022-e17a | 2026-08-21 18:25:33 | 审查并修正 daemon 缓存清理功能的缺陷/性能/质量/垃圾代码/注释/文档问题
状态：已完成
关联变更：（无）
文件：
- docs/qa/2026-08-21-daemon-cleanup-code-review.md（审查发现 20 项编号清单+已排除项结论）
- sillyhub-daemon/src/cleanup.ts（移除 outbox/runs 清理目标+删 listAllFiles 死代码+黑名单注释）
- sillyhub-daemon/src/daemon.ts（CLEANUP 活跃会话跳过+in-flight 守卫+静态导入）
- backend/app/modules/daemon/tests/test_machines_router.py（补 cleanup 端点路由/504/越权/不存在 4 测）
- frontend/src/app/(dashboard)/runtimes/page.tsx（清理按钮 modal.confirm 二次确认）
- backend/openapi.json（dump_openapi 再生成含 cleanup 端点）
- frontend/src/lib/api-types.ts（gen:types 再生成）
需求：审查并修正 daemon 缓存清理功能的缺陷/性能/质量/垃圾代码/注释/文档问题
根因：原实现 CLEANABLE_DIRS 含 outbox（断线补发队列，删=丢未投递消息）与 runs（活跃任务终端日志，与既有 7 天保留期机制冲突）；handler 无活跃会话守卫与并发护栏；前端破坏性操作无二次确认；清理按钮与端点零测试；七处保留注释用白名单口吻描述黑名单实现；六份模块文档与 openapi/api-types 落后；另有 inject 5 参断言既有测试债
方案：cleanup.ts 黑名单移除 outbox/runs+删 listAllFiles 死代码+注释改准确语义；daemon.ts CLEANUP 加 _interactiveSessionsByLease 跳过+_cleanupInFlight 守卫+DEFAULT_CONFIG_DIR 静态导入；cli.ts cleanAction 静态导入；前端 handleCleanup 加 modal.confirm；补后端 cleanup 端点 4 测+前端清理按钮 2 测+cleanup.test 保留断言反转；同步 protocol/daemon/cli/lib-daemon/SillyHub-daemon 五份模块文档+新建 cleanup.md+module-map；dump_openapi+gen:types 再生成；顺手修 kind-dispatch/session-switch 两处 inject 断言为 5 参；全部发现与结论落 docs/qa/2026-08-21-daemon-cleanup-code-review.md（20 项编号清单）
结果：daemon vitest 全量 2481 passed/9 skipped、typecheck 干净；backend daemon 模块 pytest 843 passed、ruff format+check 干净；前端 machine-card 11 passed、tsc --noEmit 干净、eslint 0 error（21 条预存 warning 不在改动行）；openapi 379 paths 含新 cleanup 端点

## ql-20260821-023-5d9a | 2026-08-21 20:29:38 | 修复 CI 红灯：backend-ci ruff I001 挡住全部后端测试 + daemon-ci 20 个失败测试（UNC 路径 Linux 失效 / 测试…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/session_attachment/tests/test_capability.py（ruff --fix 修 I001 import 排序）
- sillyhub-daemon/src/policy/path-utils.ts（UNC 判定提前到平台 resolve 前（字符串级，\ 与 // 两形态））
- sillyhub-daemon/tests/helpers.ts（新增 winPath() Windows 路径字面量平台适配 helper）
- sillyhub-daemon/tests/permission-rules.test.ts（去重测试改用不与 tmpdir() 撞车的路径）
- sillyhub-daemon/tests/interactive/session-manager-allowed-roots.test.ts（C:\ 字面量 winPath 包裹）
- sillyhub-daemon/tests/interactive/session-manager-borrow-sandbox.test.ts（常量+模板 join 平台适配）
- sillyhub-daemon/tests/interactive/session-manager-profile.test.ts（C:\ 字面量 winPath 包裹）
- sillyhub-daemon/tests/daemon-kind-dispatch.test.ts（inject 断言补全 5 参）
- sillyhub-daemon/tests/daemon-session-switch-config.test.ts（inject 断言补全 5 参）
- .sillyspec/docs/sillyhub-daemon/modules/policy.md（同步 UNC 判定跨平台描述）
需求：修复 CI 红灯：backend-ci ruff I001 挡住全部后端测试 + daemon-ci 20 个失败测试（UNC 路径 Linux 失效 / 测试硬编码 Windows 路径 / inject 断言滞后）
根因：backend 是 05:19 会话 reopen 提交带入 import 排序违规且 lint 先于测试执行导致全量被挡；daemon 从未在 Linux 上跑过——UNC 判定依赖 Windows pathResolve 归一（POSIX 把 \host\share 折叠成 cwd 相对名，startsWith 恒 false），三个 session-manager 测试硬编码 C:\ 字面量（POSIX 上是单个相对文件名，白名单前缀比较恒 false），Linux tmpdir()=/tmp 与 permission-rules 去重测试撞车，两个 inject 断言停在 3 参而实现已 5 参
方案：path-utils normalizePath 对 UNC（\ 与 // 两形态）字符串级直通不 resolve，resolveRealPath 前置拒绝跨平台成立；tests/helpers.ts 新增 winPath()（POSIX 映射 C:\x → /c/x），三个 session-manager 测试 + permission-rules 去重测试平台适配；kind-dispatch/session-switch-config inject 断言补全 5 参；backend test_capability.py ruff --fix 修 import 排序；policy.md 同步 UNC 判定描述
结果：backend ruff 全仓通过 + pytest 4771 通过；daemon Windows typecheck 通过 + 受影响 8 文件 169 测试全绿；WSL Ubuntu 用 git HEAD+本批 8 文件模拟推送树全量 2480/2482（仅 BUILD_ID×2 为模拟目录无 git 元数据的预期 fallback，CI 完整 checkout 不受影响）

## ql-20260821-024-e7c1 | 2026-08-21 21:10:38 | backend-ci 第二层修复：ruff format 3 文件格式漂移 + mypy 过期 type:ignore
状态：已完成
关联变更：（无）
文件：backend/app/modules/session_attachment/capability.py, backend/app/modules/session_attachment/tests/test_capability.py, backend/app/modules/daemon/session/service.py, backend/migrations/versions/20260820100000_session_attachments_multimodal.py
需求：backend-ci 第二层修复：ruff format 3 文件格式漂移 + mypy 过期 type:ignore
根因：05:19-06:35 间提交带入格式漂移与过期 ignore，此前被更早失败的 ruff check（I001）挡住未暴露，lint 修复后 CI 推进到 format/mypy 步骤才显形
方案：ruff format 全仓（3 文件纯空白/注释对齐/行合并重排，语义不变）；test_capability.py 移除 supports_multimodal_by_model_name 已放宽签名（str|None）下的过期 arg-type ignore
结果：本地复刻 CI 全链通过：ruff check 全仓 0 错 + ruff format --check 925 文件通过 + mypy app 675 文件零错误 + session_attachment pytest 4 通过

## ql-20260822-002-2dcb | 2026-08-22 10:37:15 | 后端测试提速：Redis 停机不再每测试死等 ~3s 连接超时 + verify 模块 test 命令 -n auto 并行
状态：已完成
关联变更：（无）
文件：
- backend/conftest.py（新增 _probe_redis_once 会话级探测 + _reset_redis_state 改为探测通过才 flushdb）
- .sillyspec/local.yaml（modules 块 12 个 backend 条目 test 命令加 -n auto（gitignored 本机配置不入库））
- .sillyspec/docs/multi-agent-platform/modules/backend.md（关键逻辑区追加 ql-20260822-002 测试提速条目）
需求：后端测试提速：Redis 停机不再每测试死等 ~3s 连接超时 + verify 模块 test 命令 -n auto 并行
根因：①根 conftest _reset_redis_state autouse 每测试 flushdb，Redis 停机时 localhost 连接失败不是立即拒绝而是等满超时（Windows 实测 ~2s/次、setup ~3.2s/用例），agent 模块 632 用例纯等待 ≈34min、CPU 仅 ~90s；②local.yaml modules 块 12 个 backend 条目 test 命令裸串行，07-23/08-12 两轮 xdist 优化只覆盖手动全量跑，verify/子代理走的模块命令从未并行
方案：①conftest 新增 _probe_redis_once 进程内一次 0.5s 短超时 ping 探测（xdist 每 worker 各一次），失败则本会话全部跳过 flushdb，redis 可用路径逐测试 FLUSHDB 行为不变；②12 个 backend 模块 test 命令统一加 -n auto（pyproject addopts dist=loadscope 兜底跨文件状态污染），顶层 commands.test 全量命令本轮未动
结果：agent 模块 632 passed：串行 34.8min→2 分 39 秒、-n auto 44.4s 零 flaky；ruff check+format 过；backend.md 关键逻辑已同步 ql-20260822-002 条目

## ql-20260822-003-a265 | 2026-08-22 11:00:30 | verify gate 全量测试提速：commands.test 的 backend 段加 -n auto 并行
状态：已完成
关联变更：（无）
文件：
- .sillyspec/local.yaml（commands.test backend 段加 -n auto + 坑2 注释改已解（gitignored 本机配置不入库））
- .sillyspec/docs/multi-agent-platform/modules/backend.md（关键逻辑区追加 ql-20260822-003 条目）
需求：verify gate 全量测试提速：commands.test 的 backend 段加 -n auto 并行
根因：ql-20260822-002 只给 modules 块 12 条子模块命令加了 -n auto，顶层 commands.test 全量命令仍串行（08-21 verify 实测 936.69s≈15.6min），gate 超时压力仍在（坑2 注释也停在「未解」旧状态）
方案：commands.test 的 backend 段 uv run pytest 加 -n auto（dist=loadscope 兜底，frontend/daemon 段不动）；文件头部坑2 过期注释改「已解」并附实测数据；backend.md 关键逻辑追加 ql-20260822-003 条目
结果：backend 全量实测 4771 passed / 6 skipped / 3 xfailed，356.97s（5 分 56 秒）零 failed 零 flaky（Redis 停机状态下跑出，conftest 会话级探测 xdist 每 worker 生效），对比 08-21 串行 936.69s 提速 2.6 倍

## ql-20260822-004-68a2 | 2026-08-22 12:31:00 | 核对并更正 local.yaml 过时注释与过时 deselect 逻辑
状态：已完成
关联变更：（无）
文件：
- .sillyspec/local.yaml（坑3/connect/引号/mcp/platform-token 五处注释更正 + agent 模块去 deselect）
需求：核对并更正 local.yaml 过时注释与过时 deselect 逻辑
根因：注释与实现不一致是万恶之源，多条注释引用的 sillyspec 源码行号/行为在工具迭代后已失效，agent 模块 deselect 的根因已在 backend conftest 修复
方案：逐条比对 sillyspec 3.26.15（sync.js/client.js/config.js）与 backend（dispatch.py/auth.py/conftest.py/pyproject.toml）后更正 6 处——坑3 改已解、connect 改文本级定向替换说明、引号警告改已兼容、mcp 段去重复注释并修 client.js 行号为 sillyhub-mcp/client.js:58、platform token 改 shpsync_/shk_live_/JWT 三路径说明、agent 模块移除两条过时 deselect 恢复真实执行
结果：YAML safe_load 验证 9 顶层键 14 模块 token 完整；agent 模块去 deselect 全量实测 634 passed 46.9s 零失败

## ql-20260822-006-f113 | 2026-08-22 16:37:38 | 修复变更详情步骤时间线时间显示偏8小时
状态：已完成
关联变更：（无）
文件：
- backend/app/core/config.py（新增 cli_progress_timezone 配置+resolve_cli_tzinfo+validator）
- backend/app/modules/change/service.py（_normalize_completed_at 按配置时区归一,弃 astimezone()）
- backend/app/modules/change/tests/test_step_progress.py（固定时区断言替换进程时区往返+新增回归用例）
- backend/pyproject.toml（加 tzdata 依赖）
- backend/uv.lock（tzdata 锁定）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引+注意事项时区契约）
需求：修复变更详情步骤时间线时间显示偏8小时
根因：sillyspec CLI 用 toLocaleString(zh-CN) 写宿主机墙钟(无时区标记),后端 _normalize_completed_at 用 naive.astimezone() 随进程时区解释——Docker 后端容器是 UTC,把东八区墙钟当 UTC,前端转浏览器本地后整体 +8h
方案：core/config.py 新增 cli_progress_timezone 配置(默认 Asia/Shanghai,resolve_cli_tzinfo 接受 IANA 名或 ±HH:MM 偏移,validator 启动期 fail-fast),_normalize_completed_at 改按该时区 replace(tzinfo) 归一与进程时区解耦;pyproject 加 tzdata 依赖(Windows venv 必需)
结果：测试改固定时区断言+新增 settings 驱动回归用例,change 模块 394 passed;重建后端镜像后真实 HTTP 端点验证——首步 2026-08-21T18:43:59Z=北京 02:43 与 CLI 墙钟一致;归一在读侧进行存量数据零迁移

## ql-20260822-007-d62a | 2026-08-22 16:39:44 | 修复 backend-ci Mypy 红灯
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/patrol.py（session_id None 收窄）
- backend/app/modules/daemon/tests/test_session_team_mission.py（删除 3 处多余 type:ignore）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（模块变更索引追加）
需求：修复 backend-ci Mypy 红灯
根因：6d7d1d2c 让 mission.session_id 类型可空，patrol.py 未收窄即作 dict[UUID,bool] 键；test_session_team_mission.py 三处手写 type:ignore 因 warn_unused_ignores=true 变成多余注释错误
方案：patrol.py 在读取 session_active_cache 前先判断 mission.session_id is None 则 continue；测试文件删除 53/80/191 三处 # type:ignore[no-untyped-def]
结果：本地 uv run mypy app：678 source files Success no issues；uv run pytest app/modules/agent app/modules/daemon -q --no-cov -n auto：1818 passed 1 xpassed（预存路由顺序 XPASS，与本次无关）
审计：⚖️ 归属切分：5 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/core/config.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_step_progress.py, backend/pyproject.toml, backend/uv.lock

## ql-20260822-008-0d44 | 2026-08-22 19:51:18 | 修复真机冒烟发现的两个遗留——①选到无在线绑定工作区时派发要到 worktree 阶段才 failed hostfs_unavailable（run 落库成垃圾…
状态：已完成
关联变更：2026-08-22-team-session-unify
文件：
- backend/app/modules/agent/mcp_tools.py（派发前在线绑定预检 422 引导）
- backend/app/modules/agent/execution.py（worker prompt 结果落盘 artifact 要求）
- backend/app/modules/agent/tests/test_mcp_tools.py（预检用例+stub helper+12 用例适配）
- backend/app/modules/agent/tests/test_dispatch_profile.py（2 用例 stub 适配）
- backend/app/modules/agent/tests/test_integration_cross_workspace.py（单 ws 全流程 stub 适配）
- backend/app/modules/agent/tests/test_mcp_tools_cross_workspace.py（3 用例 stub 适配）
- backend/app/modules/agent/tests/test_mission_access_control.py（api_key 通道用例 stub 适配）
需求：修复真机冒烟发现的两个遗留——①选到无在线绑定工作区时派发要到 worktree 阶段才 failed hostfs_unavailable（run 落库成垃圾且主 agent 无引导）②分身跑完任务但 get_worker_result 取不到 artifact（结果只写在对话未落盘）。
根因：①dispatch_worker 无派发前绑定预检，配置性缺绑定与瞬时失败同路径；②render_worker_prompt 未要求分身把产出写文件，主 agent 的 get_worker_result 只能取落盘产物。
方案：①_dispatch_worker_core 建 run 前调 resolve_representative_binding（owner→任意在线）预检，均无在线→422 中文引导不建 run，user_id 防御性取值防懒建 rollback 过期；②worker prompt 追加结果落盘 artifact 必守段；③19 个既有用例适配（stub 在线绑定 helper+3 处 error_code 断言弱化为终态）。
结果：agent 模块全量 848 passed+1 xpassed 全绿、ruff 过、已提交 aa411691；部署待 rebuild backend。
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：.sillyspec/changes/2026-08-22-team-session-unify/tasks.md

## ql-20260822-009-95bc | 2026-08-22 22:01:24 | 修复已结束会话重新打开后被立刻打回 ended 无法续聊（transcript 目录两侧不对称）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/claude-transcript-dir.ts（新增 transcript 位置探测（locate/apply 两入口，fs 吞错兜底））
- sillyhub-daemon/src/interactive/session-manager.ts（restore/reload 两调用点改按位置判定 + 注释同步）
- sillyhub-daemon/tests/interactive/claude-transcript-dir.test.ts（locator 单测（join 构造路径键避 Windows 反斜杠坑））
- sillyhub-daemon/tests/interactive/session-manager-resume-config-dir.test.ts（resume/reload 集成断言（mock 探测三态））
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（契约/关键逻辑/注意事项/人工备注同步）
- .sillyspec/docs/SillyHub/flows/interactive-session.md（建会话图口径修正）
- .sillyspec/docs/SillyHub/modules/daemon.md（interactive 条目口径修正）
需求：修复已结束会话重新打开后被立刻打回 ended 无法续聊（transcript 目录两侧不对称）
根因：create 仅配供应商时隔离 CLAUDE_CONFIG_DIR（未配供应商 transcript 写宿主机 ~/.claude），resume/reload 却无条件强制隔离目录，找不到 jsonl → claude 报错退出 → fail → 会话记回 ended，inject 全 409（部署日志实证 reopen 200 后 4 秒被 daemon 终结）
方案：新增 claude-transcript-dir.ts 探测 sid.jsonl 实际在隔离目录还是 ~/.claude（扫两侧 projects 一层，fs 吞错兜底），restoreAndReconnect 与 _reloadSession 按探测结果设/删 env；两轮旧修复语义均保留，探测不到维持隔离默认
结果：daemon 全量 vitest 2533 过 9 跳过零失败、tsc 零错；新增 16 用例（locator 11 + resume/reload 5）；三处模块文档同步；需重建 dist 并重启 daemon 后生效

## ql-20260822-010-aa7b | 2026-08-22 22:28:51 | 会话门户三修复：新建表单聊天优先改版+滚动贴底跟随+刷新后渲染一致性
状态：已完成
关联变更：2026-08-22-workspace-sessions-portal
文件：
- frontend/src/components/sessions/new-session-form.tsx（聊天优先版式（chips+折叠+大输入框））
- frontend/src/components/sessions/__tests__/new-session-form.test.tsx（renderForm 默认展开适配+聊天优先 3 用例）
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（锁定断言适配折叠态（超出启动声明文件清单的合理扩散））
- frontend/src/components/daemon/turn-timeline.tsx（贴底跟随滚动+pending 强制回底）
- frontend/src/components/daemon/session-panel.tsx（displayTurns 终态回补+viewMode 持久化）
- frontend/src/components/daemon/runtime-session-helpers.tsx（去重收窄+runTerminalTurnStatus）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（新增 4 用例）
- frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx（新增滚动 5 用例）
- .sillyspec/docs/frontend/modules/components-sessions.md（NewSessionForm 版式同步）
- .sillyspec/docs/frontend/modules/components-daemon.md（TurnTimeline 滚动/终态回补/viewMode 同步）
需求：会话门户三修复：新建表单聊天优先改版+滚动贴底跟随+刷新后渲染一致性
根因：①五选择区平铺视觉强制感而默认值其实已自动解析 ②turn-timeline 每次 turns 更新无条件 scrollTo 底部无贴底判断 ③历史回看一律标 completed 遮蔽失败轮/双层内容级去重误删重复工具输出/viewMode 刷新回默认，三源造成实时与刷新后不一致
方案：NewSessionForm 聊天优先版式（chips 摘要+修改配置折叠区+大输入框，锁定 chips 常显）；TurnTimeline onScroll 距底<80px 贴底才跟随+pending 轮强制回底；displayTurns 按 runsMeta 回补终态（runTerminalTurnStatus）+去重收窄（预过滤仅 user_input/reply+装配器 seenTextDedup:false）+viewMode 按会话 localStorage 持久化
结果：全量 1917/1917 全绿（新增滚动 5+helpers 4+聊天优先 3 用例、门户 2 用例适配折叠态）、tsc 零错、lint 持平零新增警告；components-sessions/components-daemon 模块文档已同步
审计：⚖️ 归属切分：6 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：.sillyspec/changes/2026-08-22-workspace-sessions-portal/verify-result.md, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, .sillyspec/changes/2026-08-22-workspace-sessions-portal/runtime-evidence/artifacts/v3-change.png, .sillyspec/changes/2026-08-22-workspace-sessions-portal/runtime-evidence/artifacts/v3-global.png, .sillyspec/changes/2026-08-22-workspace-sessions-portal/runtime-evidence/artifacts/v3-workspace.png, frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx

## ql-20260823-001-c001 | 2026-08-23 11:12:57 | 筛选态点组头＋免重复选择（D-107 直带链补齐）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/session-list-panel.tsx（onNewInGroup 二参筛选快照）
- frontend/src/components/sessions/sessions-portal.tsx（直带链+回退浮层）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（断言二参化+筛选快照用例）
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（直带/缺层/离线回退三用例）
- .sillyspec/docs/frontend/modules/components-sessions.md（D-107 直带链落地）
需求：筛选态点组头＋免重复选择（D-107 直带链补齐）
根因：task-06 时 SessionListPanel 未暴露筛选态（allowed_paths 边界）降级全态浮层——用户已在具体机器+智能体上仍要重选（QA P2-1）
方案：onNewInGroup 二参筛选快照（空串=未筛）+ 门户直带链（两层具体且有在线 runtime 直接合成 preContext 跳过浮层，缺层/离线回退浮层）
结果：受影响 47/47（3 新用例）+ 全量 1931/1931 + tsc 零错；components-sessions.md 同步；待前端重建部署
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/__tests__/agent-log-card.test.tsx, frontend/src/components/daemon/agent-log-card.tsx, frontend/src/components/daemon/session-panel.tsx, frontend/src/components/daemon/turn-timeline.tsx

## ql-20260823-002-6a1a | 2026-08-23 11:17:17 | 本地 Agent 日志不要独立卡片展示（夹在消息流与输入区之间很别扭）
状态：已完成
关联变更：2026-08-23-platform-agent-log-ingest
文件：.sillyspec/changes/2026-08-23-platform-agent-log-ingest/tasks.md
需求：本地 Agent 日志不要独立卡片展示（夹在消息流与输入区之间很别扭），要融进会话消息流。
根因：无，纯展示形态重构（挂载位置与视觉形态问题，数据链路不变）。
方案：TurnTimeline 增 streamFooter 注入口（最后一个 turn 后、同滚动容器内渲染）；AgentLogCard 改会话流条目——🧾 圆形头像 + 答复同款 rounded-tl 气泡，默认折叠一行摘要「本地 Agent 日志 · N 个 · 最新 X 前 ▸」，点击头部展开明细（保留 3 条折叠/展开全部/刷新/复制交互）；空/错/加载一律不渲染；session-panel 挂载从独立区块改为传 prop。文件：agent-log-card.tsx、session-panel.tsx、turn-timeline.tsx、__tests__/agent-log-card.test.tsx。
结果：vitest 7/7（折叠默认/展开/条数折叠/复制/静默隐藏）、daemon 目录 24 文件 341 测试零回归、tsc 0 错、lint 过；Docker 前端镜像重建部署，生产 3001 实证条目在会话流内正确落位（折叠摘要 + 实时数据），dev 3000 全交互实证（展开明细/复制按钮/invocations=2 心跳数据）；提交 2c8f0f0d。审计注：backend/app/modules/daemon/router.py 为并行会话未提交工作（非本 quick 范围，仅审计行追溯）。
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/router.py

## ql-20260823-003-b37e | 2026-08-23 11:49:49 | 会话树三体验修正：创建人显名称/筛选后藏引擎chip/变更入口树统一
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/router.py（owner_name display_name 优先）
- backend/app/modules/daemon/tests/test_sessions_list_owner_name.py（三态用例）
- frontend/src/components/sessions/session-list-panel.tsx（hideEngineChip+change 树化+FlatList 退役）
- frontend/src/components/sessions/sessions-portal.tsx（页头按钮移除+预展开）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（change 重写+chip 用例）
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（change 改组头＋）
- .sillyspec/docs/frontend/modules/components-sessions.md（D-106 修订四处）
需求：会话树三体验修正：创建人显名称/筛选后藏引擎chip/变更入口树统一
根因：①owner_name 注入用 username 登录名应显用户名称 ②筛选智能体后全组同引擎逐条 chip 冗余 ③变更入口左侧仍是 D-106 保留的旧平铺与全局不一致
方案：①后端注入 display_name 优先回退 username ②SessionRow hideEngineChip（filterAgent 非空隐藏引擎 Tag）③ChangeScopeFlatList 退役删除 change 树化单组+组头＋（页头按钮移除 change_id 透传 预展开）
结果：backend daemon 979+前端 1932 全绿、tsc 零错、lint 本卡零新增；list-panel/portal 47/47；components-sessions.md 四处同步（D-106 修订）；待 backend+frontend 重建部署

## ql-20260823-004-3338 | 2026-08-23 12:47:57 | (quick 任务)
状态：进行中
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/projects/page.tsx, frontend/src/app/(dashboard)/ppm/projects/__tests__/projects-page.test.tsx, frontend/src/components/sessions/sessions-portal.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx

## ql-20260823-005-4fa7 | 2026-08-23 12:48:18 | ppm/projects「发起团队」直达会话页（跳 /sessions?new=1 自动进预会话）
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/ppm/projects/page.tsx（发起团队按钮改跳 /sessions?new=1）
- frontend/src/components/sessions/sessions-portal.tsx（?new=1 直达效应 + enterPreSession 提取）
- frontend/src/app/(dashboard)/ppm/projects/__tests__/projects-page.test.tsx（跳转断言更新）
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（新增 ?new=1 直达 4 用例）
- .sillyspec/docs/frontend/modules/components-sessions.md（契约摘要+关键逻辑补 ?new=1）
- .sillyspec/docs/frontend/modules/app-ppm-pages.md（PpmProjectsPage 行操作与变更索引）
需求：ppm/projects「发起团队」直达会话页（跳 /sessions?new=1 自动进预会话）
根因：原按钮只跳 /sessions 空门户态，用户还要手动点组头「＋」→ 两步浮层 → 才能开始对话，用户反馈应直接进入会话页面
方案：① 按钮改跳 /sessions?new=1；② SessionsPortal 挂载解析 ?new=1（?session= 深链优先），机器数据就绪后 resolveDefaultMachineId（D-005 三级回退）解析默认机器，取其在线 claude/codex runtime（默认 Claude 与浮层一致）直接 enterPreSession 进预会话态，未命中自动弹两步浮层兜底；③ handlePickerPick 主体提取 enterPreSession 两入口共用，X-13 双传语义不变
结果：门户新增 4 用例全绿（直达/浮层兜底/深链优先/workspace 绑定），projects 页断言更新 2/2，sessions 域 6 文件 114 用例全绿，tsc --noEmit 与 next lint 干净

## ql-20260823-006-80c8 | 2026-08-23 13:10:33 | (quick 任务)
状态：进行中
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/session-manager.test.ts, backend/app/modules/daemon/session/service.py, backend/app/modules/daemon/tests/test_session_reopen.py
