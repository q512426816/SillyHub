---
author: flow-machine-draft
created_at: 2026-10-27T00:39:56.644Z
---
# 设计记录（Design Record）— 2026-10-27-task-wakeup-precision-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：把唤醒主判据从「时长 ≥ 静默阈值」反转为「任务是否后台（tool_use 的 run_in_background 参数）」，时长阈值降级为信息不足时的兜底防噪阀。改动四处：

1. **标记登记**（sillyhub-daemon/src/interactive/session-manager/events.ts `registerAgentToolUseMeta`）：解析 tool_use input JSON 时读取 `run_in_background === true` 存入 `_agentToolUseMeta` 新字段 `isBackground`；同时把登记范围从「仅 Task/Agent」扩展到 **Bash**（前台/后台长命令均登记，taskName 取 description）。注册表条目（background-tasks.ts 懒注册路径）从 meta 带入 `isBackground`；`registerAsyncReceiptTask`（异步启动回执兜底）恒 `isBackground: true`（回执本身即后台证据）。`BackgroundTaskInfo` 类型加 `isBackground?: boolean`。
2. **判定反转**（background-tasks.ts `handleTaskNotificationEvent` 唤醒分支）：三态判定——`isBackground === true`（注册条目/别名/元数据任一确认）→ 完成即唤醒，不受时长阈值限制（短后台任务漏唤醒即停摆；防灌屏职责改由前台免唤醒承担——实证灌屏源是前台孙命令，如 2026-10-26 的前台 pnpm install，其终态帧同款到达）；`=== false`（元数据明确前台）→ 免唤醒（终态 emit/落行不变）；`undefined`（信息不足）→ 维持既有逻辑（时长阈值 + fail-open）并打 WARN。env=0 总关闭阀全局生效不变。选这个口径是为了保守兼容：只有信息充足的场景才改变行为，历史会话/重启窗口/tool_use 丢失场景零回退，既有测试的构造（无 meta）全部保持原判定路径。
3. **显示同源**：唤醒门槛判定处已计算的 `durationMs`（帧值或注册表兜底）回传 `scheduleTaskWakeup` 用于「用时」显示（`elapsedMs: durationMs ?? elapsedMs`），显示与判定不再各算各的。
4. **文案**：daemon prompt 头部改「以下 N 个后台任务已全部结束（本批次均已终止）：」；backend helpers.py 合并正则改兼容形 `后台(?:子代理)?任务` + 重写模板同步新文案（新旧混排窗口不退化）；前端识别锚 `[后台任务通知]` 前缀不动，前端零代码改动。

为什么选 run_in_background 而不是时长或 tool_result 配对：它是工具契约层面的前后台声明（无该参数的命令结果必然同轮返回），判据因果直连「主代理是否已拿到结果」；时长只是相关性代理（两头误伤：61s 前台误唤醒、59s 后台漏唤醒——后者恰是 task-wakeup-restore 要救的停摆场景）；tool_result 同轮配对最本质但需追踪 result 流与轮次关系，改动面大，放弃。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `BackgroundTaskInfo`（session-manager/types.ts）：新增可选字段 `isBackground?: boolean`——类型扩展，既有消费点不受影响。
- `registerAgentToolUseMeta`（session-manager/events.ts）：行为扩展——登记范围 Task/Agent → Task/Agent/Bash，meta 新增 `isBackground` 键；函数签名不变。
- `handleTaskNotificationEvent` / `scheduleTaskWakeup`（background-tasks.ts）：内部判定逻辑变化；`scheduleTaskWakeup` 入参形状不变（elapsedMs 语义改为「判定同源值」）；对 onTaskWakeupInject 回调的 prompt 文案头部变化（见下）。
- 唤醒 prompt 头部文案：`[后台任务通知] 以下 N 个后台任务已全部结束（本批次均已终止）：`（原「…后台子代理任务已全部结束（列表中的每一个都已终止，没有仍在运行的任务）：」）——backend `_TASK_WAKEUP_HEADER_COUNT_RE` 同步兼容形 `以下 \d+ 个后台(?:子代理)?任务已全部结束`，`_merge_task_wakeup_prompt` 重写模板同步；函数签名零变化。
- HTTP/WS 端点、SDK 驱动接口、env（SILLYHUB_TASK_WAKEUP_QUIET_MS 缺省 60000/0 关闭阀）：零变化。
- frontend：零代码改动（`TASK_WAKEUP_PROMPT_PREFIX` 识别锚不动）；仅测试 fixture 中引用旧文案的字符串同步。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立。task_notification 先于 task_started 到达 → 既有懒注册兜底路径不变，懒注册条目 isBackground 从 meta 查（meta 由 tool_use 事件登记，tool_use 恒先于执行与终态，乱序窗口内 meta 已在）；task_started 与回执双缺失（三无）→ isBackground undefined → 走旧兜底，方向与现状一致（fail-open 宁误报不停摆）；别名补发路径的 aliases isBackground 优先取注册时捕获值，迟到不丢标记。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：`_agentToolUseMeta` 与任务注册表均为 daemon 进程内 Map，由单会话的 SDK 事件循环串行消费（SessionManager 单驱动循环），无并发写；同 callId 重复登记为 Map.set 覆盖，幂等。跨会话各持独立键空间（meta 值带 sessionId，注册表按 sessionId 二级 Map）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：会话终态 `clearBackgroundTasks` 已清注册表 + `_agentToolUseMeta`（按 sessionId 过滤）——Bash 纳入登记后条目量增大但走同一清理路径，无泄漏；daemon 重启窗口的孤儿终态（内存结构全空）走三无兜底，行为与现状一致；注入排队行（backend 侧）持久化语义不变。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会。判定所依赖的 meta/注册表均为单 daemon 进程内按 sessionId 隔离的内存结构，不落库、不跨实例；唯一跨包耦合是 prompt 文案（daemon 产、backend 并、前端识别）——已用兼容正则（`后台(?:子代理)?任务`）覆盖新旧混排窗口：旧 daemon + 新 backend 时正则仍命中旧文案，计数改写不退化为全文拼接；新 daemon + 旧 backend 窗口（部署顺序反了）会退化拼接但信息不丢（helpers 设计内退化路径）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：**既有测试与生产行为的隐性依赖**——现有唤醒用例（如「61s completed 注入恰一次」）的 task_started 构造不带 tool_use 元数据，新判据下走「信息不足兜底」路径，行为恰好不变；但若未来有用例显式构造 meta 而期望旧行为，会静默走新分支。缓解：新增用例显式覆盖三态（true/false/undefined），并在 WARN 日志中标注判定来源，行为可观测可归因。
- 次要风险：Bash 纳入 meta 登记后 `[TASK_STARTED]` 的 task_name 兜底路径变化（meta.taskName 对 Bash = description，与帧 description 同值）——无行为差异，但 `[TASK_STARTED]` 落行量不变（仅 meta Map 增条目），内存开销可忽略（会话终态清理）。
- 试过放弃的方案：①以「tool_result 同轮配对」为判据（最本质）——需跨事件流追踪 result 与轮次绑定关系，改动面与回归面远超本变更体量，放弃；②以「任务名/命令特征」启发式判断——脆弱且不可解释，放弃；③backend 正则只认新文案——混版本窗口功能退化，改为兼容双文案。
