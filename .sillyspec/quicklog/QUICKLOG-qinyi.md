
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
