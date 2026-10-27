---
author: flow-machine-draft
created_at: 2026-10-27T00:39:56.644Z
---
# 需求规格（Requirements）— 2026-10-27-task-wakeup-precision-fix

## 功能需求

### FR-01: 通知行「用时」与唤醒判定同源：elapsed_ms 缺失时用注册表 startedAt 兜底时长显示 MM:SS，不再出现误导性 00:00

- 唤醒注入 prompt 的任务行「用时」必须与唤醒门槛判定使用同一时长值：SDK 终态帧带 elapsed_ms 时显示帧值；帧缺失时必须显示注册表 startedAt 兜底计算值（MM:SS 格式）；两者皆缺失时保持 00:00 显示，禁止编造其它数值。
- 2026-10-26 23:45 实证对照：pnpm install --force 真实用时 70s（23:45:29 派发 → 23:46:39 返回），通知却显示 00:00——判定与显示不同源是根因。

#### 场景：帧缺失时显示注册表兜底时长

- Given：task_started 已注册（startedAt=t0，t0 距今 ≥ 60s）且 task_notification 帧无 usage.duration_ms。
- When：任务 completed 且通过唤醒门槛。
- Then：注入 prompt 任务行显示「用时 MM:SS」等于注册表兜底计算值（分钟:秒），非 00:00。

#### 场景：双缺失保持 00:00

- Given：注册表无条目且终态帧无 elapsed_ms（重启窗口孤儿终态）。
- When：completed 走兜底放行。
- Then：任务行用时显示保持 00:00，不虚构时长。

### FR-02: 前台命令免唤醒：tool_use 元数据登记 run_in_background 标记（Task/Agent/Bash 三类工具），判定为前台的任务终态不注入唤醒；终态 emit 与 [TASK_NOTIFICATION] 落行行为不变

- 任务终态（completed/failed）到达时，若其 tool_use 元数据明确登记 run_in_background ≠ true（前台），禁止调度唤醒注入；若明确登记 run_in_background=true（后台），必须完成即唤醒（不受时长阈值限制）；同一终态的 agent_task_status emit 与 [TASK_NOTIFICATION] 落库行必须保持既有行为不变（免唤醒只收敛注入面，不收敛信号面）。
- tool_use 元数据必须覆盖 Task/Agent/Bash 三类工具（现状仅 Task/Agent 登记）；Bash 纳入后其 description 作为 taskName 兜底值入库。
- 判定口径（保守兼容）：仅当元数据存在且明确为前台时免唤醒；元数据缺失（旧会话/重启窗口/tool_use 事件丢失）时维持旧行为（FR-03 兜底），禁止把「信息不足」误判为前台。

#### 场景：前台 Bash 长命令不再触发唤醒

- Given：Bash tool_use input 无 run_in_background（前台），元数据已登记 isBackground=false。
- When：该任务 completed 且真实时长 ≥ 60s。
- Then：不触发唤醒注入；[TASK_NOTIFICATION] 行与 agent_task_status(completed) 事件照常。

#### 场景：后台 Bash/Agent 完成即唤醒（不受时长阈值限制）

- Given：tool_use input.run_in_background=true（或异步启动回执兜底注册）。
- When：completed（任意时长——含 < 60s 的短后台任务）。
- Then：照常调度唤醒注入；时长阈值不再约束确认后台的任务（短后台任务漏唤醒即停摆，是本判据反转要修的另一头）。防灌屏职责由前台免唤醒承担（实证灌屏源是前台孙命令，如 2026-10-26 的前台 pnpm install）；env=0 总关闭阀仍全局生效。

### FR-03: 后台标记缺失（task_started 丢失且无回执兜底）时保留旧时长阈值兜底唤醒并打 WARN；SILLYHUB_TASK_WAKEUP_QUIET_MS env 与缺省 60000 不变，语义改为兜底场景防噪阀

- 当任务的 tool_use 元数据与注册表条目均缺失后台标记（信息不足）时，必须回退既有判定逻辑：completed/failed 且时长 ≥ SILLYHUB_TASK_WAKEUP_QUIET_MS（缺省 60000，配置 0 = 总关闭阀）才唤醒，放行时必须打 WARN 日志标注信息不足；env 名称、缺省值、非法回落行为均禁止变化。
- 阈值语义自此降级为兜底场景防噪阀：主判据为 FR-02 的 run_in_background 标记。

#### 场景：三无孤儿终态维持旧行为

- Given：无 tool_use 元数据、无注册表条目、终态帧无 elapsed_ms（时长 unknown）。
- When：completed 到达且阈值 > 0。
- Then：按旧 fail-open 口径放行唤醒，并伴随 WARN 日志（时长来源 unknown）。

#### 场景：阈值 0 总关闭阀不变

- Given：SILLYHUB_TASK_WAKEUP_QUIET_MS=0。
- When：任意终态。
- Then：一律不注入（既有语义不变）。

### FR-04: 唤醒判定补结构化日志：task_id/task_name/status/时长/时长来源（sdk-frame|registry|unknown）/后台判定结果，前台跳过与兜底放行均可观测

- 唤醒判定的每个出口（通过门槛放行 / 前台跳过 / 信息不足兜底放行 / 阈值 0 关闭）必须各打一条结构化日志，字段至少含 task_id、task_name、status、durationMs、duration_source（sdk-frame|registry|unknown）、background 判定值与判定来源（tool-use-meta|registry-entry|alias|missing）；日志禁止包含任务 summary 正文超过 200 字符的截断全文。
- 日志目的：事后可归因（2026-10-26 排查因唤醒链零日志，task_id bsal4e1x9 无法在本地任何日志中定位）。

#### 场景：三出口均可观测

- Given：分别构造前台跳过、兜底放行、正常放行三种终态。
- When：各自到达。
- Then：daemon 日志各出现一条含上述字段的日志行，前缀与既有 [session-manager] 风格一致。

### FR-05: 文案修正：daemon prompt「后台子代理任务」改「后台任务」、「（列表中的每一个都已终止，没有仍在运行的任务）」改「（本批次均已终止）」，backend helpers.py 合并正则与拼接模板同步改，前端识别锚 [后台任务通知] 前缀不变零改动

- daemon 唤醒 prompt 头部必须改为「[后台任务通知] 以下 N 个后台任务已全部结束（本批次均已终止）：」（消除对前台命令的「子代理」失实与「没有仍在运行的任务」歧义）。
- backend `_TASK_WAKEUP_HEADER_COUNT_RE` 必须同时兼容新旧两种头部文案（「后台(?:子代理)?任务」），重写模板同步新文案，保证合并计数在新旧混排窗口内不退化；前端 `TASK_WAKEUP_PROMPT_PREFIX`（[后台任务通知]）禁止变化。
- 依据：该通知对前台 Bash 命令也会触发（SDK 对 Bash 命令同样发 task 帧），「子代理」称谓失实；「没有仍在运行的任务」指本批次，与任务面板「运行中 N」字面冲突（2026-10-27 用户实证困惑点）。

#### 场景：合并计数在新文案下正确

- Given：同会话 2s 窗口内两条终态各自进入待注入队列。
- When：debounce 合并注入。
- Then：prompt 头部为「以下 2 个后台任务已全部结束（本批次均已终止）：」且任务行 2 条。

#### 场景：backend 合并兼容旧头部

- Given：一条旧文案头部（后台子代理任务）的存量排队行。
- When：backend 合并新终态任务行。
- Then：兼容正则命中并改写计数，不退化为全文拼接。

### FR-06: daemon/backend/frontend 三侧仅跑与本改动相关的测试并通过

- 执行期必须仅运行与本改动直接相关的测试用例（daemon vitest task-lifecycle 唤醒相关 describe、backend pytest test_session_queue/test_session_queue_actions 中 task_wakeup 合并相关用例、frontend 相关文案 fixture 用例），禁止运行全量测试（CI 职责）。

#### 场景：相关测试全绿

- When：三侧相关用例执行完毕。
- Then：全部通过；若有与本次改动无关的预存失败，逐条列出并说明与本次改动的无关性。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「唤醒用时与判定同源：elapsed_ms 缺失显示注册表兜底时长」
FR-02: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「前台 Bash（run_in_background 缺省）终态不注入唤醒且终态信号不变」+「后台标记 true 照常注入」
FR-03: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「三无孤儿终态兜底放行并打 WARN」
FR-04: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「唤醒判定出口结构化日志字段齐备」（console spy 断言）
FR-05: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「prompt 头部新文案与合并计数」+ backend/app/modules/daemon/tests/test_session_queue.py「merge_task_wakeup_prompt 新旧头部兼容」
FR-06: 不适用：本条为执行约束，验证面即 FR-01..05 的绑定用例本身，全量回归留 CI。
