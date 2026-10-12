---
author: flow-machine-draft
created_at: 2026-10-12T23:08:59.047Z
---
# 需求规格（Requirements）— 2026-10-13-review-risk-fixes

## 功能需求

### FR-01: task-runner 渲染轨生产路径（spawn-stream handleLine）传入 MessageCoalescer：流式 delta 缓冲合并为单行提交，attempt 收尾 flushAll 残留缓冲冲刷转发（宁碎片不丢内容），新增测试证明接线后多条 delta 仅产出一行合并内容+完结行、流结束残留被冲刷

- task-runner 渲染轨生产路径（spawn-stream handleLine → `_eventToMessages`）必须把 attempt 级 `MessageCoalescer` 实例透传给 `eventToSubmitMessages`，使同一 message id 的流式 delta 经缓冲合并为单行提交；attempt 收尾（含正常结束、取消、超时退出）必须调用 flushAll 并把残留缓冲经既有转发通道（resilience submitWithRetry / client.submitMessages）提交，禁止丢弃残留内容。

#### 场景：多条 delta 合并为单行

- Given：同一 message id 连续多条 streaming delta，随后到达非流式完整行
- When：逐事件经 handleLine 处理并收集 submitMessages 批次
- Then：完整行前仅产出一行合并 delta 内容，不再逐条直发碎片行

#### 场景：attempt 收尾残留冲刷

- Given：streaming delta 已入缓冲且流结束（消息未收到完结行）
- When：attempt 收尾执行 flushAll 并转发
- Then：残留文本按一行提交（带消息级 timestamp），经 pendingForwards 转发不丢失

#### 场景：透传断言

- Given：handleLine 处理任一 text 事件
- When：调用 runner._eventToMessages
- Then：第二参收到 env 上挂载的同一 coalescer 实例（接线成立，非 undefined）

### FR-02: backend 启动清理的 AskUserQuestion 等待豁免加 24h 时间上限：最后 ask 信号超龄后不再豁免、按既有判死路径收口，测试覆盖时限内豁免与超时限判死两分支

- 启动清理的等待用户回答豁免必须受 24 小时时间上限约束——最后 ask 信号距清理时刻超过 24h 时不再豁免，run 按既有判死路径终态化（failed + SERVICE_RESTART_INTERRUPTED）；时限内（≤24h）必须保持既有豁免行为零回归（run 保持 running）。

#### 场景：时限内豁免（零回归）

- Given：最后 ask 信号 25 分钟前且晚于 user_input，日志停滞超宽限窗
- When：`_cleanup_stale_runs_impl` 扫描
- Then：run 保持 running，error_code/finished_at 均为空

#### 场景：超时限判死（防会话永久楔死）

- Given：最后 ask 信号 25 小时前且晚于 user_input，日志停滞超宽限窗
- When：`_cleanup_stale_runs_impl` 扫描
- Then：run 终态化 failed + error_code=SERVICE_RESTART_INTERRUPTED

### FR-03: path-utils.ts isPathUnderAnyRoot 注释与实现对齐（anchor 仅 target 透传，roots 维持单参解析）

- `isPathUnderAnyRoot` 的 docstring 必须与实现一致——anchor 仅透传 target 解析，roots 维持单参解析（roots 为绝对路径语义）；禁止注释声称「target 与 roots 双解析均透传」而实现只透传 target。本条仅注释对齐，禁止任何行为代码变化。

#### 场景：注释对齐

- Given：path-utils.ts `isPathUnderAnyRoot` 注释与实现存在不一致（注释称双透传）
- When：修正注释
- Then：注释准确描述「anchor 仅 target、roots 单参」实现，diff 无行为代码变化

### FR-04: shell-paths.ts isFlagToken 注释补记已知残留放行面（- 开头文件名不进白名单校验）与 cd 盲区既有边界

- `isFlagToken` 的注释必须记档已知残留放行面——以 `-` 开头的合法文件名写入目标（如 `> -p`）不再进入白名单校验（提取为空=放行），及静态提取不追踪 `cd` 的既有盲区（相对目标锚定会话根≠shell 真实 cwd）；禁止无记档静默收缩校验面。本条仅注释记档，禁止任何行为代码变化。

#### 场景：注释记档

- Given：isFlagToken 引入「flag 即弃」后存在残留放行面与 cd 盲区
- When：补记注释
- Then：残留风险与边界在代码内可见，diff 无行为代码变化

### FR-05: sillyhub-daemon 定向 vitest（event-wire/task-runner/coalescer）+ pnpm typecheck 通过；backend 定向 pytest（stale runs 两文件）通过；不跑全量

- 验收必须只跑本变更相关定向测试：sillyhub-daemon 侧 `vitest run` 限定 event-wire / task-runner / message-coalescer 相关文件 + `pnpm typecheck`；backend 侧 pytest 限定 `test_cleanup_stale_runs_error_code.py` 与 `test_close_interactive_run_retroactive.py`；禁止跑全量测试（全量留给 CI）。

#### 场景：定向验收

- Given：FR-01~FR-04 改动完成
- When：执行定向 vitest + typecheck + 定向 pytest
- Then：全部通过（新增用例与既有相关用例均绿）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/task-runner/spawn-stream-coalescer.test.ts「handleLine 透传 coalescer / 多 delta 合并单行 / 收尾 flushAll 冲刷转发」
FR-02: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_awaiting_user_ask_over_24h_killed / 既有 test_stale_run_awaiting_user_answer_skipped 零回归」
FR-03: 不适用：纯注释对齐无行为变化，由 pnpm typecheck 与 FR-05 定向测试覆盖编译与回归
FR-04: 不适用：纯注释记档无行为变化，由 pnpm typecheck 与 FR-05 定向测试覆盖编译与回归
FR-05: 不适用：本条即验收执行项（定向测试命令与产物见 verify 记录）
