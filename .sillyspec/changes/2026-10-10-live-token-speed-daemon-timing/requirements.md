---
author: qinyi
created_at: 2026-10-10T19:45:00.000Z
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 会话面板观看轮次生成过程，期望运行中看到实时生成速度 |
| daemon 维护者 | 引擎适配层（claude/codex/pi driver）逐调用计时的实现与测试责任方 |
| backend | run_sync 摄取（submit_steps/submit_commit/publish）与 AgentRun 列写回 |

## 功能需求

### FR-01: daemon claude 引擎逐调用计时

claude-events 归一化器**必须**按 parentKey 桶维护**本桶**轮内累计生成时长（多桶各自独立累计，后端 max 口径取单桶最大——与 tokens 同构）
（message_start 锚定 + 上一调用折叠 + message_delta 活刷新），并在 partial
flush 的 usage 对象携带轮级累计 `api_duration_ms`（ms，整数）；折叠**禁止**
出现负值（钳 0）。

#### 场景：单调用轮

- Given：一轮仅一次 API 调用，message_start 后流式生成 12.5s
- When：期间 partial flush
- Then：usage.api_duration_ms 随生成增长（≈12500 量级），非 0 非 -1

### FR-02: daemon codex 引擎生成窗口计时

codex driver **必须**以 item/started→item/completed（agentMessage|reasoning）
为生成窗口累计轮内 API 时长并随 usage 事件携带 `api_duration_ms`；工具执行
窗口**禁止**计入。

#### 场景：调用间夹工具

- Given：agentMessage 完成后执行 Bash 20s，再开始下一段生成
- When：累计
- Then：工具 20s 不进累计（两次生成窗口之和）

### FR-03: daemon pi 引擎 message_end 折叠（含显式降级路径）

pi driver **必须**在 assistant message_end 折叠本调用窗口并随 usage 携带
`api_duration_ms`；若实现时确认 pi 事件流无内容级锚点（无法排除工具窗口），
**可以**显式降级 v1 不接（requirements/verify 留档），**禁止**用含工具的
墙钟充数。

#### 场景：正常路径

- Given：两段 assistant message_end
- When：累计
- Then：api_duration_ms = 两调用生成时长之和（工具窗口已扣或窗口法天然排除）

### FR-04: usage 契约与 schema 同步

`AgentEventUsage` **必须**新增可选 `api_duration_ms?: number`，事件 schema
校验同步放行；`usageToEventUsage` 守卫透传（缺省不带键）。旧 daemon 事件
（无该键）**必须**零影响。

#### 场景：旧事件兼容

- Given：usage 对象无 api_duration_ms
- When：usageToEventUsage / schema 校验
- Then：输出对象无该键、校验通过

### FR-05: backend 提取与写回

submit_steps **必须**提取 message 顶层 `usage.api_duration_ms` 并以 max 累积
（0 不拉低非零、乱序不回退）至 `st.latest_api_duration_ms`，submit_commit
写回 `AgentRun.duration_api_ms` 既有列；close 结果元数据非 None 时覆盖写
（既有守卫，零改动）。

#### 场景：乱序防御

- Given：先收到 12000 后收到 8000（乱序/子代理桶交替）
- When：累积
- Then：latest 保持 12000

### FR-06: tokens SSE 事件与 summary 下发

publish 的 `tokens` 事件与 run channel messages summary **必须**在
`st.latest_api_duration_ms` 非 None 时携带 `duration_api_ms` 键；None **禁止**
带键（design §9 兼容先例）；session channel `turn_completed` 既有字段不变。

#### 场景：旧 daemon 兼容

- Given：daemon 未上报（intent 值 None）
- When：publish
- Then：tokens 事件无 duration_api_ms 键，旧前端零影响

### FR-07: 前端运行中实时显示与门控放宽

前端 onTokens **必须**把 `duration_api_ms` 写入 `turn.apiDurationMs`（?? 链
不覆盖已收值）；`turnTokenSpeedText` 门控**必须**放宽为「outputTokens 与
apiDurationMs 双值可得（时长 > 0）即显示，任意轮状态」——运行中实时速度为
核心交付；数据缺失/时长非正**禁止**显示（不伪造原则不变）。

#### 场景：运行中实时速度

- Given：轮运行中，tokens 事件累积 output=625、duration=12500
- When：轮尾渲染
- Then：显示 `· 50 tok/s`

#### 场景：运行中无计时数据（cursor / 旧 daemon）

- Given：轮运行中，apiDurationMs 为 null
- When：轮尾渲染
- Then：只显示 token 计数，无速度段

### FR-08: 相关测试通过（不跑全量）

daemon / backend / frontend 三侧相关测试**必须**全绿（含新增计时用例与前端
门控语义改写）；**禁止**运行全量测试套件。

#### 场景：三侧绿

- When：跑本变更触及的测试文件
- Then：全部通过

## 测试绑定（每条 FR 至少一行）

FR-01: sillyhub-daemon/tests/interactive/claude-events.test.ts（新增计时用例，fixture 流 + 时间控制）
FR-02: sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts（新增生成窗口用例，含工具窗口排除）
FR-03: sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（新增 message_end 折叠用例；降级则改绑「不适用：显式降级留档」）
FR-04: sillyhub-daemon/src/interactive/agent-event-schema.ts 对应既有 schema 测试文件（新增字段放行用例）
FR-05: backend/app/modules/daemon/tests/（submit_messages usage 提取既有测试文件内新增 api_duration_ms 用例）
FR-06: backend/app/modules/daemon/tests/（publish tokens 事件既有测试文件内新增键断言）
FR-07: frontend/src/components/daemon/__tests__/turn-speed.test.ts（门控语义改写）+ turn-timeline-token-speed.test.tsx（运行中实时用例）
FR-08: 三侧触及测试文件全绿（执行记录见 verify）


## 非功能需求
- 兼容性：旧 daemon（无 api_duration_ms 键）/旧 backend/旧前端双向兼容——缺键即无速度显示，零报错零伪造（必须）。
- 可回退：后端 close 覆盖守卫（if not None）与 max/仅增不减 累积保证任意时点停用计时，列值停在最后有效值（必须）。
- 可测试：计时逻辑以 fixture 流 + 可控时钟验证，不依赖真实引擎/真实时间间隔（必须）。

## 决策覆盖矩阵

无 decisions.md（决策随 Grill 记录在 design 风险与死路节；本变更无独立 D-xxx 条目）。
