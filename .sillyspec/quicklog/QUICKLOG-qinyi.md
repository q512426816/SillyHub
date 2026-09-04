
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
