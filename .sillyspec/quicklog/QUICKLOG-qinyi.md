
## ql-20260904-012-9a2b | 2026-09-04 08:35:20 | token 词元消耗单位统一 K/M 废除万单位
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/format-token.ts（k→K）
- frontend/src/components/daemon/runtime-card-helpers.tsx（formatTokens k→K）
- frontend/src/components/daemon/session-usage-bar.tsx（formatTokensZh→formatTokensCompact）
- frontend/src/components/changes/detail/change-usage-card.tsx（同款重写）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx（同款重写）
- frontend/src/components/changes/quicklog-table.tsx（同款重写）
- 11 个测试文件（断言万→K/M 与 k→K 同步）
需求：token 词元消耗单位统一 K/M 废除万单位
根因：四处用量展示用中文万级缩写（X.X 万），另两处用小写 k——用户要求统一 K/M 且不用万
方案：session-usage-bar / change-usage-card / changes 页 / quicklog-table 的 formatTokensZh 重写为 formatTokensCompact（>=1M→X.XM；>=1K→X.XK；K 以下原值）；runtime-card-helpers formatTokens 与 lib formatTokenCount 小写 k→K；请求次数/轮次/耗时不变
结果：11 个受影响测试文件 137 用例绿（sessions/page.test 2 个触顶分页用例为预存失败，stash 原始版本复现实证与本改动无关）；tsc --noEmit 0 错误；frontend.changelog.md 已同步

## ql-20260904-013-6fd8 | 2026-09-04 08:58:40 | 会话页失败卡两缺口修复——错误原文不进回复气泡+影子直聊 prompt 提取
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-assembler.ts（classifySessionLog 增错误特征行丢弃）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 前导条剥前导后收 prompt）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（新增丢弃 describe 5 用例）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（新增前导 prompt 3 用例）
需求：会话页失败卡两缺口修复——错误原文不进回复气泡+影子直聊 prompt 提取
根因：会话 2f08b5da 实证：CLI 把远端 401 误报的 Not logged in 行在会话页装配器被当 agent 回复渲染成气泡（09-03 修复只盖 normalize 日志管线）；影子直聊仅一条带前导 user_input 被 logsToTurns 整条跳过，prompt 收空致无用户气泡且失败卡无重发按钮
方案：①session-log-assembler classifySessionLog 增丢弃规则：[ASSISTANT] 前缀 + isAssistantApiErrorText 特征（Not logged in / Please run /login / API Error / Request rejected）返回 null，展示归 RunErrorItem；②logsToTurns 前导条不再 continue，stripPreambleText 剥前导后剩余正文（trim）进既有二阶段归并（常规双写同主体不双显，纯系统注入仍跳过）
结果：assembler 72（新增 5 用例）+ sanitize 42 + helpers 25（新增 3 用例）= 146 绿 + normalize 59 绿 + tsc 0；page.test 仅 2 个已知预存触顶失败（stash 实证与本改动无关）；frontend.md/frontend.changelog.md 已同步
审计：📝 文档欠账（D-8）：4 个源码文件改动未同步任何模块文档（涉及模块：frontend）

## ql-20260904-014-f4c6 | 2026-09-04 09:09:22 | 修复冒烟发现的两个 P1（quick-chat 端点 workspace 缺失派发失效
状态：已完成
关联变更：（无）
文件：backend/app/modules/spec_workspace/tests/test_sync_incremental.py
需求：修复冒烟发现的两个 P1（quick-chat 端点 workspace 缺失派发失效；spec-sync apply_ops 并发重复插入 500 拖死会话启动）。
根因：①quick_chat 不传 workspace_id，placement.dispatch_to_daemon Branch 0 对 None 直接抛 NoOnlineDaemonError（2026-06 workspace 绑定模型后端点未跟上）；②apply_ops 对 pending_adds 走 ORM 裸 INSERT，归档移动场景 daemon/CLI 双端并发推同 path（read-check-insert TOCTOU）撞 ux_spec_manifest_ws_path 唯一约束整批 500。
方案：①main.py quick_chat 解析用户首个 user_workspace_roles 成员关系作 dispatch workspace_id（UUID 参数 .hex 双方言安全；无成员关系失败原因中文化）；②pending_adds 改 pg_insert ON CONFLICT DO UPDATE 幂等 upsert（version 用 case 高位对齐保 SQLite 兼容）。
结果：dcb027fcc 提交并推送；342 相关测试全绿（含新增并发回归用例）+ruff/format 过；调试中顺修 UPDATE 参数 UUID 绑定与 str(uuid) 连字符不匹配两个次生坑。

## ql-20260904-015-a399 | 2026-09-04 09:47:58 | 修复 backend/frontend/daemon 三处 CI 失败（mypy 5 错误 + 加载更早两断言 + session-plan-bash-even…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/tests/test_session_provider_caps.py（删 2 处失效 type: ignore）
- backend/app/modules/daemon/tests/test_run_sync_golden_parity.py（_canon_stdout_contents 标注 set[str|None]）
- backend/app/modules/daemon/tests/test_group_p2.py（mention preview 局部变量窄化）
- backend/app/modules/daemon/tests/test_group_chat_management.py（删 1 处失效 type: ignore）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（两断言补 signal expect.any(AbortSignal)）
- sillyhub-daemon/tests/session-plan-bash-events.test.ts（harness 接真实归一化器 + user 消息标准形状）
需求：修复 backend/frontend/daemon 三处 CI 失败（mypy 5 错误 + 加载更早两断言 + session-plan-bash-events 14 用例）
根因：backend 是类型债（2 处 type: ignore 已失效未删、1 处 set 标注未含 None、1 处 Optional 下标未窄化）；frontend 是 19d845c91 给加载更早请求加 AbortController 后漏改两处旧断言；daemon 是 13205757f AgentEvent v2 把 onTurnMessage 契约改为 envelope 且归一化下沉 driver，老测试仍喂 raw SDK 消息
方案：backend 纯类型修复不动逻辑；frontend 断言补 signal: expect.any(AbortSignal)；daemon 测试 harness 包真实 ClaudeEventNormalizer 保持喂 raw 消息的端到端口径，6 处 user 消息改标准 SDK 形状 message.content
结果：backend mypy 834 文件 0 错 + 4 文件 pytest 74 过 + ruff/format 0；frontend page.test.tsx 29/29 绿 + tsc 0；daemon session-plan-bash-events 31/31 绿 + tsc 0
审计：📝 文档欠账（D-8）：6 个源码文件改动未同步任何模块文档（涉及模块：frontend）

## ql-20260904-016-7cab | 2026-09-04 10:24:42 | 会话首响 46.5 秒全面优化（spec 同步并行化+原子替换、8 秒死等移除、bundle gzip 传输+服务端缓存、安装器 Defender 排除）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/spec-sync.ts（extractTar 两段式并行写+tmp 原子交换+trash 后台清理+错误带内因）
- sillyhub-daemon/src/hub-client.ts（getSpecBundle 超时 30s→120s（SPEC_BUNDLE_TIMEOUT_MS））
- sillyhub-daemon/scripts/install.ps1（安装时加 ~/.sillyhub Defender 排除（UAC 提权 120s 超时不阻塞））
- sillyhub-daemon/tests/spec-pull-swap.test.ts（新 8 用例覆盖交换语义）
- backend/app/modules/daemon/session/service.py（create 两路径去掉 8s ready 死等）
- backend/app/modules/spec_workspace/service.py（build_bundle gzip_output+gzip 字节缓存）
- backend/app/modules/spec_workspace/router.py（bundle 端点 Accept-Encoding 协商）
- backend/app/modules/platform_sync/router.py（CLI 拉取口子同款协商）
- backend/app/modules/spec_workspace/tests/test_bundle_sync.py（gzip 往返/协商/缓存 3 用例）
需求：会话首响 46.5 秒全面优化（spec 同步并行化+原子替换、8 秒死等移除、bundle gzip 传输+服务端缓存、安装器 Defender 排除）
根因：pullSpecBundle 串行 rm+逐文件写经杀软放大约 30 秒、backend create 路径原地等 session ready 8 秒冷启动必超时、36MB 全树 tar 经 Docker 转发 15-30 秒打穿 daemon 30 秒 fetch 超时导致 pull 恒失败、后端每次冷打包经 bind mount 逐文件读 15-20 秒
方案：daemon 侧 extractTar 两段式 16 并行写加 tmp 目录原子交换与后台清理、getSpecBundle 超时放宽 120 秒、install.ps1 安装时自动加 Defender 排除（UAC 提权带 120 秒应答超时）；backend 侧 create 两路径去掉 8 秒死等改立即发 SESSION_INJECT、bundle 双端点按 Accept-Encoding 协商 gzip 并按工作区与版本缓存 gzip 字节
结果：E2E 实测 POST 8.2 秒降至 0.1-0.3 秒、pull 由 30 秒超时失败降至缓存命中约 1.5 秒（冷预热一次性约 41 秒后全命中）；新增 daemon 测试 8 例加 backend 测试 3 例、既有套件零回归、ruff 与 mypy 与 tsc 全过；本机 Docker 镜像已重建并重装 daemon 完成部署验证
审计：⚖️ 归属切分：4 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/hub-client.ts, sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts, sillyhub-daemon/tests/spec-pull-swap.test.ts

## ql-20260904-017-28be | 2026-09-04 10:27:17 | daemon 会话创建凭证持久化——修复重启后 SDK 裸起 Not logged in
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/types.ts（CreateSessionInput 加 providerConfig）
- sillyhub-daemon/src/interactive/session-manager.ts（state 记录（与并行 stale-running 改动同文件））
- sillyhub-daemon/src/daemon.ts（create 透传（同上））
- sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts（PERSIST-0/0b 用例）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引）
需求：daemon 会话创建凭证持久化——修复重启后 SDK 裸起 Not logged in
根因：claim 下发的 provider_config 只进 spawn env（内存），state.providerConfig 唯一赋值点是切换供应商——首次创建的会话凭证从不落盘 sessions.json（18 会话实证全无 providerConfig 键），daemon 重启后恢复链无凭证 + claude 隔离目录无登录态 → SDK 报 Not logged in（0 次 API 请求，被误读为远端 401）
方案：types.ts CreateSessionInput 加 providerConfig 可选字段；session-manager _createInternal 建 state 条件展开记录（null 不写键，复用既有 snapshotPersistable 落盘 + restore 读回链）；daemon.ts _startInteractiveSession create 调用透传 execPayload.provider_config
结果：config-switch 29 用例（新增 PERSIST-0/PERSIST-0b：create 带凭证落盘/不带不落键）+ pending-switch/profile/main-agent-mcp 41 用例全绿 + tsc 0；sillyhub-daemon.md 变更索引已同步；session-manager.ts/daemon.ts 混有并行会话 stale-running 改动未整体暂存（防夹带），提交需分离 hunk

## ql-20260904-018-16e4 | 2026-09-04 10:35:05 | 修 admin/organizations 树表子行断言 CI 抖动（研发部 getByText 扑空）
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/admin/organizations/__tests__/page.test.tsx（研发部断言 get→find，子行晚一帧根因注释）
需求：修 admin/organizations 树表子行断言 CI 抖动（研发部 getByText 扑空）
根因：antd Table 树表子行在慢速 CI 机上比父行晚一个渲染提交，测试用同步 getByText 断言子行文本，本地快机恒绿但 CI 连续两次红同一处
方案：同步 get 改 await findByText 等待子行渲染，注释记录根因
结果：本地连跑 3 次 5/5 绿；纯测试断言改动无实现影响
审计：📝 文档欠账（D-8）：1 个源码文件改动未同步任何模块文档（涉及模块：frontend）

## ql-20260904-019-17cc | 2026-09-04 12:17:36 | 修复 pullSpecBundle 成功后不回写本地 manifest 缓存导致 push-before-pull 误冲突拦截 pull（ql-20260904…
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/spec-sync.ts（pullSpecBundle 落地后 buildFullManifest 重建 manifest 缓存）
- sillyhub-daemon/tests/spec-pull-swap.test.ts（+3 用例）
- sillyhub-daemon/tests/task-09-spec-pull-push.test.ts（4 用例改两轮 lease 新契约）
需求：修复 pullSpecBundle 成功后不回写本地 manifest 缓存导致 push-before-pull 误冲突拦截 pull（ql-20260904-016 遗留缺口）
根因：pull 整树覆盖本地后 manifests 缓存仍是上次 push 时旧态，版本文件丢失或 mtime 信号触发回灌时 diff 出全量假 ops，撞服务器 base_version 乐观锁判 conflict 后 abort pull
方案：pull 落地后用落地树 buildFullManifest 重建 manifest 缓存，version=0 对齐 full-tar 回退语义，真实改动走同内容豁免或既有降级链
结果：spec-pull-swap +3 与 task-09 四用例改两轮 lease 新契约，16+77 用例全绿，tsc 零错误
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/spec-pull-swap.test.ts, sillyhub-daemon/tests/task-09-spec-pull-push.test.ts

## ql-20260904-020-7ceb | 2026-09-04 13:22:39 | 修影子会话 AskUserQuestion 弹窗被 manual_approval 闸门吞掉 + 自更新忙屏障被 stale-flip 绕过杀活轮 + 离线判死…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/group/service.py（影子建行 config 显式 True + 存量自愈 False/None→True）
- backend/app/modules/daemon/sweep.py（非 worker run 判死补 daemon_interrupted+中文原因）
- sillyhub-daemon/src/interactive/session-manager.ts（hasRunningTurn stale-flip 宽限臂+共享谓词）
- sillyhub-daemon/tests/session-manager-busy-check.test.ts（新增 4 用例）
- backend/app/modules/daemon/tests/test_group_mention_pipeline.py（建行断言更新+新增自愈用例）
- backend/app/modules/daemon/tests/test_session_reconnect_sweep.py（新增 error_code/output 断言）
需求：修影子会话 AskUserQuestion 弹窗被 manual_approval 闸门吞掉 + 自更新忙屏障被 stale-flip 绕过杀活轮 + 离线判死无原因
根因：quick-6966fcee 删 config.manual_approval=False 意图放开弹窗，但 permission_service 闸门 is not True 对 None 同样拒，AskUserQuestion 被吞前端收不到 agent 死等；等答题的安静轮被 60s stale-flip 翻 active 后自更新忙屏障只认 running，12:39 新版发布 daemon 重启杀活轮；sweep 非 worker run 判死不写原因，前端只能显示运行失败无详情
方案：group/service.py 影子建行 config 显式 manual_approval/ask_user_only true 且存量自愈升级为 False/None 一律修成显式 True；daemon hasRunningTurn 新增 stale-flip 宽限臂与写通道守卫共用谓词；sweep 非 worker 判死补 daemon_interrupted + 中文原因经 failure_summary 透出前端
结果：backend pytest 34+13 全绿 ruff 0 告警，daemon vitest 16+43 全绿 tsc 0 错，存量 7 行 group_member config 已回填（含事故会话 e148364e 立即恢复弹窗），待提交并重建 backend 镜像部署生效

## ql-20260904-021-ea77 | 2026-09-04 14:39:39 | 本地 Agent 日志收纳会话面板顶部折叠栏
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/agent-log-card.tsx（AgentLogCard 改顶部折叠栏形态）
- frontend/src/components/daemon/session-panel.tsx（挂载点 streamFooter→顶部（横幅下/主体上））
- frontend/src/components/daemon/turn-timeline.tsx（streamFooter 注释标注暂无消费方）
- frontend/src/components/daemon/__tests__/agent-log-card.test.tsx（头注释+顶部栏根断言）
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（变更索引补 ql-20260904-021-ea77）
需求：本地 Agent 日志收纳会话面板顶部折叠栏
根因：无，纯样式与挂载位置调整——用户反馈会话主面板里的本地 Agent 日志信息块挤占聊天窗口，要求移到顶部点击再展示
方案：AgentLogCard 从对话流尾部气泡条目（turn-timeline streamFooter 挂载）改为面板级整宽折叠栏，挂横幅之下/会话主体之上；默认一行摘要细栏点击展开明细（明细/复制/查看内容/展开全部/刷新交互保留）；新增 mobile prop 对齐横幅内边距；纯 tool_report 主体不重复挂载；turn-timeline 注入口保留备用
结果：agent-log-card 23 用例（补顶部栏根断言）+ session-panel×15/turn-timeline×5 相关套件 231 用例全绿，tsc 0，eslint 0 新增告警（仅存量），改动文件已 git add

## ql-20260904-022-ab52 | 2026-09-04 14:44:52 | 修 WS 送达控制指令 ack 无冲刷触发点（daemon 消费后立即回执）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/control-dispatcher.ts（immediateAck 选项+_queueAck 入桶即冲刷）
- sillyhub-daemon/src/daemon.ts（_dispatchControl 传 immediateAck: true）
- sillyhub-daemon/tests/control-dispatcher.test.ts（新增 4 用例）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引追加 ql-20260904-022）
需求：修 WS 送达控制指令 ack 无冲刷触发点（daemon 消费后立即回执）
根因：ack 冲刷只在 pullAndConsume（触发=心跳 pending_controls>0 或重连对账），而 pending_controls 只统计 pending 行、WS 送达即 delivered 的指令永不触发——ack 永远留队，10 分钟后 backend GC 按 delivered-未-ack 联动判死 run，误杀等 AskUserQuestion 用户回答的活轮（事故会话 e148364e，run ca7ec9b8，点选报 no active run to approve）
方案：control-dispatcher consume() 新增 immediateAck 选项（入桶后 fire-and-forget 冲刷该 runtime 桶，失败留队由补拉/重连兜底，UNKNOWN 桶维持捎带）；daemon.ts _dispatchControl 传 immediateAck: true；补拉路径不传保持批尾单次冲刷
结果：control-dispatcher 新增 4 用例 19/19 绿；近邻 10 套件 146/146 绿；tsc --noEmit 0

## ql-20260904-023-0bea | 2026-09-04 15:05:29 | permission_response 下发 payload 补 runtime_id（daemon ack 归属桶键）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/permission_service.py（三处 ws_payload 补 runtime_id）
- backend/app/modules/daemon/tests/test_session_permissions.py（断言补 runtime_id + 新增 dialog 用例）
- sillyhub-daemon/src/protocol.ts（PermissionResponsePayload 加可选 runtime_id）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引 ql-20260904-023）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（ql-022 条目补收口注记）
需求：permission_response 下发 payload 补 runtime_id（daemon ack 归属桶键）
根因：ql-20260904-022 immediateAck 修复后残余缺口：permission_response 三处下发点（plain 审批 / dialog 应答 / 超时 deny）payload 无 runtime_id，daemon WS 消费后 ack 落 UNKNOWN 桶、无后续事件时等不到补拉捎带——超时 deny 行过期还会把 pending timer 状态的 run 一并按 delivered-未-ack 判死（同一误杀的变体）
方案：backend permission_service 三处 ws_payload 统一带 runtime_id（plain/dialog 取 session_obj.runtime_id，超时路径 None 省略），旧 daemon 忽略未知键向后兼容；daemon protocol.ts PermissionResponsePayload 加可选 runtime_id 标注契约；期间发现编辑时误改既有用例 test_non_owner_session_raises_not_found 的 user_id=other_uid→uid（预期 404 的用例被改坏成必失败），已还原
结果：backend test_session_permissions 三处断言补 runtime_id + 新增 dialog 应答 payload 用例（事故路径回归），permission/control 相关 6 套件 97/97 绿；ruff check/format 0；daemon tsc --noEmit 0
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_session_permissions.py, sillyhub-daemon/src/protocol.ts

## ql-20260904-024-e59b | 2026-09-04 15:29:03 | 修 daemon-ci/backend-ci 两处红——init-lease 测试适配 pull manifest 回写新契约 + sweep 非 worker…
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/tests/test_init_lease.test.ts（ws-init-ok 改锁 post 跳过契约 + order-C/postfail 两例 spawn 写骨架文件使 post 真实触发 + 头部注释补 ql-019 语义）
- backend/app/modules/daemon/sweep.py（非 worker 判死 error_code 收窄 active_main_ids + pending_ids 无码收敛分支 + docstring 同步）
- backend/app/modules/daemon/tests/test_worker_redispatch.py（_run_row 补 output_redacted + 主会话 active 回归锁改锁新行为）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引加 ql-20260904-024-e59b（post 条件触发契约））
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引加 ql-20260904-024-e59b（收窄与重派封堵依据））
需求：修 daemon-ci/backend-ci 两处红——init-lease 测试适配 pull manifest 回写新契约 + sweep 非 worker 判死 error_code 收窄回 design 边界（封堵 worker pending 未评审自动重派回归）
根因：①28bf3bc3e(ql-019) pull 成功后按落地树重建 manifest 缓存，handleInitLease 第4步 post 在 init 无新增文件时 diff 恒零按契约跳过，test_init_lease 两例仍锁「init 后必 post」旧前提致 daemon-ci 红；②87d237f68(ql-020) 给非 worker 判死补 daemon_interrupted 的分桶口径是 active worker 之外全部，越界 design「pending 档不加分流」显式边界覆盖 pending 档（含 worker pending），且 worker pending 落码后命中 sweep retry_seeds 自愈查询会在 runtime 回在线时被自动重派（从未开跑的 run 重建 lease），backend-ci 3 例红
方案：①test_init_lease ws-init-ok 改锁无改动跳过 post，order-C 与 postfail 两例 spawn mock 镜像 sillyspec init 落骨架写真实文件使 post 真实触发（保住时序覆盖与 R-03 软失败路径不空转），生产代码零改动；②sweep.py error_code+output_redacted 赋值收窄到 active_main_ids、新增 pending_ids 无码收敛分支，docstring 同步；test_main_active_suspended_regression_locked 改锁新行为（daemon_interrupted+可读原因，_run_row 补 output_redacted），pending 档两例不动随收窄复绿；两模块文档变更索引各加 ql-20260904-024-e59b 条目
结果：daemon test_init_lease 28/28 绿（原 2 红）+tsc 0；backend daemon 模块 1974 passed（原 3 红）+patrol 4 文件 89 passed+ruff 0+mypy 0；frontend-ci 用户所贴失败实为 02:25 旧红（admin/organizations 抖动）已被 d56b01d41 修复，远端 main frontend-ci 当前绿；待推送后 CI 复验

## ql-20260904-025-45f7 | 2026-09-04 15:54:46 | 修归档变更步骤时间线丢失——rename 检测跨日期兜底+progress 收件箱改名迁移
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/service.py（_strip_date_prefix+_detect_renames 描述段兜底+_rename_progress_rows 收件箱改名迁移）
- backend/app/modules/change/tests/test_reparse_delete_closure.py（3 个归档 rename 用例+_seed_progress_row steps 参数+_seed_archived_change helper）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引加 ql-20260904-025-45f7 条目）
需求：修归档变更步骤时间线丢失——rename 检测跨日期兜底+progress 收件箱改名迁移
根因：CLI 归档把目录改名「去源日期+拼归档日期」，_detect_renames 同日期前缀匹配必然 miss，旧行误判 orphaned 进删除环物理删且 _delete_progress_rows 连带清 platform_change_progress 收件箱 steps；新归档行 key 变了投影 join 也 miss，前端 steps 为空即不渲染时间线卡片
方案：①_detect_renames 增描述段兜底（_strip_date_prefix 剥 YYYY-MM-DD- 前缀，唯一候选才配对，≥2 静默放弃）②新增 _rename_progress_rows（主 commit 后独立短事务 best-effort）：新名无行直接改 change_name，已有行则目标 steps 空时回填源 steps 再删源行
结果：新增 3 用例（跨日期匹配+迁移/目标已存在回填合并/描述段二义放弃）；change 模块 500 passed 2 skipped、platform_sync 189 passed、删除闭环文件 14 passed，ruff check/format 干净、mypy 0 issue；存量已丢 steps 的归档行不可恢复（项目未上线不补历史兼容）

## ql-20260904-026-ad9b | 2026-09-04 20:53:22 | daemon register 拒绝时终端中文提示+后台进程日志 tee 落 daemon.log
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（buildRegisterFailureHint+_registerFailStreak 节流+恢复提示）
- sillyhub-daemon/src/cli.ts（attachConsoleToLogFile console tee+startAction 非 TTY 挂接）
- sillyhub-daemon/tests/daemon-register-error-hint.test.ts（新建 6 用例）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引加 ql-20260904-026-ad9b）
需求：daemon register 拒绝时终端中文提示+后台进程日志 tee 落 daemon.log
根因：换账号 API Key 复用机器身份被 403 ownership mismatch 拒绝时 daemon 只在内部日志静默重试，且自更新 respawn（stdio=ignore）与 VBS 隐藏自启的 console 输出凭空丢失，用户看到启动命令退出即误判启动不了且零提示（2026-09-04 实事故）
方案：daemon.ts 新增 buildRegisterFailureHint（403 ownership 单列含两条出路/401 重签 key/通用一行，网络错静默）+ _registerFailStreak 节流（首错立即每 5 次重发，成功清零并提示注册已恢复）；cli.ts 新增 attachConsoleToLogFile（console 四方法 tee 到 daemon.log，!stdout.isTTY 时挂接覆盖 respawn 与隐藏自启两场景，幂等+失败静默防递归）
结果：新建 daemon-register-error-hint.test.ts 6 用例 6/6 绿（403 首提示/节流静默+第 6 次重发/恢复提示+清零/401 文案/网络错无提示/tee 落文件+幂等）；近邻 multi-runtime/heartbeat-sillyspec/daemon/cli/preflight/autostart 6 套件 208 passed 8 skipped；tsc 0

## ql-20260904-027-25f6 | 2026-09-04 22:12:48 | 修三件部署遗留——daemon 服务器轮询自更新+runtime 归属自愈+entrypoint chown 守卫
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（startServerVersionProbe+reason 扩 server_poll+getter）
- sillyhub-daemon/tests/daemon-server-version-probe.test.ts（新建 5 用例）
- backend/app/modules/daemon/runtime/service.py（runtime else 支 user_id 对齐+日志）
- backend/app/modules/daemon/tests/test_register_heartbeat_daemon.py（新增归属对齐用例）
- backend/docker-entrypoint.sh（chown -R 属主守卫）
- 两模块文档（变更索引）
需求：修三件部署遗留——daemon 服务器轮询自更新+runtime 归属自愈+entrypoint chown 守卫
根因：①运行中自更新只有平台 WS 指令与磁盘旁路探测两触发源，无服务器轮询，部署新 bundle 后运行中 daemon 永不自发现（等 11 分钟零触发实事故）②register runtime 更新分支从不写 rt.user_id，实例归属改绑后 runtime 永挂旧用户致 pending-controls 等端点恒 404（7 runtime 全 404 实事故，存量已 SQL 同步）③entrypoint chown -R 对 67847 文件在 Docker Desktop virtiofs 实测 114s，每次启动阻塞 alembic/uvicorn 前（claude plugin 同步实测 1s 排除）
方案：daemon.ts 新增 startServerVersionProbe（复用 self_reload_check_interval_sec，fetchLatestBuildId 严格不等即回调 _tryUpdate('server_poll') 进既有升级链，reason 联合类型三处扩 server_poll，start/stop 接线+serverVersionProbeActive getter）；backend runtime/service.py register 更新分支对齐 rt.user_id+realigned 日志；docker-entrypoint.sh chown -R 前 stat 根目录属主守卫（已 app 即跳过）
结果：daemon 新建 daemon-server-version-probe.test.ts 5/5 绿；自更新近邻 disk-probe-pending+selfupdate-orchestrator 48 passed；tsc 0。backend daemon 模块 1975 passed、register 文件 15 passed（含新归属对齐用例）、ruff/mypy 干净、entrypoint sh -n 过。未部署（本地 daemon 现连阿里云，部署后靠新轮询自更新即可验证端到端）
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/daemon-server-version-probe.test.ts

## ql-20260904-028-3cb5 | 2026-09-04 22:14:40 | 工作区 spec 策略支持修改——前端补修改入口
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/spec-workspaces.ts（新增 updateSpecWorkspace PATCH 客户端函数）
- frontend/src/components/workspace-config-card.tsx（策略行 owner 门禁修改入口 + Modal 三选保存）
- frontend/src/components/workspace-config-card.test.tsx（新增 5 用例（门禁/同值禁存/成功链路/警告/失败态））
- frontend/src/lib/spec-workspaces.test.ts（新增 lib 透传测试（新文件））
- .sillyspec/docs/SillyHub/modules/spec_workspace.md（注意事项补策略修改生效语义）
- .sillyspec/docs/SillyHub/modules/frontend_components.md（配置卡条目 + 变更索引）
需求：工作区 spec 策略支持修改——前端补修改入口
根因：后端 PATCH /spec-workspace 早已支持改 strategy，但前端无任何入口（lib 无客户端函数、配置卡策略行只读 Badge），用户创建时选错策略后无法调整
方案：lib/spec-workspaces.ts 新增 updateSpecWorkspace（PATCH 三字段 omit 不改）；workspace-config-card 策略行加 owner 门禁「修改」入口：antd Modal 三选（与创建对话框同文案、repo-native 写源项目警告、同值禁存），保存成功 toast 提示点「初始化」重建本地缓存；生效语义：改库对后续 dispatch 实时生效（lease 每次读库），daemon 缓存布局等下次无条件 pull（初始化链路）重建，语义落 spec_workspace.md 注意事项 + frontend_components.md 变更索引
结果：vitest 相关 2 文件 38/38 绿（新增 8 用例：组件 5——owner 门禁/同值禁存/保存成功链路/repo-native 警告/失败保持 Modal；lib 3——PATCH 透传/三策略值/422 抛 ApiError）；tsc --noEmit 0 错；eslint 改动文件 0 错 4 条既有告警；后端零改动

## ql-20260904-029-9254 | 2026-09-04 22:33:17 | 清理 PI 接入 verify 登记的 4 项 P3 遗留
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：清理 PI 接入 verify 登记的 4 项 P3 遗留。
根因：①F-1 backend Literal 修复缺直接回归用例 ②群聊两文件引擎白名单未加 pi ③canResumeSession 硬编码 claude||codex ④picker 空态文案未提 PI。
方案：①TestPiProviderLiteral 参数化用例断言三 provider 非 422 ②两文件 ENGINE_OPTIONS+GROUP_SUPPORTED_PROVIDERS 加 pi ③改查 getProviderCaps().resume ④文案三引擎。
结果：5b8f2d156 已推送；backend 36 passed+frontend 120 passed+tsc 零错+ruff 过；PI 三路径（门户/对话框/群聊）可选+caps 化续聊。知识沉淀：无新条目（白名单模式已在 frontend_components.md+onboarding 档B 第 10 步）

## ql-20260904-030-45d1 | 2026-09-04 22:40:42 | spec 策略透传缺口修复——普通会话/主控 lease 补 specStrategy 回退源
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/lease/context.py（tar 分支 specStrategy 回退读 _resolved_spec_ws.strategy）
- backend/app/modules/daemon/tests/test_build_claim_payload.py（新增 S1-S3 断言矩阵与 _create_spec_ws 夹具）
- frontend/src/components/workspace-config-card.tsx（Tooltip/Modal 文案校准（后续任务拉取也按新策略））
- frontend/src/lib/spec-workspaces.ts（lib 注释生效语义校准）
- .sillyspec/docs/SillyHub/modules/spec_workspace.md（策略修改条目更新为回退源已补）
- .sillyspec/docs/SillyHub/modules/frontend_components.md（028 条目生效语义同步）
需求：spec 策略透传缺口修复——普通会话/主控 lease 补 specStrategy 回退源
根因：claim payload 的 specStrategy 原只读 lease_meta.spec_strategy（仅扫描派发写），普通工作区会话与 orchestrator 主控 lease 不带该键 → daemon pullSpecBundle 按 platform-managed 兜底，version 变化的覆盖拉取会拆 repo-native junction（策略静默退化，ql-20260820-007 只修了 daemon 侧透传、后端漏补）
方案：context.py _build_claim_payload tar 分支单点收口：来源优先级改 lease_meta.spec_strategy > SpecWorkspace.strategy（latestSpecVersion 同一查询已带出的 _resolved_spec_ws，零新增 DB 查询，claim 时点读库更新鲜）；scan 显式值优先零回归、quick-chat/mission_worker ws_id=None 不下发、daemon 零改动（双写字段 execPayload 归一化已消费）；test_build_claim_payload.py 补 S1-S3 断言矩阵；前端三处文案/注释与模块文档（spec_workspace.md 缺口改已修、frontend_components.md 028 条目）同步校准
结果：pytest 相关 4 套件 86/86 绿（build_claim_payload 11 含新增 3 + lease_claim_transport 11 + lease_context/provider_priority/session_create_config 53）；ruff 两改动文件 0 错；vitest config-card 35/35；tsc 0 错
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档（涉及模块：backend）
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/tests/test_build_claim_payload.py

## ql-20260904-031-a2a0 | 2026-09-04 23:10:22 | 修 PI 输出碎片乱序：pi-events.ts 升级为有状态轮内合并——text/thinking delta 按 segment 累积+500ms 节流 flush 增量（is_partial+segment_id）+message_e…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260905-001-fc24 | 2026-09-05 01:27:02 | 修复昨日审计 5 项高置信缺陷：spec-sync version=0 必冲突+gzip 缓存不失效+pi segments 撞键+MIN_VERSIONS 缺…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/spec_workspace/service.py（元数据第五键 manifest_versions+apply_ops/软删 bump spec_version）
- backend/app/modules/spec_workspace/tests/test_bundle_sync.py（元数据键集更新+新增 manifest_versions 仅现存行用例）
- backend/app/modules/spec_workspace/tests/test_sync_incremental.py（新增 apply_ops bump 用例（identity map 需 refresh））
- backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py（新增软删 bump 用例）
- sillyhub-daemon/src/spec-sync.ts（pull 后真实版本回填+PLATFORM-BUNDLE.json 上传排除）
- sillyhub-daemon/src/interactive/pi-events.ts（segment 键并入消息序号+message_end/turn_end 清账）
- sillyhub-daemon/src/version.ts（MIN_VERSIONS 补 pi）
- sillyhub-daemon/scripts/install.ps1（Defender 排除收窄到 daemon/specs）
- sillyhub-daemon/tests/spec-pull-swap.test.ts（版本回填+旧 bundle 兼容 2 例）
- sillyhub-daemon/tests/version.test.ts（4 provider 断言+声明必配表条目守护）
- sillyhub-daemon/tests/interactive/pi-events.test.ts（跨消息重号+turn_end 清账回归）
需求：修复昨日审计 5 项高置信缺陷：spec-sync version=0 必冲突+gzip 缓存不失效+pi segments 撞键+MIN_VERSIONS 缺 pi+Defender 排除过宽
根因：28bf3bc3e pull 落地重建 manifest 全 version=0 而 SpecPushConflict 不回退全量 tar，pull 后首次真实改动必撞乐观锁；e7bef3cc0 缓存键 (ws,spec_version) 但 apply_ops/软删绕过唯一 bump 点；b21c17e30 segment 键只含 contentIndex 跨消息重号；7c4dd4efd 版本门禁实际查 MIN_VERSIONS 表而表缺 pi；排除动机只是 spec 缓存写放大却覆盖 agent 代码执行区
方案：backend build_bundle 元数据第五键 manifest_versions（仅 exists 行）随包下发，daemon pull 后回填真实 base_version（旧 bundle 无键退化 0 兼容），PLATFORM-BUNDLE.json 加上传排除；apply_ops/soft_delete_change_dir 同 _write_spec_root 语义 bump spec_version；segment 键改 m<msgSeq>ci<idx>+message_end 清当前段+turn_end 全清；MIN_VERSIONS 补 pi [0,81,0]+声明必配表条目守护；install.ps1 排除收窄到 daemon/specs
结果：backend 3 文件 56 passed 1 skipped（既有 symlink 跳过）ruff 0 mypy 0；daemon 3 文件 72 passed tsc 0；新增回归 7 例；模块文档 2 份同步
审计：📝 文档欠账（D-8）：11 个源码文件改动未同步任何模块文档（涉及模块：backend · sillyhub-daemon）

## ql-20260906-001-9232 | 2026-09-06 22:13:35 | 修复审计两中危项：quick-chat SQLite hex 未归一化派发必败 + isAssistantApiErrorText 全文正则误吞正常回复
状态：已完成
关联变更：（无）
文件：
- backend/app/main.py（daemon-chat 派发 workspace_id 归一化）
- backend/tests/test_daemon_chat_workspace_uuid.py（新建端点回归测试（此前零覆盖））
- frontend/src/components/agent-log/normalize.ts（isAssistantApiErrorText 行首锚定）
- frontend/src/components/agent-log/__tests__/normalize.test.ts（中段提及不误判用例）
- frontend/src/components/daemon/session-log-assembler.ts（丢弃判定注释同步修正）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（中段提及保留 reply 用例）
需求：修复审计两中危项：quick-chat SQLite hex 未归一化派发必败 + isAssistantApiErrorText 全文正则误吞正常回复
根因：raw text() 结果 SQLite 返回 CHAR(32) hex 字符串不经类型回转，placement 内 .hex 对 str 抛 AttributeError 被 except 吞掉误报无在线 runtime；错误词正则全文任意位置匹配，成功 run 正文提到 API Error 等词即被整条丢弃且无失败卡兜底
方案：main.py 派发前 uuid.UUID(x) if isinstance(x, str) else x 归一化（对齐 placement.py raw SQL 先例）；isAssistantApiErrorText 四正则收紧为行首锚定（^ + trimStart），合成错误行恒以特征词开头真阳性零回退，assembler 注释同步修正
结果：backend 新端点回归测试 1 passed（patch dispatch 断言 UUID 实例）+ ruff 0 + mypy 0；前端 2 文件 160 passed + tsc 0；接口无变更免 gen:types；模块文档 2 份同步

## ql-20260906-002-f6b7 | 2026-09-06 22:28:46 | 修复审计 R1：immediateAck 冲刷失败后短退避单次自驱动重试收口误杀残余窗口
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/control-dispatcher.ts（退避常量+Options.ackRetryDelayMs+_ackRetryTimers+_immediateFlushWithRetry）
- sillyhub-daemon/tests/control-dispatcher.test.ts（4 个重试回归用例+waitFor 竞态加固）
需求：修复审计 R1：immediateAck 冲刷失败后短退避单次自驱动重试收口误杀残余窗口
根因：立即冲刷失败仅 warn 留桶，后续唯二触发点（心跳补拉 pending_controls>0 不含 delivered 行 / WS 重连对账）在单次网络失败+WS 不断+10min 无新 pending 组合下都不发生，GC 按 delivered-未-ack 误杀活轮
方案：control-dispatcher 新增 _immediateFlushWithRetry：失败后 CONTROL_ACK_RETRY_DELAY_MS=5000 退避重试一次，按 runtime key 定时器去重、unref、fire 清位；二次失败留桶交还既有兜底；补拉趟批尾 _flushAcks 保持直调零耦合；类头注释同步收窄不做范围
结果：control-dispatcher 23/23（+4 新用例）+ resilience-scenarios 27/27 + tsc 0；模块文档同步

## ql-20260906-003-a611 | 2026-09-06 22:38:48 | 修复审计 #10：vendored pi 扩展树分发链断裂——vendor 永不到 bin 目录致 pi --extension 静默跳过
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/dist_router.py（vendorFiles 清单+vendor 路由）
- backend/Dockerfile（补 COPY build/bundle/vendor）
- backend/tests/test_daemon_dist.py（+5 用例（fixture newline 平台无关））
- sillyhub-daemon/src/preflight.ts（LatestInfo.vendorFiles+updateVendorBundles+isSafeVendorRelPath）
- sillyhub-daemon/tests/preflight-download-replace.test.ts（+5 vendor 用例）
- sillyhub-daemon/scripts/install.sh（vendorFiles 提取+逐文件下载）
- sillyhub-daemon/scripts/install.ps1（VENDOR_FILES+逐文件下载）
需求：修复审计 #10：vendored pi 扩展树分发链断裂——vendor 永不到 bin 目录致 pi --extension 静默跳过
根因：Dockerfile 只 COPY 两个 js、dist_router 只有两条硬编码 bundle 路由、install 与 preflight 无 vendor 清单可拉——build-bundle.sh 拷进的 vendor 在分发链每一环都被丢下
方案：Dockerfile 补 vendor COPY；latest.json 增 vendorFiles 扫描清单+新 vendor 通用路由（双保险路径校验+octet-stream）；install.sh/ps1/preflight 三端按清单逐文件伴生下载（白名单防篡改+tmp+rename 原子+best-effort 单文件失败不中止+旧服务器无键 no-op）
结果：backend test_daemon_dist 14 passed（+5）ruff 0 mypy 0；daemon preflight 51 passed（+5）tsc 0；install.sh bash -n 过、install.ps1 AST parse 过；模块文档 2 份同步；gen:types 单字段债待并行会话收尾统一重生成（openapi 正被他者暂存）

## ql-20260906-004-62c6 | 2026-09-06 23:02:24 | 修复审计 #9：turn 在途 close() 后 consume 挂在轮次等待者永不返回——pi 与 codex 两 driver 统一在 _close 释放
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/pi-rpc-driver.ts（释放器挂槽+_close 调用+finally 清槽）
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（_finishTurnOnClose+循环 closing 守卫+_close 调用）
- sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（turn 在途 close 回归）
- sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（turn 在途 close 回归）
需求：修复审计 #9：turn 在途 close() 后 consume 挂在轮次等待者永不返回——pi 与 codex 两 driver 统一在 _close 释放
根因：close 杀进程后不会再有收敛帧（agent_settled/turn/completed），exit handler 因 closing 早退不兜底，waiter 无人释放→协程+闭包泄漏且 finally 清理被跳过（codex 既有模式，pi 复制引入同款）
方案：释放器挂 handle 内部槽（pi _releaseSettledWaiters / codex _finishTurnOnClose→cancelled）+ _close 置 closing 后调用 + finally 清槽；codex 主循环补 closing 守卫防假 result 上报（对齐 pi 既有守卫）
结果：pi-rpc-driver + codex-app-server-driver(+approval) 3 套件 114 passed（各 +1 回归：turn 在途 close→3s 超时兜底断言 consume 返回且零上报）；tsc 0；模块文档同步

## ql-20260906-001-b9bc | 2026-09-06 22:46:21 | 修复 daemon 四个排查遗留缺陷：macos 自启 plist 不写 PATH 致机器不上线；无 agent 不注册静默无告警；status 回退显示 DEFAULT 档案误导；停机 suspend-batch 404
状态：进行中
关联变更：（无）
文件：sillyhub-daemon/src/autostart/macos.ts

## ql-20260907-001-e373 | 2026-09-07 08:59:09 | 任务执行面板轮次历史懒加载导致摘要轮次计数恒 0/列表空到点开页签才拉
状态：已完成
关联变更：2026-09-04-session-task-execution-panel
文件：frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx, frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx, frontend/src/components/daemon/task-execution-panel.tsx
需求：任务执行面板轮次历史懒加载导致摘要轮次计数恒 0/列表空到点开页签才拉，影响体验，用户要求恢复挂载即取数。
根因：task-10 回归修正时为避开看门狗测试的 listSessionRuns 绝对计数断言加了 runsViewedRef 惰性闸门——测试口径问题不该由产品行为买单。
方案：面板移除闸门恢复 mount/sessionId 即取数（refreshSignal 重拉保留）；connection 测试 5 处绝对计数改挂载后快照增量口径（终态/卸载两处改快照不变断言）；面板测试 4 处还原。
结果：tsc 0 错；面板 12/12+connection 13/13+hook/variant/lifecycle 33/33 全绿；lint 无新增；3 文件已暂存待提交。部署：待提交后重新打包前端镜像更新阿里云
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/brainstorm-numbered-heading-postcheck-parse-gap.md

## ql-20260907-002-b595 | 2026-09-07 09:34:56 | 修复 pi driver pendingTurnError 轮内粘滞：pi 自动重试恢复后 turn 仍误报失败
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/pi-rpc-driver.ts（handleLine 新增轮内恢复清值（turn_end 非 error 原始帧 + text override 全文事件））
- sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（新增 3 用例覆盖恢复/单独恢复信号/防过清）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（MANUAL_NOTES 补 ql-20260907-002 条目）
需求：修复 pi driver pendingTurnError 轮内粘滞：pi 自动重试恢复后 turn 仍误报失败
根因：pendingTurnError 是 consume 内会话级闭包变量，轮内只在下一轮 inject 前清一次（pi-rpc-driver.ts:896）；pi 对 API 失败自动重试，前 2 次 attempt 超时的 ame.error 已写值，第 3 次成功出完整答案后旧值粘滞，agent_settled 后 :928 一票否决把成功轮翻成 error_during_execution（会话 33f958d2 实机）
方案：handleLine 两个轮内恢复信号到达即置 null：① 归一化事件 text+override 全文（message_end assistant 完整产出终态）；② 原始帧 turn_end 且 stopReason 非 error（清在归一化前，真实失败轮 stopReason=error 仍由归一化器产 error 事件重新写入，防过清）。codex driver 不动：双清+成败权威在 turn_status，success 路径本就忽略 stale 值
结果：vitest tests/interactive/pi-rpc-driver.test.ts 48/48 通过（含 3 新用例：33f958d2 复现恢复→success+usage、turn_end stop 单独恢复信号、恢复后真失败仍 error 防过清）；pnpm typecheck 零错误

## ql-20260907-003-271d | 2026-09-07 09:42:46 | daemon inject 早到等待在会话 create 在途时延长：lease 状态机仍在跑就不按固定 60s 丢弃
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（常量区新增 extend 上限 + _awaitSessionThenRoute 在途 lease 逐拍续推 deadline（硬顶 waitMs+extendMax））
- sillyhub-daemon/tests/daemon-inject-drop-report.test.ts（新增用例 I/J（在途延长接住晚到会话 / 在途硬顶防无限等待））
- .sillyspec/docs/sillyhub-daemon/modules/daemon.md（MANUAL_NOTES 补 ql-20260907-003 条目）
需求：daemon inject 早到等待在会话 create 在途时延长：lease 状态机仍在跑就不按固定 60s 丢弃
根因：backend 等 session ready 仅 8s 即 fallback 发 inject，daemon _awaitSessionThenRoute 固定 60s 窗口轮询等 create 写 store，Windows 冷启动 create 全链偶发超 60s（实测 ~31s，会话 1a9c601c 实机超窗）→ 超时被当会话不存在丢弃 + 报 run failed，重发即恢复（瞬时竞态非真死）。WS 短暂离线丢指令已由控制指令三段式落库+补拉覆盖，无需后端缓存重投
方案：_awaitSessionThenRoute 轮询时读 inject payload 的 lease_id：仍在 _inflightLeases（_executeTask try/finally 全程维护，claim→create 全链在途证据）期间逐拍续推 deadline 至 now+waitMs，硬顶 waitMs+extendMaxMs（新常量 DEFAULT_INJECT_WAIT_INFLIGHT_EXTEND_MS=240s，env SILLYHUB_INJECT_WAIT_INFLIGHT_EXTEND_MS 可调，总硬顶 5min）；lease 离开在途（create 完成/失败）即停推，余量到期回落原 005 丢弃上报；lease 不在途的真不存在会话零回归
结果：vitest tests/daemon-inject-drop-report.test.ts 10/10 通过（新增 I 在途延长接住 600ms 晚到会话 / J 在途硬顶 450ms 到顶即丢弃两用例，既有 A-H 零回归）；pnpm typecheck 零错误

## ql-20260907-004-dea5 | 2026-09-07 09:52:32 | Windows 弹黑框修复——三处 agent spawn 补 windowsHide
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/task-runner.ts（批量任务 agent spawn 补 windowsHide）
- sillyhub-daemon/src/interactive/pi-rpc-driver.ts（pi 会话 spawn 补 windowsHide）
- sillyhub-daemon/src/interactive/codex-app-server-driver.ts（codex 会话 spawn 补 windowsHide）
- sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（新增 windowsHide 断言用例）
- sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（新增 windowsHide 断言用例）
- sillyhub-daemon/tests/task-runner.test.ts（主流程用例补 windowsHide 断言）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（变更索引条目）
需求：Windows 弹黑框修复——三处 agent spawn 补 windowsHide
根因：daemon 无自有控制台（IDE 直跑/VBS 隐藏自启）时，Windows 为控制台子进程新开可见命令窗口挂整个会话，pi 会话实测弹窗
方案：task-runner.ts / interactive/pi-rpc-driver.ts / interactive/codex-app-server-driver.ts 三处 spawn options 补 windowsHide: true（CREATE_NO_WINDOW，stdio 管道不受影响，非 Windows 无操作），对齐仓内其余 spawn 点既有约定；三测试文件补对应断言
结果：vitest 定向 3 文件 154 passed（pi/codex 各 +1 用例、task-runner 主流程补断言），tsc 0；模块文档变更索引已同步 ql-20260907-004-dea5
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts, sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts, sillyhub-daemon/tests/task-runner.test.ts

## ql-20260907-005-5858 | 2026-09-07 09:59:33 | daemon 会话创建链加分步计时埋点：慢启动会话可直接从日志归因耗时段
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（_startInteractiveSession 五段计时（borrow_sandbox/skills/spec_pull/mcp_prefetch/create）+ started/failed 汇总 timings/total_ms）
- sillyhub-daemon/tests/daemon-kind-dispatch.test.ts（新增计时埋点断言用例（console.info spy））
- .sillyspec/docs/sillyhub-daemon/modules/daemon.md（MANUAL_NOTES 补 ql-20260907-005 条目）
需求：daemon 会话创建链加分步计时埋点：慢启动会话可直接从日志归因耗时段
根因：ql-20260907-003 只解决了等待侧兜底（在途 lease 延长），但实机 >60s 慢启动案（1a9c601c）无分步数据无法归因是 skills 拷贝 / spec pull / MCP 预取 / spawn 哪段慢——已知 spec 大头已由 ql-20260904-016 修掉，剩余嫌疑需数据说话
方案：_startInteractiveSession 头部建 timings 收集器，五段各记 interactive_create_step（step+elapsed_ms，后置步骤挂死时已完成的分步可定位停点），started/failed 日志汇总 timings+total_ms；纯日志零行为变更
结果：vitest daemon-kind-dispatch 20/20 通过（新增计时断言用例），daemon-inject-drop-report 10/10 回归通过；pnpm typecheck 零错误

## ql-20260907-006-2972 | 2026-09-07 10:11:46 | create 前置链提速：skills/spec/MCP 三步并行化 + skills 拷贝版本跳过
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（skills/spec/MCP 三步 Promise.all 并行化（闭包防御 catch））
- sillyhub-daemon/src/skill-manager.ts（linkSkillsToWorkdir 版本缓存跳过 + resetLinkedWorkdirVersionsForTest）
- sillyhub-daemon/tests/skill-manager.test.ts（新增 3 用例（跳过/刷新/存在性守卫/无 manifest））
- sillyhub-daemon/tests/daemon-kind-dispatch.test.ts（无改动（005 计时用例回归覆盖并行链路））
- .sillyspec/docs/sillyhub-daemon/modules/daemon.md（MANUAL_NOTES 补 ql-20260907-006 条目）
- .sillyspec/docs/sillyhub-daemon/modules/skill-manager.md（MANUAL_NOTES 补 ql-20260907-006 条目）
需求：create 前置链提速：skills/spec/MCP 三步并行化 + skills 拷贝版本跳过
根因：三步互相无数据依赖却串行执行（总耗时=三者之和，Windows 慢启动主因之一）；skills 每会话全量 rm+重拷而内容只在启动 syncSkills 变化（逐文件 IO+杀软扫描 ~8ms/文件）
方案：① daemon.ts 三步改 Promise.all（各步闭包外层防御 catch、specSyncCtx/MCP 写入由收口保证先于 create、005 分步计时保留，并行后各段之和可大于 total_ms 属预期）；② skill-manager linkSkillsToWorkdir 加 (workdir→version) 缓存：版本不变+目标目录在+上轮无失败→跳过（link_skills_version_fresh_skip），存在性守卫兜 worktree 重建，部分失败不记缓存下轮全量自愈，无 manifest 不启用；MCP 工作区缓存不做（不在临界路径+失效语义需设计）
结果：vitest 7 套 86/86 通过（skill-manager 28 含 3 新用例：同版本跳过/版本变更刷新/worktree 重建重拷+无 manifest 不启用；kind-dispatch 20、inject-drop 10、interactive-codex/borrow-sandbox/notify-ready/worker-resume 28 全回归），pnpm typecheck 零错误

## ql-20260907-007-67df | 2026-09-07 11:00:38 | daemon 执行环境 sillyspec 命令注入 SILLYSPEC_SYNC_TIMEOUT_MS=20000 缺省（spec-sync 8s 熔断缓解）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/spawn-env.ts（新增 SILLYSPEC_SYNC_TIMEOUT_MS 常量对 + buildSpawnEnv 填补缺省注入（层 1 后层 0 前））
- sillyhub-daemon/src/sillyspec-manager.ts（runProgressJsonDefault execFile 传 env（缺省垫底+process.env 覆盖），导出供直测）
- sillyhub-daemon/tests/spawn-env.test.ts（新增 4 用例（缺省/预设优先×2/空串填补））
- sillyhub-daemon/tests/sillyspec-manager.test.ts（新增 2 用例（真实 spawn node -e 断言子进程 env））
- .sillyspec/docs/sillyhub-daemon/modules/spawn-env.md（契约/关键逻辑/注意事项同步）
- .sillyspec/docs/sillyhub-daemon/modules/sillyspec-manager.md（注意事项补 runner env 语义）
- .sillyspec/docs/sillyhub-daemon/modules/spawn-env.changelog.md（新建 sidecar 建档）
- .sillyspec/docs/sillyhub-daemon/modules/sillyspec-manager.changelog.md（新建 sidecar 建档）
需求：daemon 执行环境 sillyspec 命令注入 SILLYSPEC_SYNC_TIMEOUT_MS=20000 缺省（spec-sync 8s 熔断缓解）
根因：sillyspec CLI 每步 --done 后自动同步走 8s 总预算熔断，平台 manifest 端点忙时偶发 >8s 触发 abort warn（数据不丢但噪音吓人）；CLI 3.28.1 新增 SILLYSPEC_SYNC_TIMEOUT_MS env 开关（sillyspec 仓 commit 6f17a56），平台侧行动项 1 要求执行环境注入放宽（docs/sillyspec/2026-09-07-spec-sync-abort-classification.md）
方案：spawn-env.ts 新增 SILLYSPEC_SYNC_TIMEOUT_MS_FIELD/DEFAULT_MS('20000') 常量并在 buildSpawnEnv 的 tool_config 层后填补缺省（process.env/tool_config 预设保留、空串视同未配置），覆盖 batch/interactive/restore/reload 全部 agent 子进程；sillyspec-manager.ts runProgressJsonDefault execFile 显式传 env（缺省垫底+process.env 覆盖）并导出，覆盖 daemon 自身 runResolve/ghostCleanup 命令；模块文档 spawn-env/sillyspec-manager 同步 + changelog sidecar 建档
结果：vitest 目标两文件 80 passed（spawn-env 38 + sillyspec-manager 42，含新增 6 用例：缺省注入/process.env 预设/tool_config 预设/空串填补/runner 缺省/runner 预设优先），pnpm typecheck 0 错；行动项 2（端点耗时观测）核对结论为无需改动——backend 监控三件套 2026-07-27 已上线（slow.request>1s/slow.query>500ms/>=10s pg_stat_activity 采样），注入 20s 后熔断事件蕴含服务端 >=20s，观测链完整覆盖

## ql-20260907-008-48b9 | 2026-09-07 12:45:13 | 修复 CI 四类失败：迁移链断链+heartbeat 签名+bundle 五键+前端 mock 债
状态：已完成
关联变更：（无）
文件：
- backend/migrations/versions/20260904223000_add_sillyspec_command_result.py（补提交断链迁移节点（d4fdcc7ac 漏提交））
- backend/app/modules/daemon/runtime/service.py（heartbeat/register 补 sillyspec_command_result 落库语义）
- backend/app/modules/platform_sync/tests/test_spec_bundle.py（四键断言改五键（manifest_versions ql-20260905-001 债））
- frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx（补接线+listSessionRuns 默认 resolve）
- frontend/src/components/daemon/__tests__/session-panel-team.test.tsx（补接线+listSessionRuns 默认 resolve）
- frontend/src/components/daemon/__tests__/session-panel-ctx-tokens.test.tsx（单 resolver 改收集全部 pending+补 listSessionTasks 接线）
- frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx（补 listSessionRuns 接线+默认（防 spyOn fetch 计数污染））
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（补 listSessionTasks 导出+beforeEach 默认）
需求：修复 CI 四类失败：迁移链断链+heartbeat 签名+bundle 五键+前端 mock 债
根因：d4fdcc7ac 夹带 conflict-resolve-entry 的 router/DTO/模型但漏提交 service 实现与 20260904223000 迁移文件，迁移链断链+心跳 TypeError；ql-20260905-001 bundle 加第五键 manifest_versions 未同步测试；4eb9f0626 移除任务面板惰性闸门后 5 个测试文件 mock 债（缺导出/裸 vi.fn()/单 resolver）
方案：补提交迁移文件；heartbeat_daemon/register_daemon 补 sillyspec_command_result 参数（None=清除、非 None 整包直写、register 恒清）；bundle 测试四键改五键+manifest_versions 类型断言；前端 5 文件补 listSessionTasks 接线/导出+listSessionRuns 默认 resolve+ctx-tokens 收集全部 pending resolver
结果：backend 心跳 50 passed+迁移链 16 passed+bundle 12 passed，ruff/format/mypy 0 错；前端 5 文件 125 passed、tsc 0、eslint 0 error；经 worktree 推送 origin/main 修 CI

## ql-20260907-009-26f4 | 2026-09-07 13:22:25 | daemon bundle 构建并上架阿里云自更新分发（含 SILLYSPEC_SYNC_TIMEOUT_MS 注入）+ 交接文档补记
状态：已完成
关联变更：（无）
文件：
- docs/sillyspec/2026-09-07-spec-sync-abort-classification.md（§3 补平台落地记录（commit/build/生效前提）；§4.1 改判已核对无需开发 + 监控三件套补记）
需求：daemon bundle 构建并上架阿里云自更新分发（含 SILLYSPEC_SYNC_TIMEOUT_MS 注入）+ 交接文档补记
根因：env 注入只在 daemon 源码里，须随 backend 镜像 /app/daemon-dist 分发上架后存量 daemon 自更新才能拉到；主树有并发 WIP 不能直接打包，且 e0af8e3a0 单独不可编译需取补齐后的 main HEAD
方案：detached worktree @9a9bd8811（e0af8e3a0 为祖先）干净构建 bundle（BUILD_ID 9a9bd881-20260907132501，注入 5 处验证）→ PROD_API_URL=https://crrcdt.ppdmq.top build-and-save 打镜像（镜像内再验注入+BUILD_ID）→ scp 阿里云双层 deploy 目录 → 旧镜像 tag backup-20260907-1331 后 load + compose up → 服务器 tar 清理与 worktree 删除；交接文档 §3 补落地记录与生效前提（sillyspec 发版 ≥3.28.1）、§4.1 改判已核对无需开发并补记监控三件套（3a181291a）早已存在
结果：部署验证全绿：5 容器 healthy、health ok、latest.json 公网==后端直连==9a9bd881-20260907132501、线上 bundle 含 SILLYSPEC_SYNC_TIMEOUT_MS 5 处、无迁移报错；本机 daemon 现版本 d4fdcc7a-20260907045827 待自更新拉新；仓库改动仅 docs/sillyspec/2026-09-07-spec-sync-abort-classification.md（无代码变更，测试不适用）

## ql-20260907-010-38f5 | 2026-09-07 14:10:37 | spec 拉取工作区级化：心跳驱动后台预取 + single-flight
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/router.py（心跳 DTO spec_cache/spec_versions + IN 批查）
- backend/app/modules/daemon/tests/test_heartbeat_spec_cache.py（新建 3 用例（对答/兼容/归属））
- sillyhub-daemon/src/daemon.ts（single-flight+预取+记账三 Map+specStep 接线+_running 门控）
- sillyhub-daemon/src/hub-client.ts（heartbeat 第 8 参 specCache + HeartbeatBody.spec_cache）
- sillyhub-daemon/src/protocol.ts（HeartbeatResponse.spec_versions）
- sillyhub-daemon/src/api-types.ts + frontend/src/lib/api-types.ts + backend/openapi.json（gen:types 重生成）
- sillyhub-daemon/tests/daemon-spec-prefetch.test.ts（新建 5 用例）
- .sillyspec/docs/{sillyhub-daemon,backend}/modules/daemon.md（MANUAL_NOTES 补 ql-20260907-010）
需求：spec 拉取工作区级化：心跳驱动后台预取 + single-flight，消除每会话全量下载等待
根因：spec pull 挂在会话创建关键路径：同工作区版本每被 agent 会话推进一次，下个会话就现场全量下载（实机 47MB 树压缩 15.9MB / ~0.4MB/s 公网 = 40s+，2057cde1/834486c1 的 spec_pull_ms 44408/42548），并发会话还各拉一份抢同一链路；缓存本是工作区×机器共享但版本恒流动使跳过路径从未触发（日志 0 次）
方案：①daemon _pullSpecShared single-flight：同工作区并发创建/预取共享一次拉取；②心跳协议对答：请求 spec_cache（本机 specs 清单+版本）→ 响应 spec_versions（backend IN 批查权威版本）→ 本地落后且无活跃会话 → 后台预取+bump 版本对齐，创建时只消费缓存或等在途；③活跃会话门控+pull 上下文记账（防后台覆盖 agent 在途工作 / repo-native junction 降级）；④_.running 门控（未启动不上报，心跳位置参数旧形态零回归）；后端 additive 纯读，旧 daemon 零影响
结果：backend 新 3 用例+回归 49 过、openapi 重导、两端 gen:types（frontend node_modules 先 --force 修复）；daemon 新 5 用例（并发一次下载/预取触发+版本对齐 9/活跃门控/版本不落后/旧 backend 兼容）+回归 6 套 97 + spec-sync 37 全过、tsc 0；部署验证待发版（预取生效需 backend+daemon 同升）

## ql-20260907-011-14e0 | 2026-09-07 20:35:12 | pi 任务名升级：message_start(user) 携带的用户指令作 task_name 摘要（替代恒定'执行任务'）
状态：进行中
关联变更：2026-09-07-pi-task-events
文件：sillyhub-daemon/src/interactive/pi-events.ts, sillyhub-daemon/tests/interactive/pi-events.test.ts

## ql-20260908-001-f864 | 2026-09-08 09:10:34 | 修三处 arch-large-file-split 归档遗留债
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（补 AgentLivenessOverviewCard 组件级 mock（data-testid 隔离））
- backend/app/modules/daemon/session/service/control.py（注释合并收敛 801→800）
需求：修三处 arch-large-file-split 归档遗留债
根因：workspaces/[id] 16 失败实为 AgentLivenessOverviewCard 内 useQuery 无 QueryClientProvider（agent-liveness 带入）；antd 6 unhandled 与 openapi 陈旧在 HEAD 已被近期变更消除；control.py 超 ≤800 上限 1 行。
方案：page.test.tsx 仿 ChangesOverviewCard 先例补组件级 data-testid mock；control.py 注释合并收敛 801→800；债②③核实无需变更。
结果：workspaces 16 失败归零（28/28 全绿）、antd 6 unhandled 实测零复现、openapi 与 HEAD 逐字节一致（472 paths 覆盖全 585 routes）、control.py 800 行达标（ruff+799 session 用例全绿）；commit e039f7e3f（2 文件 +10/-2）。

## ql-20260908-002-6cc5 | 2026-09-08 10:16:37 | 修复 daemon liveness 状态上报链路全断：platform_agent_logs 119 行 state 全 NULL，后端零 agent-logs/states 请求；根因待定位（spawn记录空+重扫兜底路径无root t…
状态：进行中
关联变更：（无）
文件：（见实际改动）

## ql-20260908-003-7400 | 2026-09-08 11:56:25 | daemon 会话创建链 spec 拉取改 stale-while-revalidate：本地有版本缓存（哪怕旧）先放行创建、会话启动后后台刷新到服务器版本
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（specStep SWR 分支 + create 后 fire 点 + _revalidateSpecCacheInBackground 新方法）
- sillyhub-daemon/tests/daemon-spec-prefetch.test.ts（用例 A 改无版本记录形态 + 新增 F/G/H/I 四 SWR 用例）
- .sillyspec/docs/sillyhub-daemon/modules/daemon.md（MANUAL_NOTES 补 ql-20260908-003-7400 条目）
需求：daemon 会话创建链 spec 拉取改 stale-while-revalidate：本地有版本缓存（哪怕旧）先放行创建、会话启动后后台刷新到服务器版本
根因：ql-20260907-010 的心跳预取被活跃会话门控挡住（该工作区常态挂活跃会话），spec 版本一前进下一个新建会话必吃 ~40s 内联全量下载（实机会话 a982654f：创建到可用 54s 中 41s 是 v200→v201 现场重拉）
方案：daemon.ts specStep 版本比对分支：lease 版本与本地不一致但本地有版本记录（readLocalSpecVersion 非 null）→ 不再内联 pull 阻塞创建，放行吃旧缓存并挂起 pendingSpecRevalidate；create 成功 + notifySessionReady 后 fire 新方法 _revalidateSpecCacheInBackground（不查活跃门控——触发源是刚创建会话自身、复用 _pullSpecShared single-flight、bump 条件化只前进不回退、失败仅 warn）；本地无版本记录或旧 backend 无版本透传维持内联 pull 旧行为；安全性依据=postSpecSync 增量 ops + base_version 冲突检测 + pull 自带 push-before-pull，旧基座不会冲掉他端改动
结果：vitest daemon-spec-prefetch 9/9（含 4 新用例：放行不等下载/后台对齐、create 失败不 fire、条件 bump skip、后台失败仅 warn）+ 回归 kind-dispatch 20 + inject-drop 10 共 30/30 通过；pnpm typecheck 0 错；daemon.md MANUAL_NOTES 已同步；生效需 daemon bundle 发版上架（阿里云 /app/daemon-dist）
审计：📎 文档引用失效：1/1 处 file:line 失效（sillyspec docs check 可复现）
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/2026-09-07-docs-check-fix-improvement-proposal.md

## ql-20260908-004-2b59 | 2026-09-08 12:26:31 | 修复 CI 两处失败——backend mypy 93 错（daemon 拆分遗留）+ frontend vitest unhandled rejection（…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/router/__init__.py（router 显式 APIRouter 注解修导入环 has-type）
- backend/app/modules/daemon/run_sync/service/submit_steps.py（删 16 处 st.xxx 冗余类型注解）
- backend/app/modules/daemon/_background_tasks.py（task 补 asyncio.Task 注解）
- frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx（daemon mock 工厂补接 listSessionTasks）
- frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx（daemon mock 工厂补接 listSessionTasks）
- frontend/src/components/daemon/__tests__/session-panel-prompt.test.tsx（daemon mock 工厂补接 listSessionTasks）
需求：修复 CI 两处失败——backend mypy 93 错（daemon 拆分遗留）+ frontend vitest unhandled rejection（session-panel 测试漏接 listSessionTasks mock）
根因：backend：2026-09-07-arch-large-file-split 拆分合并进 main 后引入 93 个 mypy 错——router/__init__ 的 router 无显式注解且子模块反向导入成环（mypy 环内推不出隐式类型，12 个 router 子文件 76 处 has-type）、submit_steps.py 16 处对 st.xxx 声明类型（mypy 仅允许 self 属性）、_background_tasks.py 的 task 因 coro: object 推不出类型；frontend：5 个 session-panel 测试在 sessionApi 里定义了 listSessionTasks mock 却没接进 vi.mock 工厂（其中 3 个逐键接线文件漏接、2 个整对象展开文件天然覆盖），真实 fetch 在 jsdom 失败 → useNotify().error → 无 AntApp 上下文 message.error 非函数，迟到异步抛错成 unhandled rejection 致 Vitest 非零退出（3451 断言全过也拦），与卸载竞态故 CI 慢机必现
方案：backend 三处纯注解修复（零运行时行为变化）：router/__init__.py 加 router: APIRouter 显式注解；submit_steps.py 删 16 处冗余 st 注解（_SubmitState dataclass 已声明全部字段）；_background_tasks.py 给 task 补 asyncio.Task 注解。frontend 三文件（variant/pre-session/prompt）对齐其余 8 文件既有模式在 listSessionRuns 行后补 listSessionTasks: sessionApi.listSessionTasks；connection/dialog-offline 为整对象展开已接上无需改
结果：mypy 896 文件 0 错（修前 93 错）；ruff check + format 绿；backend daemon 相关 181 测试绿；前端 3 文件 47 用例绿且无 unhandled error；eslint 仅 1 既有无关 warning；daemon.changelog.md + frontend_components.changelog.md 已补 ql-20260908-004-2b59 条目

## ql-20260908-005-0759 | 2026-09-08 16:31:26 | 会话左栏机器/智能体两层筛选胶囊改下拉防撑爆
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/session-list-panel.tsx（胶囊改下拉+退役 FilterPill/EngineMark+筛选记忆读写与陈旧 id 兜底）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（锚点迁移+4 新用例+退役守卫改锚+beforeEach 清记忆键）
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（补 antd Select 助手+迁移 3 处直带链用例）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（共享机器用例改开下拉断言选项）
需求：会话左栏机器/智能体两层筛选胶囊改下拉防撑爆，选择经 localStorage 记忆刷新不丢
根因：无，纯 UI 收纳改进——D-107 两层筛选原为胶囊横排，机器数量多时在 320px 左栏换行撑爆筛选区；用户追加要求刷新后保留筛选选择
方案：session-list-panel.tsx 两层筛选 FilterPill 胶囊改为 #slp-machine（showSearch 可搜、全部机器清空、flex-1）+ #slp-agent（选中机器后出现、w-28）两个 Small Select 单行排布，依赖语义/R-05 重置/纯视图过滤不变；FilterPill/EngineMark 退役。新增 SESSION_TREE_FILTER_LS_KEY（sillyhub.sessions.tree.filter）记忆：pickMachineTab/pickAgentTab 变更落盘、挂载惰性恢复（machineId 空则孤儿 agent 不恢复）、恢复的机器 id 不在机器列表时兜底 effect 重置。测试锚点迁移（胶囊点击→chooseAntdOptionByText、智能体筛选层→#slp-agent、page.test 开下拉断言）+ 新增 4 记忆用例 + change scope 退役守卫改锚 .ant-select-multiple
结果：session-list-panel 99/99 + sessions-portal/page 68 用例全绿（合计 167）；tsc --noEmit 0 错；eslint 4 文件 0 错 4 warning 均预存（stash 对照 HEAD 确认）；frontend.md 变更索引已补条目，4 文件已 git add 待提交
审计：📝 文档欠账（D-8）：4 个源码文件改动未同步任何模块文档

## ql-20260908-006-4ff6 | 2026-09-08 19:48:27 | 修复 24h 代码审查发现的 10 个风险点（liveness 推导失效/取消竞态/离线丢消息/注入守卫缺失等）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/agent-log/liveness/tailer.ts（R1 预读缓存+R2 endedPaths+R9 forget）
- sillyhub-daemon/src/agent-log/liveness/discovery.ts（R6 agentCwd 透传+R8 fd close）
- sillyhub-daemon/src/daemon.ts（R6 归属重写+R9 meta 有界）
- sillyhub-daemon/src/hub-client.ts（R6 agent_cwd 解析）
- sillyhub-daemon/src/interactive/cursor-driver.ts（R10 DA-1 守卫）
- backend/app/modules/daemon/scheduled_send.py（R3/R4/R5）
- backend/app/modules/platform_sync/service.py（R7 重试+R9 段表有界）
- docs/architecture-4a.md（docs --fix 重锚两处行号漂移）
需求：修复 24h 代码审查发现的 10 个风险点（liveness 推导失效/取消竞态/离线丢消息/注入守卫缺失等）
根因：2026-09-08 只读审查发现 10 个高置信缺陷：tailer 生产路径异步装配错位致 L1 推导全链路失效、registry-sync 重加 ended 死文件震荡挤占 watch、sweeper 行锁被 inject 内部 commit 释放后盲覆写用户取消、daemon 离线到点消息一次性终态丢失、毒丸条目无上限重发、liveness 多 root 跨 workspace 串写、agent_log upsert 撞唯一键整批 500、readHead fd 泄漏、三端内存 Map 无界、CursorDriver shell 兜底缺批量层同款 DA-1 注入守卫
方案：每项失败测试先行再实现：tailer 改 tickAsync 预读字节进同步缓存（预算/轮转口径与 deriveOne 逐字对齐）+ endedPaths 登记拦重加 + runPass 路径快照防并发 add 闪断；scheduled_send 终态写回改条件 UPDATE、DaemonRuntimeOffline 延后 5min 有界重试 6 次、due 扫描 ORDER BY + 连崩 5 轮 failed 收口；liveness 归属改 agent_cwd 走 policy 层 isPathUnderAnyRoot（多 root 无命中跳过告警不串写）；两个 agent_log upsert 加 IntegrityError 单轮重试；readHead fd try/finally close；tailer forget/daemon meta ended 即删 + backend 段表 4096 上限；CursorDriver shell 兜底补 DA-1 元字符硬失败按轮次 error 收敛
结果：daemon 侧 vitest 141 用例（agent-log+cursor-driver+path-utils）全绿 + tsc 0 错；backend daemon 模块 2142 用例 + platform_sync 213 用例全绿 + mypy 896 文件 0 错 + ruff check/format 绿；docs check 934 处引用全通过（architecture-4a.md 两处行号漂移已随 service.py 插入重锚）

## ql-20260908-007-b871 | 2026-09-08 21:15:15 | 会话左栏智能体筛选下拉补齐 pi/cursor
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/daemon/runtimes.ts（新增 SESSION_SUPPORTED_PROVIDERS/SESSION_ENGINE_OPTIONS 单一源）
- frontend/src/components/sessions/session-list-panel.tsx（AGENT_TABS 改单一源派生+头注释同步）
- frontend/src/components/sessions/pre-session-picker.tsx（手写白名单 Set 退役改导入）
- frontend/src/components/daemon/runtime-session-helpers.tsx（手写数组退役改导入）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（mock 补常量+pi/cursor 新用例）
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（mock 补常量）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（mock 经 actual 取真实常量）
需求：会话左栏智能体筛选下拉补齐 pi/cursor，选项与实际可选引擎对齐
根因：AGENT_TABS 硬编码 claude/codex 两档未随引擎扩张更新——平台交互会话引擎已是四值（后端 InteractiveProviderLiteral 与 daemon VALID_PROVIDERS 均含 pi/cursor，2026-09-04/2026-09-08 两变更接入），pi/cursor 会话无法按引擎筛选；且前端白名单已在 pre-session-picker 与 runtime-session-helpers 两处手写重复
方案：lib/daemon/runtimes.ts 新增单一源 SESSION_SUPPORTED_PROVIDERS（有序四值）+ SESSION_ENGINE_OPTIONS（label 取 PROVIDER_META）；session-list-panel 智能体下拉选项改派生；pre-session-picker/runtime-session-helpers 两处手写白名单退役改导入；三个测试文件的 @/lib/daemon 整模块 mock 同步补常量
结果：session-list-panel 100/100（含新增 pi/cursor 筛选用例）；blast-radius 10 套件 181 + pre-session-picker 27 + runtime-session-helpers 25 + runtimes 页 16 全绿；tsc --noEmit 0 错；eslint 0 新增告警（5 条 warning stash 对照 HEAD 确认全预存）；7 文件已 git add 待提交
审计：📝 文档欠账（D-8）：7 个源码文件改动未同步任何模块文档
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx

## ql-20260908-008-d7d9 | 2026-09-08 21:37:46 | 前端三条 unused 预存 lint warning 清理（另顺手清同文件第四条 row）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（删 clickEngineTab 遗留助手 + row 改裸 await）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（删未用 png buffer）
- frontend/src/components/daemon/runtime-session-helpers.tsx（删未用 cn 导入）
需求：前端三条 unused 预存 lint warning 清理（另顺手清同文件第四条 row）
根因：无，纯测试债清偿——clickEngineTab 是引擎胶囊 Segmented tab 随平铺形态退役（ql-20260823-003）后的零调用遗留；png 是 fetch mock 改回 canned 响应后声明未用的死 buffer；cn 是早已不用的导入；row 是仅作 findByRole 等待锚点的未读绑定
方案：clickEngineTab 整函数删除；png Buffer 声明删除（注释同步改写）；cn 导入行删除；row 改裸 await 保留等待语义；machines-memo warning 属 hooks deps 重构类不在此列未动
结果：三文件 eslint 0 warning 0 error（原 4 条 unused 全清）+ tsc 0；受影响 3 套件 154 用例全绿（panel 100 + page 29 + helpers 25）；3 文件已 git add 待提交；无行为变更无需重部署
审计：📝 文档欠账（D-8）：5 个源码文件改动未同步任何模块文档
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：sillyhub-daemon/src/interactive/cursor-driver.ts, sillyhub-daemon/tests/interactive/cursor-driver.test.ts

## ql-20260908-009-5530 | 2026-09-08 21:39:36 | 修复 CursorDriver stdout/exit 竞态——exit 后等 stdout 排空再读 result 快照
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/cursor-driver.ts（stdoutDrainedP + exit 路径排空等待）
- sillyhub-daemon/tests/interactive/cursor-driver.test.ts（新增 ⑨ 竞态 describe 两用例）
- .sillyspec/docs/sillyhub-daemon/modules/interactive.md（MANUAL_NOTES 补 ql-20260908-007 条目）
需求：修复 CursorDriver stdout/exit 竞态——exit 后等 stdout 排空再读 result 快照，防最后一帧丢失
根因：Node 的 exit 事件不保证 stdio 已排空（官方文档行为，Windows 管道/大输出下 exit 可先于残余字节送达），_runTurn 原在 exit 后立即读快照，迟到字节里若正是 result 帧则本轮报成成功但无正文无 usage；fake-child 的 _emitExit 先 push(null) 再发 exit 模拟的是理想时序，故既有测试拦不住
方案：cursor-driver.ts 增 stdoutDrainedP（stdout end/close 双监听，已结束/已销毁立即过，close 兜底 kill/僵流场景），exit 路径读快照前 await Promise.race([stdoutDrainedP, killGraceMs 宽限超时])——超时按已解析内容收敛防挂死，随后 framer.end() 幂等 flush 兜底 close-without-end 尾行；文件头与快照注释同步为三确认口径
结果：cursor-driver.test.ts 20/20 全绿（新增 2 用例：直接 emit exit 保持流开放复现乱序→迟到 result 帧 result/usage 完整上报，红→绿；宽限超时不挂死）；tsc --noEmit 0 错；生效需 daemon bundle 发版

## ql-20260908-010-7c94 | 2026-09-08 21:43:28 | 修 session-list-panel machines 空数组引用不稳致下游 useMemo 恒重算
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/session-list-panel.tsx（machineCandidates ?? [] 包 useMemo 收敛空数组引用）
需求：修 session-list-panel machines 空数组引用不稳致下游 useMemo 恒重算
根因：useSessionListSharedData 里 machineCandidates ?? [] 在数据未就绪（undefined）期间每渲染生成新空数组，下游 runtimeToMachine/archivedWorkspaceIds 等以 machines 为依赖的 useMemo 每次渲染都判定依赖变化重算，触发 react-hooks/exhaustive-deps warning
方案：照 eslint 建议把兜底表达式包进 useMemo（deps=[machineCandidates]），undefined 期间恒返回同一空数组引用；附注释说明动机
结果：session-list-panel.tsx eslint 0 warning 0 error（目标 warning 消除）；tsc 0；panel/portal/page 3 套件 168 用例全绿引用稳定无回归；行为零变化无需重部署

## ql-20260908-011-8526 | 2026-09-08 21:50:12 | QA 审计文档行号敏感债消除——snapshot 豁免根治当日两轮锚点漂移
状态：已完成
关联变更：（无）
文件：
- docs/qa/subsession-daemon-frontend-audit-2026-08-26.md（加 doc_type snapshot frontmatter 豁免+元数据收纳）
需求：QA 审计文档行号敏感债消除——snapshot 豁免根治当日两轮锚点漂移
根因：docs/qa 带日期审计报告是点时快照，其 file:line 锚会被热文件后续改动反复漂移，当日 session-list-panel 两轮改动导致 docs gate 两度拦截，修锚属纯噪声维护；且 docs check 的 known_failures 无引用豁免键（只服务 decisions.*），无低成本豁免通道
方案：读 docs-check.js 源码确认三通道后择 frontmatter doc_type: snapshot（双通道豁免之一，语义对口）；文档头加 frontmatter 收纳散落元数据并注释缘由；锚点保留现值供读者定位但退出棘轮校验
结果：docs check 934→914 处（该文档 20 处引用退出校验）全通过；docs gate 0=基线 0 放行；纯文档改动零测试零部署；同目录另三份同性质审计快照记入模块文档后续照此处理

## ql-20260908-012-a32c | 2026-09-08 22:00:20 | 三份带日期审计/测试快照预防性加 doc_type snapshot frontmatter 退出行号棘轮
状态：已完成
关联变更：（无）
文件：
- docs/qa/subsession-backend-audit-2026-08-26.md（snapshot frontmatter+元数据收纳（60 refs 退出））
- docs/qa/2026-08-21-daemon-cleanup-code-review.md（snapshot frontmatter（1 ref 退出））
- docs/qa/sillyhub-functional-review-2026-05-31.md（snapshot frontmatter（0 refs 语义统一））
- docs/sillyspec/docs-gate-shared-worktree-parallel-block.md（新建活跃坑记录（规则 15））
需求：三份带日期审计/测试快照预防性加 doc_type snapshot frontmatter 退出行号棘轮
根因：同目录 daemon-frontend 审计当日两轮锚点漂移两度拦截 push（ql-20260908-011 已豁免该份），另三份同性质点时快照的锚点漂移只是时间问题——backend-audit 60 处引用指向 daemon 热文件风险最高
方案：三文档头加 frontmatter（doc_type: snapshot + 注释；backend-audit 收纳散落 author/created_at；functional-review 无锚仅语义统一标注）；顺带按规则 15 记录 docs gate 共享工作区缺陷（校验工作区全量而非推送内容，并行在途编辑拦无关推送）到 docs/sillyspec/ 活跃坑，含三条工具修复建议
结果：docs check 914→853（61 处退出与逐文档计数 60+1+0 吻合）gate 对本提交干净；两条提交在本地（64bbb7653 + 缺陷记录）推送暂被并行会话在途编辑的 7~8 处瞬时失效拦截（全部落其未提交文件 model.py/hub-client.ts，两轮运行失败数波动证实移动靶，不修别人的移动靶不跳钩子），待其落定后随下次推送带上
审计：📝 文档欠账（D-8）：5 个源码文件改动未同步任何模块文档
审计：⚖️ 归属切分：5 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/daemon/router/runtimes.py, backend/app/modules/daemon/service.py, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/hub-client.ts, sillyhub-daemon/src/sillyspec-manager.ts

## ql-20260908-013-51fb | 2026-09-08 22:22:39 | 总览采集失败上报与前端区分渲染
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/model.py（sillyspec_status_error 列定义）
- backend/migrations/versions/20260908140000_add_machine_sillyspec_status_error.py（加列迁移）
- backend/app/modules/daemon/router/heartbeat.py（心跳 DTO + handler）
- backend/app/modules/daemon/router/runtimes.py（机器读视图）
- backend/app/modules/daemon/service.py（facade 透传）
- backend/app/modules/daemon/runtime/service.py（落库+register 恒清）
- sillyhub-daemon/src/sillyspec-manager.ts（三态③失败记账）
- sillyhub-daemon/src/hub-client.ts（心跳第 9 参）
- sillyhub-daemon/src/daemon.ts（平铺 9 参重构防滑槽）
- frontend/src/components/workspace/changes-overview-card.tsx（区分渲染 + reason 标签）
需求：总览采集失败上报与前端区分渲染
根因：2026-09-08 temp 投毒排障暴露两个可观测性缺口：前端把 sillyspec_status=null 一律渲染成「未安装/版本过低」，持续采集失败时误导排障；daemon 把非零退出归为瞬态仅保留旧快照，失败原因不上报。顺带修复 daemon.ts 心跳尾部占位链的滑槽缺陷（status 在场+commandResult 缺席+specCache 在场时 status 滑入 commandResult 槽）
方案：daemon sillyspec-manager 新增三态③失败记账 getStatusError{reason,detail,since}（同 reason 保留首败时刻、①/②清空、detail 截 200），hub-client/daemon.ts 心跳第 9 参携带并把尾部占位链重构为平铺 9 参传值（构造性防滑槽）；backend 加 sillyspec_status_error JSON 列（迁移 20260908140000）走 sillyspec_status 同款 None=清除/register 恒清语义，机器读视图透出；前端 gen:types 双端再生成，changes-overview-card 按 statusError 区分「数据源查询失败（reason 标签+detail）」与「未安装/版本过低」
结果：backend test_machine_sillyspec 36 过（含 7 新增：直写/截断/清除/register 恒清/HTTP 全链/机器视图/OpenAPI）；daemon sillyspec-manager+heartbeat-sillyspec 86 过、心跳相关 7 文件 124 过；frontend card 11 过（含 3 新增：区分渲染/无失败保持/未知 reason 兜底）；三端 typecheck、backend ruff+mypy 全绿

## ql-20260908-014-3909 | 2026-09-08 22:39:47 | daemon 日志时间戳
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/console-timestamp.ts（logTimestamp + installConsoleTimestamps 幂等包装）
- sillyhub-daemon/src/daemon.ts（start() 首行安装）
- sillyhub-daemon/tests/console-timestamp.test.ts（格式/前缀/幂等三用例）
需求：daemon 日志时间戳
根因：2026-09-08 temp 投毒排障实证：daemon.log 行无时间戳，跨小时排障只能靠事件计数反推时间线；裸 console 散布 8+ 文件 100+ 处，逐点改格式不现实
方案：Daemon.start() 长驻入口对 console log/info/warn/error 做幂等包装，全输出统一前缀本地时间戳 [YYYY-MM-DD HH:mm:ss.SSS]（本地时区非 UTC，读者在本机）；零调用点改动——既有测试 spy 在包装之后替换、记录原始实参零扰动；CLI 一次性子命令与子进程输出不受影响
结果：console-timestamp/daemon-spec-prefetch/cli 三文件 45 过 8 skip，typecheck 绿；已重建 bundle 换包重启实机验证：daemon.log 现为 [2026-09-08 22:39:31.025] [daemon.*] 带时间戳形态

## ql-20260908-015-5fa8 | 2026-09-08 23:14:18 | 总览采集根落盘恢复
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（root 落盘 + _restoreSillySpecStatusRoot + start() 接线）
- sillyhub-daemon/tests/daemon-status-root-persistence.test.ts（四用例）
需求：总览采集根落盘恢复
根因：采集根仅内存态，daemon 重启后总览采集静默失联直到下一次 claim 才恢复（2026-09-08 晚三次复现），页面长期显「总览不可用」且每次部署/换包重启都触发
方案：_noteSillySpecStatusRoot 变更时 best-effort 异步落盘 sillyspec-status-root.json（daemonStateDir 下 {root_path,saved_at}，失败仅 warn）；新增 _restoreSillySpecStatusRoot 在 start() 三循环前恢复（文件缺失/损坏/字段非法静默回退旧等-claim 路径，幂等不覆盖已有内存值）；借用沙箱 rootPath 守卫不变
结果：daemon-status-root-persistence 4/4 过（落盘恢复/覆盖写/三种坏文件回退/沙箱守卫）、typecheck 绿；实机换包重启端到端验证：root_restored 日志→采集成功→心跳送达→服务器 DB sillyspec_status ok=true（全程无需 claim）

## ql-20260908-016-54dd | 2026-09-08 23:56:10 | 会话页左栏排版统一：空分组沉底降噪、分区头/组头一套样式、行缘对齐、行内 meta 降噪
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/session-list-panel.tsx（orderedGroups 空组沉底+分区头统一+缩进对齐+meta 降噪）
- frontend/src/components/sessions/sessions-portal.tsx（主栅格 gap-3.5→gap-3）
- frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（分组顺序断言随新排序更新）
需求：会话页左栏排版统一：空分组沉底降噪、分区头/组头一套样式、行缘对齐、行内 meta 降噪
根因：无，纯样式/排版调整（分组渲染序为 UX 演进，原 D-105 工作区列表序让空组霸占首屏）
方案：session-list-panel 新增 orderedGroups（可见数>0 稳定在前、空组沉底，仅树渲染序）+ 空组头 muted 且无空正文；群聊分区头对齐工作区组头（px-2 py-1.5 text-[13px] 箭头列定宽 ＋h-6）；群行外包 px-1.5 对齐行缘；树 p-1.5/小节 px-1.5/行卡 px-2.5；meta 行去三图标改点分隔纯文本（title 全量保留）；portal 栅格 gap-3
结果：session-list-panel 100 + sessions-portal 39 = 139 用例全绿；tsc 我方文件 0 错误（workspace/__tests__ 2 个并行会话在途预存）；eslint 3 文件 0 error 0 warning；浏览器 1600px 实拍验证四项排版目标全部达成；未部署（本地 dev 验证）
审计：📝 文档欠账（D-8）：3 个源码文件改动未同步任何模块文档

## ql-20260909-001-b746 | 2026-09-09 00:09:37 | 总览工作区级化修串台
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/sillyspec-manager.ts（statusTargets 多目标 + getStatusMapSnapshot）
- sillyhub-daemon/src/daemon.ts（根映射 LRU 落盘恢复 + 心跳第 10 参）
- backend/app/modules/daemon/router/runtimes.py（机器读视图逐 ws 类型化）
- frontend/src/components/workspace/changes-overview-card.tsx（map 优先 + 缺席提示）
需求：总览工作区级化修串台
根因：机器级 sillyspec_status 单槽位让所有工作台页面共享最近一次采集的仓库数据，多工作区互相串台；且 platform_agent_logs 119 条 tailer 上线前的 state=NULL 残留令 Agent 状态总览长期显示未知 100
方案：daemon 维护 wsId→主仓根映射（claim 学习+落盘 sillyspec-status-roots.json+LRU 上限 8）逐目标采集，心跳新增第 10 参 sillyspec_status_map（仅成功项，③保留旧值/②清空，legacy 单槽位字段保留兼容旧机）；backend 新列（迁移 20260908160000）键不出现=保留旧值、对象整包直写、register 恒清，机器读视图逐 ws 类型化透出；前端卡片优先 map[当前工作区ID]，缺席显「本工作区尚未被采集」不回退串台，map null（旧 daemon）回退机器级；服务器 DELETE 历史 agent_logs 119 条（pg_dump 备份留存）
结果：daemon manager60+heartbeat29+pending14+root-persist4 过、backend test_machine_sillyspec 39 过、frontend card 13 过（含 map 取数/缺席提示两新例）、三端 typecheck/ruff/mypy 绿；已三次部署生产：alembic=20260908160000、容器全 healthy、DB map 落库（b97f8231 ok=true active=0 / c84182bc ok=true active=1）、容器内读视图序列化实跑双工作区透出、daemon roots_restored count=2 无采集失败

## ql-20260909-002-3667 | 2026-09-09 04:14:40 | 修复 24h 审查四项缺陷（pi 活性失联/SWR pull 覆盖在途写入/cursor 迟到帧错轮/摘要 map 无界滞留）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/agent-log/liveness/tailer.ts（endedPaths Set→Map 加复活探针（可注入 statSizeSync））
- sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts（新增 2 复活用例（注入探针与默认 statSync 真实 utimes））
- sillyhub-daemon/src/spec-sync.ts（pushUnsyncedIfDirty 抽取加 pre_swap 二次回灌（失败 abort 保本地））
- sillyhub-daemon/tests/test_pull_before_push.test.ts（新增 2 用例加 3 断言随行为（checker 两次与 postSpecSync 幂等 1 次））
- sillyhub-daemon/src/interactive/cursor-driver.ts（detachStreams 三收敛路径加 interrupt 定时器补 unref）
- sillyhub-daemon/tests/interactive/cursor-driver.test.ts（新增 1 收敛后迟到帧不外发加流销毁用例）
- sillyhub-daemon/src/daemon.ts（心跳第 10 参采集关闭门控（随未提交特性同批））
- sillyhub-daemon/src/sillyspec-manager.ts（collectStatusOnce 目标集裁剪（随未提交特性同批））
- sillyhub-daemon/tests/sillyspec-manager.test.ts（新增 1 LRU 淘汰裁剪用例（随未提交特性同批））
- sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts（新增 2 第 10 参装配与关闭门控用例（随未提交特性同批））
需求：修复 24h 审查四项缺陷（pi 活性失联/SWR pull 覆盖在途写入/cursor 迟到帧错轮/摘要 map 无界滞留）
根因：①tailer R2 endedPaths 前提「路径按会话唯一」对 pi 不成立——session.jsonl 按 cwd 固定跨会话复用且无 deriver 走 L0 mtime 判 ended，ended 后 add() 永拒直到重启；②D-008 回灌检查只在 pull 起点一次，下载解包约 40s 窗口内会话新写 spec 文件在整树交换时被覆盖（SWR revalidate 恰在会话启动后 fire）；③排空宽限超时收敛后旧 stdout data 监听未摘除流未 destroy——迟到帧外发记到下一轮名下且 child/framer 随轮滞留；④manager _statusSummariesByWs 不随 daemon LRU 淘汰清理（map 无界增长+淘汰工作区永久脏数据）且心跳第 10 参无采集关闭门控与注释不符
方案：①endedPaths Set 改 Map 记 endedAt，add 命中登记时经可注入复活探针 statSizeSync（默认 node:fs statSync）比 mtime 大于 endedAt 判复活放行，mtime 未动维持拒绝防震荡；②抽 pushUnsyncedIfDirty helper 在 pull_start 与 swap 前各执行一次，二次回灌失败 abort 交换保留本地（不落 in-place 解包兜底），真实 postSpecSync 增量零 ops 不发网络请求幂等；③detachStreams（removeListener+destroy，error no-op 监听刻意保留）统一挂 interrupt/error/exit 三收敛路径，interrupt 定时器补 unref；④collectStatusOnce 多目标循环后按目标集裁剪 map 槽位，daemon 心跳第 10 参补 interval 关闭门控——④两文件属未提交的总览工作区级化特性同批随其提交
结果：新增 8 用例（tailer 2/pull 2/cursor 1/manager 1/heartbeat 2）加 3 处既有断言随行为更新；定向 19 个测试文件 269 passed；pnpm typecheck 干净；①②③随本条提交，④四处改动留工作区随特性提交
审计：📝 文档欠账（D-8）：11 个源码文件改动未同步任何模块文档
审计：⚖️ 归属切分：5 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/components/sessions/portal-file-panels.tsx, frontend/src/components/sessions/session-list-panel.tsx, frontend/src/components/sessions/sessions-portal.tsx

## ql-20260909-003-8a54 | 2026-09-09 04:32:40 | 会话右栏收纳：TaskExecutionPanel 空数据不再常驻 0 计数折叠条
状态：已完成
关联变更：2026-09-04-session-task-execution-panel
文件：
- frontend/src/components/daemon/task-execution-panel.tsx（hasAnyData 空态返回 null + FR-01 注记 + useRef 清债）
- frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx（①组三用例随空态隐藏行为翻转）
需求：会话右栏收纳：TaskExecutionPanel 空数据不再常驻 0 计数折叠条
根因：用户反馈右栏信息条挤（SessionUsageBar+AgentLogCard+TaskExecutionPanel 三叠聊天区上方）；原 task-07 FR-01「折叠条常驻空数据 0 计数」在全零会话是纯噪音，AgentLogCard 同位先例本就空态 null
方案：hasAnyData 判定（运行中/任务快照/轮次历史/团队任务含终态/计划总纲/取数失败 fail-closed 任一非空），全零且未展开返回 null；文件头 FR-01 描述改决策演进注记；测试①组三用例随行为翻转（空态断 null、展开用例改注入数据驱动）；顺手清 HEAD 遗留 useRef 未用导入
结果：task-execution-panel 12/12 绿 + agent-task-card 两文件 22 绿；eslint 2 文件 0 error 0 warning；tsc 0 新增；未部署（本地验证）
审计：📝 文档欠账（D-8）：2 个源码文件改动未同步任何模块文档

## ql-20260909-004-e5f9 | 2026-09-09 05:37:55 | 审查修复第二批五项（cursor chatId 双轨分叉/畸形 sid 采纳/前端跳转卸载残留/tailer 旧 range 残留/失败翻转覆写 cancell…
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/interactive/session-manager/events.ts（cursor 限定跟随最新主 sid 加换轨日志）
- sillyhub-daemon/tests/interactive/session-manager.test.ts（直调 dispatchStatusEvent 3 用例（跟随/write-once 保持/子代理不覆盖））
- sillyhub-daemon/src/interactive/cursor-driver.ts（帧采纳 session_id 补 UUID_RE 校验）
- sillyhub-daemon/tests/interactive/cursor-driver.test.ts（畸形 sid 不采纳不拼 --resume 用例）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（跳转循环 mountedRef 守卫加早退）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（卸载后零后续请求零 toast 用例）
- sillyhub-daemon/src/agent-log/liveness/tailer.ts（DefaultFs.forgetRange 预读失败清残留）
- sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts（读失败间隙 fail_open 用例）
- backend/app/modules/daemon/scheduled_send.py（_mark_entry_failed 谓词 UPDATE）
- backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py（竞速保 cancelled 加正常翻转对照用例）
需求：审查修复第二批五项（cursor chatId 双轨分叉/畸形 sid 采纳/前端跳转卸载残留/tailer 旧 range 残留/失败翻转覆写 cancelled）
根因：①resume 失效时 cursor 静默开新 chat——活轨 handle.chatId 随帧更新但持久轨 state.agentSessionId 被 write-once 守卫锁旧值，daemon 重启恢复回旧 chat 上下文分叉；②帧采纳 session_id 只验非空 string，畸形值会拼进下一轮 --resume；③跳转翻页循环无卸载守卫——epoch/abort 在 sessionId effect 体内卸载不执行，已死实例 epoch 校验恒过；④预读失败 catch 只不写入，上一轮旧字节被 readCachedRange 当本轮新增量重复喂 tail；⑤_mark_entry_failed 无锁读-改-写，失败分支可把并发已落的 cancelled 覆写回 failed（R3 只修了成功分支）
方案：①events.ts session_started 加 provider 限定跟随（仅 state.provider 为 cursor 时允许主流新 sid 覆盖并记日志，其它 provider 维持 D-003@v1 write-once——既有测试锁定的设计决策不动）；②cursor-driver 采纳补 UUID_RE 校验对齐 _tryCreateChat 先例；③循环条件加组件级 mountedRef.current 加翻页后早退不弹幽灵 toast；④DefaultFs 加 forgetRange 在预读 catch 清残留走真 fail_open；⑤改谓词 UPDATE 对齐成功分支，0 行命中记日志尊重终态
结果：新增 6 用例全过；daemon interactive+liveness 全量 64 文件 902 passed 加 tsc 干净；frontend page.test 36 passed（typecheck 仅并行会话未提交文件 2 既有错误，本批零涉及）；backend sweeper 15 passed 加 ruff 0 加 mypy 0；三模块文档变更索引已同步
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/verify-reconcile-own-file-foreign-false-positive.md

## ql-20260909-005-684d | 2026-09-09 08:47:00 | 会话页整洁度二轮六项：用量条零用量隐藏/空门户态按钮统一/配置条禁用原因提示/短会话轮次轨道隐藏/群聊未读徽章降档/筛选区两行对称
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-usage-bar.tsx（api_requests=0 不渲染）
- frontend/src/components/sessions/sessions-portal.tsx（空门户态按钮换 antd Button）
- frontend/src/components/sessions/session-config-bar.tsx（禁用 title 三态原因）
- frontend/src/components/sessions/turn-catalog.tsx（entries<3 返回 null）
- frontend/src/components/sessions/session-list-panel.tsx（群徽章降档+筛选区两行对称）
- frontend/src/components/daemon/__tests__/session-usage-bar.test.tsx（零用量用例翻转）
- frontend/src/components/sessions/__tests__/session-config-bar.test.tsx（禁用 title 用例）
- frontend/src/components/sessions/__tests__/turn-catalog.test.tsx（短会话隐藏两新用例+两处适配）
需求：会话页整洁度二轮六项：用量条零用量隐藏/空门户态按钮统一/配置条禁用原因提示/短会话轮次轨道隐藏/群聊未读徽章降档/筛选区两行对称
根因：用户反馈会话页还不够整洁统一，按评估清单一档二档六项规定动作执行（纯样式/展示层优化，无行为语义变更）
方案：用量条 api_requests=0 返回 null；空门户态两手写胶囊按钮换 antd Button 主次级；配置条三控件禁用态 title 按 ended/running/idle 分原因说明；TurnCatalog entries<3 early return null（签名 JSX.Element|null）；群未读徽章实心大圆标降档小号浅色阶；筛选区搜索独占首行+状态下挪机器行（w-24）
结果：五测试文件 198/198 全绿（新增 3 用例、3 处旧断言随行为翻转适配）；eslint 0 error（8 warning 均为 stash 对照证实的预存类型签名契约）；tsc 我方 0 错误；主仓 dev 3102 实拍六项视觉全部生效（3001 为 Docker 旧构建非热码，本轮以 3102 为准）；未部署
审计：⚖️ 归属切分：3 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/daemon/__tests__/session-usage-bar.test.tsx, frontend/src/components/daemon/session-usage-bar.tsx, docs/sillyspec/finished/verify-reconcile-own-file-foreign-false-positive.md

## ql-20260909-006-1662 | 2026-09-09 09:28:50 | ctx 上下文用量圆环收进配置条行尾（不再独占一行）
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/sessions/ctx-usage-bar.tsx（容器去独占行样式）
- frontend/src/components/sessions/session-config-bar.tsx（trailing 插槽）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（两处挂载迁移+输入区 pt-3）
- frontend/src/components/sessions/__tests__/session-config-bar.test.tsx（trailing 用例）
需求：ctx 上下文用量圆环收进配置条行尾（不再独占一行）
根因：用户反馈会话输入区上方的上下文用量圆环独占一行很突兀；其语义（会话资源状态）与配置条同属会话状态信息行
方案：SessionConfigBar 加可选 trailing 插槽（行尾、running 提示之右，缺省零占位）；session-panel-page 真会话/预会话两处 CtxUsageBar 自独占行删除改经 trailing 传入；CtxUsageBar 容器去 mb-1.5/min-h-7 独占行样式；输入区容器补 pt-3 保顶部间距
结果：ctx-usage-bar/session-config-bar/sessions-portal 104 绿 + session-panel-ctx-tokens/pre-session 40 绿；eslint 0 error（9 warning 全预存先例）；tsc 0 新增；3102 实拍 DOM 断言圆环在配置条行内同行 + 截图确认独占行消失；未部署
审计：⚖️ 归属切分：2 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：docs/sillyspec/docs-gate-shared-worktree-parallel-block.md, docs/sillyspec/finished/backfill-reviews-adopt-empties-changedfiles.md

## ql-20260909-007-836e | 2026-09-09 10:31:35 | 三分屏右列（文件预览）拖宽方向修复——拖左增宽拖右收窄
状态：已完成
关联变更：2026-09-09-sessions-file-browser-three-pane
文件：frontend/src/components/sessions/sessions-portal.tsx, frontend/src/components/ui/panel-resizer.tsx
需求：三分屏右列（文件预览）拖宽方向修复——拖左增宽拖右收窄
根因：PanelResizer 原仅左栏形态（把手在栏右缘右移增宽），三分屏右列把手在列左缘直接复用未镜像
方案：PanelResizer 增 side 可选属性（left 默认零回归/right 拖拽增量取反+键盘对调），预览列把手传 side=right，portal 测试新增方向用例
结果：sessions-portal 52/52 绿（+1 新用例）+ explorer 页拖拽回归绿；eslint 0/0；tsc 0 错误；生产部署后补真实拖拽验证
审计：📝 文档欠账（D-8）：3 个源码文件改动未同步任何模块文档
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：frontend/src/components/sessions/__tests__/sessions-portal.test.tsx

## ql-20260909-008-d78c | 2026-09-09 10:48:37 | 会话列表首条 user_input 摘要查询三处性能优化——SQL 内截断免拉 33KB 全文
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/router/session_crud.py（线上 3.1s 慢查询主现场：substr 截断 + title 为空才查）
- backend/app/modules/change/router.py（_fetch_session_titles helper 同款 substr 截断（两消费方同源口径））
- backend/app/modules/agent/router.py（agent 会话列表同款 substr 截断）
需求：会话列表首条 user_input 摘要查询三处性能优化——SQL 内截断免拉 33KB 全文
根因：阿里云 2核1.6G 小机实测 GET /api/daemon/sessions 摘要窗口函数查询 3.1s（slow.query 日志）：三处同款查询把 content_redacted 全文（线上单行均值 33KB/上限 50KB）拉回 Python 只取前 30 字做标题，TOAST 解压+传输开销全浪费；且 session_crud 对已有 title 的会话也照查
方案：三处同步（agent/router.py、change/router.py _fetch_session_titles、daemon/router/session_crud.py）改 SQL 内 substr(content_redacted,1,64) 截断（PG/SQLite 双方言语符语义，64>30 保证消费方 [:30] 派生零回归）；session_crud 额外只对 title 为空的会话查询（有 title 会话跳过，get(r.id) or 派生不变）
结果：直接相关 3 测试文件 40 用例绿；daemon+change+agent 三模块全量 3887 passed 2 skipped（skip 为预存）；ruff check/format/mypy 全净；部署到阿里云验证待做
审计：📝 文档欠账（D-8）：3 个源码文件改动未同步任何模块文档

## ql-20260909-009-fea8 | 2026-09-09 11:21:26 | 会话页视觉 P0：消息气泡层级 + 深色代码块 + composer 阴影
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/turn-timeline.tsx（用户气泡 max-w-80% + shadow-sm→shadow-primary）
- frontend/src/components/daemon/turn-segment-views.tsx（agent 文本气泡 max-w-80% + border-border/60）
- frontend/src/components/ui/markdown-text.tsx（pre 去 !bg-muted/60（让位元素级深底）+ 圆角/内边距/字号 + 行内 code 浅底胶囊）
- frontend/src/app/globals.css（--codeblock-* 共享 token + .markdown-text pre 深色代码块元素级规则（GitHub dark 语法色板））
- frontend/src/components/daemon/session-input-bar.tsx（composer 常态 shadow-sm + 聚焦 shadow-md）
需求：会话页视觉 P0：消息气泡层级 + 深色代码块 + composer 阴影
根因：用户反馈会话页不够高级、视觉效果太差——诊断为灰盒套灰盒、气泡顶满 86% 无层级、代码块被 !bg-muted/60 压成灰块且库语法色板跟 OS 不跟 data-theme
方案：用户气泡收窄 80% + shadow-primary 品牌投影；agent 气泡收窄 80% + border-border/60；markdown-text 双尺寸组去 !bg-muted/60 + 行内 code 浅底胶囊；globals.css 新增 --codeblock-* 共享 token + 元素级规则统一深色代码块（GitHub dark 色板 pre 局部覆盖，三主题一致）；composer 常态 shadow-sm 聚焦 shadow-md
结果：vitest 8 个相关测试文件 120 用例全绿；tsc --noEmit 0 错误；eslint 0 error（8 warning 均为存量未用参数）；frontend.changelog.md 变更索引已登记
审计：📝 文档欠账（D-8）：5 个源码文件改动未同步任何模块文档

## ql-20260909-010-a318 | 2026-09-09 12:23:36 | PPM 列表性能索引批次——数据范围处置人分支可索引改写 + 五表搜索列 trgm 索引 + git 审计表复合索引
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/ppm/common/data_scope.py（处置人分支裸列 4 分支 LIKE 改写（等价性由新测试锁定））
- backend/migrations/versions/20260909120000_add_ppm_list_perf_indexes.py（trgm×16 + audit_user btree + git_operation_logs 复合，PG-only 方言守卫）
- backend/app/modules/ppm/problem/model.py（__table_args__ 补 audit_user_id 索引（Wave1 双写口径））
- backend/tests/modules/ppm/test_problem_scope_visibility.py（4 位置/NULL/子串防护/等值分支等价性测试）
需求：PPM 列表性能索引批次——数据范围处置人分支可索引改写 + 五表搜索列 trgm 索引 + git 审计表复合索引
根因：problem_scope_clause 对 concat 表达式做前导通配 LIKE 不可走列索引，OR 含该分支致非超管问题列表全表顺序扫描×2；PPM 五表搜索列 ilike 前导通配全仓仅 agent_run_logs 有 trgm 索引；git_operation_logs 列表固定 user_id 过滤但仅有 lease/workspace 两组索引且无 retention，随历史线性恶化
方案：data_scope.py 处置人分支改裸列 4 分支 LIKE 等价改写（%,uid,% / uid,% / %,uid / ==uid，NULL 天然不命中）+ 迁移 20260909120000 批量建 trgm GIN 16 个（problem 7/problem_change 4/project_maintenance 2/ps_project_plan 2/plan_task 1，PG-only 方言守卫+幂等扩展）+ audit_user_id btree（model __table_args__ 双写，Wave1 跳过理由已过时）+ git_operation_logs(user_id,timestamp) 复合
结果：等价性测试 test_problem_scope_visibility.py 改写前后均 10 passed 锁定语义；ppm 域 22 passed；alembic 单头 20260909120000；ruff check/format 通过；mypy 0 错；模块文档 ppm.md/ppm.changelog.md/git_gateway.md 已同步

## ql-20260909-011-8938 | 2026-09-09 12:49:54 | daemon 交互会话逐事件上报微批化——20ms 窗攒批+终态前强制 flush，消除每事件一次串行 HTTP RTT
状态：进行中
关联变更：（无）
文件：（见实际改动）
