---
author: qinyi
created_at: 2026-09-19 00:22:43
---
# 需求规格（Requirements）— 单聊引导（Steering）忙轮直注入

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 在单聊会话页与 agent 交互的终端用户（忙轮中发送补充指示） |
| daemon 驱动 | sillyhub-daemon 各 provider 交互驱动（pi/claude/codex/cursor） |
| 平台后端 | FastAPI daemon 模块（会话发送/排队/派发链路） |

## 功能需求

### FR-01: 单聊忙轮发送=引导注入
覆盖决策：D-001@v1, D-002@v1

#### 场景：支持引导的 provider 忙轮发送
Given 单聊会话（provider ∈ {pi, claude, codex}）存在活跃 run（忙轮）
When 用户经主输入框发送普通消息（不带 agent_profile/provider/model 切换维度）
Then 走 `busy_strategy=inject` mid-turn 注入活跃轮（不建新 run、不 interrupt），响应含 `steered=true`（映射 mid_turn），user_input 留痕挂活跃 run

#### 场景：带切换维度的消息保持轮边界语义
Given 单聊会话忙轮
When 发送携带 agent_profile_id / llm_provider_id / model 任一维度的消息
Then 不进 steering 分支，维持既有排队/409 行为（零回归）

#### 场景：服务身份调用方
Given service 身份路径调用 inject（平台审批代写等）
Then 保持既有 409 拒绝语义（零回归）

### FR-02: provider 能力矩阵与降级
覆盖决策：D-002@v1, D-003@v1

#### 场景：不支持的 provider
Given 单聊会话 provider 不支持 steering（cursor 或未知 provider）
When 忙轮发送普通消息
Then 维持现状排队路径（queue_when_busy），响应 `steered=false`/queued，不报错

#### 场景：能力单源
Given PROVIDER_CAPS steering 键（第 14 键）
Then daemon providers.ts 为唯一维护源，backend provider_caps.py 与 frontend provider-caps.ts 为生成产物，alignment 测试守护三端一致；未知 provider 默认 false

### FR-03: ⚡ 立即发送改引导式
覆盖决策：D-001@v1

#### 场景：支持引导的 provider 队列条目立即发送
Given 排队表存在 pending 条目且活跃轮 provider 支持引导
When 用户点击队列 chip 的 ⚡ 立即发送
Then 不 interrupt 活跃轮，mid-turn 注入该条目（留痕转挂活跃 run），响应 `dispatch_mode="steered"`

#### 场景：不支持的 provider 队列条目立即发送
Given 活跃轮 provider 不支持引导
When 点击 ⚡ 立即发送
Then 维持现状 interrupt 接力派发（`dispatch_mode="interrupted"`）；空闲态当场派发（`"dispatched"`）

### FR-04: 零回归面
覆盖决策：D-001@v1

Given 停止按钮、群聊 @ steering、定时消息、排队 UI 既有行为
When 本变更上线
Then interrupt 立即打断语义不变；群聊 @ 忙轮 steering 行为零改动；scheduled send 忙轮策略不变；排队条目编辑/删除/拖拽行为不变

### FR-05: 前端引导状态展示
覆盖决策：D-001@v1

#### 场景：引导中→已引导
Given 用户忙轮发送且响应 `steered=true`
When 消息入流
Then 渲染「引导中」虚线气泡（工具间隙投递提示）；SSE 收到该消息 user_input 留痕行后转「已引导」终态（普通气泡+已投递小标）；历史回放同态

#### 场景：轮终止未投递收敛
Given 「引导中」气泡存在
When 活跃轮终止（完成/中断/失败）且引擎未投递该引导
Then 气泡收敛为终态提示（不永久停留）

#### 场景：降级标注
Given provider 不支持引导
When 排队条目展示
Then 现有排队 chip 照常 + 能力数据源 provider-caps.ts 标注「该引擎暂不支持引导」

### FR-06: codex turn/steer 接入
覆盖决策：D-003@v1

#### 场景：codex 忙轮注入
Given codex 会话活跃轮执行中（currentTurnId 存在）
When SESSION_INJECT 到达 daemon
Then 驱动发 `turn/steer`（参数以实机探测为准，R-02）而非压回输入队列

#### 场景：turn/steer 被拒
Given `turn/steer` 请求被 codex 拒绝（参数不符/版本不支持）
Then 回落现有轮边界消费（效果=原排队时延），不报错不挂死

## 非功能需求

- 兼容性：codex 版本差异经 in-driver 被拒回落机制兜底；旧前端不消费 dispatch_mode 不受影响（interrupted 保留）
- 可回退：单聊忙轮分支改动集中在 router/queue 两处调用面，回退=恢复 queue_when_busy=True 与 interrupt 接力
- 可测试：daemon codex turn/steer 单测（mock transport）；backend 忙轮三分支既有测试文件追加；前端组件测试同步

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03, FR-04, FR-05 | 忙轮发送即引导（用户原话语义） |
| D-002@v1 | FR-01, FR-02, FR-03 | 方案 A 全链路 + 能力降级（可否决默认） |
| D-003@v1 | FR-02, FR-06 | 三 provider 能力证据与接入现状 |
