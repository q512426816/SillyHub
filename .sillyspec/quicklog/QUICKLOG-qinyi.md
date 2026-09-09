
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

## ql-20260909-011-8938 | 2026-09-09 12:49:54 | daemon 交互会话逐事件上报微批化——20ms 窗攒批+终态前强制 flush
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/daemon.ts（微批四方法+提交段三分支+终态两钩子）
- sillyhub-daemon/vitest.config.ts（env 全局旁路 0）
- sillyhub-daemon/tests/daemon-interactive-microbatch.test.ts（专项 5 用例）
- sillyhub-daemon/tests/interactive-test-helpers.ts（共享 mock 三件套）
- sillyhub-daemon/tests/daemon-agent-event-report.test.ts（helper 抽出改 import）
需求：daemon 交互会话逐事件上报微批化——20ms 窗攒批+终态前强制 flush
根因：每条事件一次串行 submitMessages HTTP 往返，一 turn 几百流式事件=几百次串行 RTT 约 2-6s 白加延迟且背压回灌子进程 stdout
方案：onTurnMessage 提交段改 per leaseId:runId 微批队列（20ms 窗一次批量提交，单 drain 协程保序）；终态两钩子强制冲队保证事件先于终态；token 空窗整批入箱；env=0 旁路（vitest 全局 0，生产默认 20）；测试三件套抽 interactive-test-helpers.ts 共享
结果：专项 5 用例全绿；受影响面 160 passed；daemon 全量 3811 passed（4 个心跳断言预存失败 stash 验证与本改动无关）；tsc 0 错误

## ql-20260909-012-f48b | 2026-09-09 12:52:48 | backend 三处事件循环阻塞修复——spec compare/gzip 丢线程池+MinIO client 真复用
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/sillyspec_compare.py（compare 比对+护栏 to_thread）
- backend/app/modules/daemon/router/session_insights.py（gzip 回显 to_thread）
- backend/app/modules/storage/minio_backend.py（client 惰性单例）
- backend/tests/modules/storage/test_minio_client_reuse.py（复用三用例）
需求：backend 三处事件循环阻塞修复——spec compare/gzip 丢线程池+MinIO client 真复用
根因：同步 FS IO+diff+dumps+compress 纯 CPU 段直接跑事件循环，大 payload 单请求阻塞数百 ms-秒级；MinioStorage 每操作新建 client 重付握手
方案：compare 比对+护栏、logs 端点 dumps+gzip 全 asyncio.to_thread；MinioStorage 惰性单例（双检+Lock、aclose 可重建、stream finally close）
结果：test_minio_client_reuse 三用例全绿；daemon 域 81 passed；ruff/mypy 0 错
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/tests/modules/storage/__init__.py

## ql-20260909-013-5c88 | 2026-09-09 13:13:31 | 前端性能二件套——pdf-previewer pdfjs 动态加载+useDaemonMachines 会话捆绑轮询拆分
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/files/previewers/pdf-previewer.tsx（pdfjs 改动态 import）
- frontend/src/lib/use-daemon-machines.ts（includeSessions opt-in+daemonMachinesQueryKey 导出）
- frontend/src/app/(dashboard)/runtimes/page.tsx（调用传 true+5 处 setQueryData 同 key）
需求：前端性能二件套——pdf-previewer pdfjs 动态加载+useDaemonMachines 会话捆绑轮询拆分
根因：pdfjs-dist 静态 import 进最高频会话页首屏 chunk；useDaemonMachines 15s 捆绑拉 100 条会话 6 挂载方白拉
方案：pdf-previewer 改 await import；hook 加 opts.includeSessions 默认 false（机器页传 true），进 queryKey 防缓存互覆（导出 daemonMachinesQueryKey helper）
结果：tsc 0 错误；页面测试 74 passed（sessions 页 7 个预存失败 stash 验证无关）；lint 2 warning 预存
## ql-20260909-014-e462 | 2026-09-09 13:21:48 | change-write 回执等待改 Redis pubsub 即时唤醒+短会话兜底轮询
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change_writer/proxy.py（publish helper+waiter 重写）
- backend/app/modules/daemon/change_write_router.py（complete 后 publish）
- backend/tests/modules/change_writer/test_receipt_wait.py（三用例）
需求：change-write 回执等待改 Redis pubsub 即时唤醒+短会话兜底轮询
根因：原 0.5s×120 次请求 session refresh 长轮询占满请求级连接池槽 60s
方案：complete 端点 commit 后 publish；等待方 pubsub 唤醒+2s 短会话 DB 兜底；等待期请求 session 零语句
结果：test_receipt_wait 三用例全绿；change_writer+daemon 域 82 passed；ruff/mypy 0 错；已提交 c04ec8478

## ql-20260909-015-5caf | 2026-09-09 13:28:47 | 工作台待办分页有界化——三源 COUNT+窗口切片+列投影
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/ppm/workbench/service.py（get_todos 重写）
- backend/tests/modules/ppm/test_workbench_todos_pagination.py（8 用例）
需求：工作台待办分页有界化——三源 COUNT+窗口切片+列投影
根因：原全量派生切片每翻页重跑三源全量整实体
方案：三源 COUNT 真实 total+合并偏移窗口切片+列投影+defect_count 裸列对齐
结果：分页测试 8 用例全绿；ppm 域 30 passed；ruff/mypy 0 错；已提交 16acdccac

## ql-20260909-016-fa10 | 2026-09-09 13:39:40 | init lease 凭据静默断链补日志 + daemon 心跳工作区键 UUID 守卫
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/lease/context.py（init 注入分支补 else 降级 warning）
- backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py（组 C 两用例补 capsys 断言）
- sillyhub-daemon/src/task-runner.ts（跳过 writeLocalYaml 补 warn 带原因枚举）
- sillyhub-daemon/src/daemon.ts（WORKSPACE_ID_RE 守卫三处接线）
- sillyhub-daemon/tests/test_init_lease.test.ts（缺失 warn + 全凭据正问用例）
- sillyhub-daemon/tests/daemon-status-root-persistence.test.ts（UUID 守卫三用例）
需求：init lease 凭据静默断链补日志 + daemon 心跳工作区键 UUID 守卫
根因：三层静默断链与心跳 422 两坑的代码修复（对应当日两份缺陷文档的修复建议）：降级/跳过合法但零提示使 local.yaml platform 段缺失无从发现；心跳协议字段由目录名/学习键宽松填充无校验，任一非 UUID 值整心跳被拒
方案：backend context.py init 注入分支补 else 降级 warning（事件 init_claim_local_yaml_skipped + reason 枚举）；daemon task-runner 跳过 writeLocalYaml 时 console.warn 带原因枚举；daemon.ts WORKSPACE_ID_RE 单源守卫三处接线（spec_cache 目录扫描/claim 学习键/恢复存量键，非 UUID 跳过+warn 一次 Set 去重）
结果：backend test_init_claim_tokens 8 passed + ruff/format/mypy 0；daemon 新增 4 用例共 36 passed + 心跳回归 4 文件 101 passed + tsc 0；模块文档三处变更索引已同步
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/agent/patrol.py

## ql-20260909-017-d2f1 | 2026-09-09 13:53:33 | 变更列表 pending 集 Redis 缓存+epoch 失效
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/pending_cache.py（缓存三函数）
- backend/app/modules/change/service.py（读穿+三 bump）
- backend/app/modules/platform_sync/service.py（两分支 bump）
- backend/app/modules/change/tests/test_pending_cache.py（4 用例）
需求：变更列表 pending 集 Redis 缓存+epoch 失效
根因：聚焦模式每次翻页都拉全 workspace latest_progress 肥 JSON
方案：pending_cache.py read-through 缓存+四处 commit 后 epoch bump+TTL 兜底+降级回退
结果：4 用例全绿；change 域 504+platform_sync 213 passed；ruff/mypy 0 错；已提交

## ql-20260909-018-ca2e | 2026-09-09 13:57:29 | patrol 巡检 N+1 批量化——run→lease→runtime→daemon 三段链路逐 run 3 查询改批量 IN 预取
状态：进行中
关联变更：（无）
文件：（见实际改动）
