---
author: qinyi
created_at: 2026-09-18 17:05:00
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 单聊引导（Steering）忙轮直注入

> ⚠️ 可否决标注：D-002（方案 A 全链路 + 三 provider）与「忙轮默认发送即引导」为用户原话语义 + AI 推荐默认（用户三轮 AskUserQuestion 未作答，事实见进度库 step-3/4/5 回答记录）。plan/execute 前用户仍可推翻（改选 B/C 走 D-002@v2 + supersedes）。

## 背景

pi 原生支持 steering（`docs/rpc.md` steer 命令：streaming 中注入，当前 assistant turn 工具批完成后、下次 LLM 调用前投递，不打断当前轮）；Claude Code 与 Codex CLI 原生同语义（Claude Code 消息队列在工具调用间隙注入；Codex 0.147 app-server 协议存在 `turn/steer` 方法）。平台现状：

- **群聊 @ 忙轮成员**已走 steering 直注入（quick 2026-09-02）：`busy_strategy="inject"` → `_inject_mid_turn_into_run`（backend/app/modules/daemon/session/service/control.py:92）→ SESSION_INJECT 三段式下发，daemon 侧 running 时注入为既有安全路径。
- **单聊**忙轮发送走 `queue_when_busy=True`（backend/app/modules/daemon/router/session_crud.py:605?）→ 落排队表，等本轮完全结束才派发——用户在 agent 长任务期间想说「顺便也改下 XX」只能干等，与原生终端体验（打字回车即引导）不一致。
- **daemon 三驱动现状**：pi `_sendInject` 已实现 streaming→steer（含 follow_up/prompt 降级重试，sillyhub-daemon/src/interactive/pi-rpc-driver.ts:1859-1914）零改动可用；claude SDK 输入流为 `query({prompt: AsyncIterable})` 同进程多轮（sillyhub-daemon/src/interactive/claude-sdk-driver.ts:402?），忙轮推送进流后由 SDK 命令队列吸收（sdk.d.ts 0.3.247：queued_turn_count / still_queued / 「queued user message … absorbed mid-turn」fold 语义），投递时机需实测；codex 驱动为轮级串行（for-await 下一输入在 turn/completed 后才消费，sillyhub-daemon/src/interactive/codex-app-server-driver.ts:9?），忙轮注入被推迟到轮边界=降级时延，需新接 `turn/steer`。

## 设计目标

1. **FR-1**：单聊在 agent 忙轮时发送普通消息 = 引导注入活跃轮（不建新 run、不打断当前输出），复用群聊 `_inject_mid_turn_into_run` 链路。
2. **FR-2**：provider 能力矩阵——pi/claude/codex 支持引导（pi 零改动；claude 输入流直推；codex 新接 `turn/steer`）；不支持的 provider（cursor 等）自动降级为现有排队路径，不报错、行为与现状一致。
3. **FR-3**：排队条 ⚡「立即发送」从打断式（interrupt 后接力派发，backend/app/modules/daemon/session/service/queue.py:600-608）改为引导式（不打断，mid-turn 注入活跃轮）。
4. **FR-4**：零回归——停止按钮（interrupt 立即打断）语义不变；带配置切换维度（agent_profile/provider/model）的消息保持轮边界排队/409 语义；服务身份调用方（平台审批代写等）409 拒绝语义不变。（前端破坏面证据：frontend/src/hooks/use-message-queue.ts:22? 明示现不消费 dispatch_now 响应的 interrupted 字段。）
5. **FR-5**：前端三态展示——「引导中」（虚线气泡+脉冲，工具间隙投递提示）→「已引导」（普通气泡+已投递小标）；降级时回落现有排队条目并标注。
6. **FR-6**：留痕——steering 消息 user_input 留痕挂活跃 run（沿用群聊 inject 既有行为），历史回放与流式同态。

## 非目标

- **NG-1**：不统一各引擎 abort 时未投递引导消息的语义（pi abort 清空 steer 队列=丢弃；claude SDK 队列默认存活=下轮执行；codex 随引擎）——如实暴露引擎原生行为，v1 不做平台级补偿（记 R-04）。
- **NG-2**：cursor 驱动不接 steering（无证据支持，维持轮边界消费=自然降级）。
- **NG-3**：不做引导消息的撤回/编辑（排队条目既有 ✎ 编辑仅覆盖排队态条目，引导中消息不可编辑）。
- **NG-4**：移动端（mobile）会话页同步改造——桌面先行，移动端 parity 另开变更。
- **NG-5**：定时消息（scheduled send）忙轮策略不变（仍排队派发）。

## 拆分判断

单变更（2026-09-18-single-chat-steering）一次交付：后端策略、daemon codex 适配、前端状态三段强耦合于同一交互语义（忙轮发送=引导），拆开交付会出现「同 UI 不同 provider 行为不一致」的中间态；群聊 inject 链路与 pi 驱动已就绪使风险可控。不拆多变更。

## 总体方案

### Phase/Wave 划分

**Wave A（daemon，先行——与 backend 解耦可独立验证）**
- A1 codex 驱动接 `turn/steer`：inject 到达时若 `currentTurnId` 活跃 → 发 `turn/steer`（参数实机探测，见 R-02）而非压回输入队列；被拒/无 turn 活跃 → 维持现有轮边界消费（降级不报错）。实锚：sillyhub-daemon/src/interactive/codex-app-server-driver.ts:1231-1239? 输入循环。
- A2 claude 引导实测（spike）：忙轮向 `query({prompt: AsyncIterable})` 推消息，断言 SDK 队列 mid-turn 吸收（queued_turn_count ≥1 且不 interrupt）——预期驱动零代码改动，仅补集成测试证据。
- A3 能力矩阵走既有单源：`PROVIDER_CAPS`（sillyhub-daemon/src/interactive/providers.ts:295）新增 `steering` 第 14 键（pi/claude/codex=true，cursor=false），重跑 `node sillyhub-daemon/scripts/gen-provider-caps.mjs` 三端刷新（backend/app/modules/agent/provider_caps.py + frontend/src/lib/provider-caps.ts 均生成产物，frontend `pnpm gen:types` 链尾自动执行）；一致性由既有 test_provider_caps_alignment.py 守护——**不新建手维护常量、不加 driver 契约属性**（Grill P1-2 修正）。daemon 侧 mid-turn 行为是各 driver 的自然结果（pi steer / claude 推流 / codex A1 分支 / cursor 轮边界等待=能力 false 的自然降级），**不设 daemon 中心化门控任务**（Grill 复审③：PROVIDER_CAPS.steering 键仅供 backend 门控与前端降级标注消费）。

**Wave B（backend）**
- B1 单聊忙轮改 steering：`inject_session` 会话单聊调用方（backend/app/modules/daemon/router/session_crud.py:605? 端点）忙轮分支由 `queue_when_busy=True` 改 `busy_strategy="inject"`；**能力门控**：session 的 provider 经生成镜像 `backend/app/modules/agent/provider_caps.py`（单源 daemon PROVIDER_CAPS steering 键）判不支持 → 维持 queue_when_busy 排队现状。带切换维度消息不进 inject 分支（既有守卫 backend/app/modules/daemon/session/service/queue.py:76-99? 零改动）。
- B2 ⚡ dispatch_now 重构：backend/app/modules/daemon/session/service/queue.py:600-665 现逻辑「commit 后 interrupt 活跃轮再接力派发」改为「provider 支持引导 → mid-turn 注入活跃轮（复用 `_inject_mid_turn_into_run`（backend/app/modules/daemon/session/service/control.py:92），entry 留痕转挂活跃 run）；不支持 → 维持 interrupt 接力（现状）」。
- B3 响应扩展（Grill 复审②修正——复用既有 `mid_turn`，不新建平行字段）：`SessionDispatchResult.mid_turn`（backend/app/modules/daemon/session/service/results.py:39）已存在且 `_inject_mid_turn_into_run` 已置 True（backend/app/modules/daemon/session/service/control.py:241，群聊链路 backend/app/modules/daemon/group/service/messages.py:878 / backend/app/modules/daemon/group/service/shadow.py:387 已在消费）——B1 单聊改 busy_strategy=inject 后 mid_turn 端到端自动可用。改动仅两处 router 层映射：SessionInjectResponse（backend/app/modules/daemon/router/session_crud.py:83? 本地 DTO）加 `steered: bool`（映射 `result.mid_turn`）；`QueueDispatchNowResponse`（backend/app/modules/daemon/schema.py:550-562）加 `dispatch_mode: Literal["steered","interrupted","dispatched"]` 三态（由 mid_turn/interrupted 派生；现 `interrupted: bool` 保留兼容不删，前端 frontend/src/hooks/use-message-queue.ts:22? 明示现不消费该字段，破坏面小）；OpenAPI → `pnpm gen:types` 同步（CLAUDE.md 规则 21）。

**Wave C（frontend）**
- C1 忙轮发送即引导：session-panel 发送后按响应 `steered=true` 渲染「引导中」虚线气泡（原型 §1），后续 turn 事件（user_input 留痕行到达）转「已引导」终态；`steered=false` 走现有排队条。**手写镜像同步**：frontend/src/lib/daemon/sessions.ts:274 `SessionInjectResponse` 为手写接口（不在 gen:types 生成链内，Grill P1-1），`steered?: boolean` 字段须手补。
- C2 MessageQueueBar ⚡ 文案与行为提示更新：「打断当前轮，立即发送这条」→「立即引导进当前轮（不打断）」（frontend/src/components/daemon/message-queue-bar.tsx:15-17 title 两态）；降级 provider chip 标注「该引擎暂不支持引导」——能力数据源=生成镜像 frontend/src/lib/provider-caps.ts（Grill P2-6，零新增手写源）。
- C3 api-types.ts 重新生成 + 相关测试同步（page.test 等断言随 dispatch_now 语义更新）。

**Wave D（验证与文档）**
- D1 backend 单聊忙轮三分支测试（steering/降级排队/切换维度 409）、dispatch_now 引导式测试；daemon codex turn/steer 单测（mock transport）+ claude spike 集成测试；前端组件测试。
- D2 模块文档同步（daemon.md / backend session 模块文档）。

### 关键机制说明

- **能力矩阵单源**：走既有 PROVIDER_CAPS 三端生成机制（daemon providers.ts 单源 → gen-provider-caps.mjs → backend provider_caps.py + frontend provider-caps.ts，alignment 测试守护）——steering 为第 14 键，不新建独立能力源（Grill P1-2 修正）。
- **降级路径完整性**：codex `turn/steer` 被拒（参数不符/版本不支持）→ daemon 回落轮边界消费，效果=原排队时延，不失败；backend 能力门控挡在更前（provider 级）；未知 provider 默认 false（既有语义，默认拒绝）。
- **留痕与状态机**：steering 消息复用群聊 inject 的 user_input 留痕（挂活跃 run），前端「引导中」为纯展示态（SSE 收到留痕行即转「已引导」，无新持久化状态）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/router/session_crud.py | 单聊 inject 端点忙轮分支改 busy_strategy=inject + provider 能力门控（:605 附近）；本地 DTO SessionInjectResponse（:83）加 steered 字段（映射 result.mid_turn） |
| 修改 | backend/app/modules/daemon/router/session_queue.py | dispatch_now 端点响应映射新增 dispatch_mode 三态（:197-198 附近） |
| 修改 | backend/app/modules/daemon/schema.py | QueueDispatchNowResponse 增 dispatch_mode（interrupted 保留兼容）（:550-562） |
| 修改 | backend/app/modules/daemon/session/service/queue.py | dispatch_now 停止无条件 interrupt，支持引导注入分支（经 _inject_mid_turn_into_run 复用，mid_turn 派生三态）（:600-665） |
| 修改 | backend/app/modules/daemon/session/service/inject.py | inject_session 用户路径加 busy_strategy 形参并透传（execute task-05 实证：原仅服务身份路径有该参，三层同步加参惯例） |
| 修改 | backend/app/modules/daemon/session/service/__init__.py | SessionService.inject_session 签名透传 busy_strategy（三层加参第 2 层）+ dispatch_now 包装返回注解三态化 |
| 修改 | backend/app/modules/daemon/service.py | DaemonService facade 透传 busy_strategy（三层加参第 3 层）+ dispatch_now 包装返回注解三态化 |
| 修改 | backend/app/modules/daemon/tests/test_session_queue.py | 单聊忙轮 steering/降级排队/切换维度 409 回归测试 |
| 修改 | backend/app/modules/daemon/tests/test_session_router.py + test_inject_empty_prompt.py + test_session_user_preamble.py | router 侧旧排队契约断言迁移（steered/queued 翻转，execute task-09 实证落点） |
| 修改 | backend/app/modules/daemon/tests/test_session_queue_actions.py | dispatch_now 引导式（不再 interrupt）回归测试 |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | PROVIDER_CAPS 新增 steering 第 14 键（单源，含取值依据锚点注释） |
| 修改 | sillyhub-daemon/scripts/gen-provider-caps.mjs | CAPS_KEYS 守卫清单同步第 14 键（多出键会被守卫拒写） |
| 修改 | sillyhub-daemon/tests/interactive/provider-registry.test.ts | thirteenKeys 断言扩 14 键（全对象 toEqual） |
| 修改 | frontend/src/lib/provider-caps.ts | 生成产物重跑（同上） |
| 修改 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | 全对象 toEqual 断言扩 steering 键（两处） |
| 修改 | backend/app/modules/agent/provider_caps.py | 生成产物重跑（gen-provider-caps.mjs） |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | EXPECTED_CAPS_KEYS 扩 steering 键 + len 断言 13→14（:46/:157） |
| 修改 | sillyhub-daemon/src/interactive/codex-app-server-driver.ts | 输入循环加 turn/steer 分支（turn 活跃时直发，被拒回落轮边界） |
| 修改 | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | turn/steer 分支 + 被拒降级单测 |
| 修改 | sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts | spike-02 守护用例（忙轮推流断言，mock 惯例追加） |
| 修改 | frontend/src/lib/daemon/sessions.ts | 手写 SessionInjectResponse 镜像补 steered?: boolean（:274，gen:types 覆盖不到） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 忙轮发送 steered 响应→「引导中/已引导」气泡状态 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 同 page（双挂载点同步） |
| 修改 | frontend/src/components/daemon/message-queue-bar.tsx | ⚡ title 文案改引导语义；降级 chip 标注（数据源 provider-caps.ts） |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 重新生成（dispatch_mode 等字段） |
| 修改 | backend/openapi.json | gen:types 链随带刷新（steered/dispatch_mode 入 schema，task-09 提交） |
| 修改 | frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx | ⚡ 引导语义 title 断言同步 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx | ⚡ 新文案 aria-label 断言同步（task-08 连带） |
| 修改 | frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | 发送/排队断言随 steering 行为同步 |
| 修改 | .sillyspec/docs/SillyHub/modules/daemon.md | 模块文档同步（backend daemon 模块 + sillyhub-daemon interactive 双端 steering 契约段落） |

（无新建文件——引导链路全部复用既有结构；能力矩阵走既有 PROVIDER_CAPS 三端生成机制，不新增第 4 源；测试落在既有测试文件内追加。）

## 需求映射

FR-1→Wave B1；FR-2→Wave A1/A3+B1 能力门控；FR-3→Wave B2+C2；FR-4→Wave B 守卫零改动断言 + D1 回归；FR-5→Wave C1/C2；FR-6→复用群聊留痕（B1 天然获得）。

## 风险与开放问题

- **R-01**（低）：claude SDK 忙轮推流的实际投递时机未实测——若 SDK 在轮结束才吸收（非 mid-turn），效果=排队时延但不失败（降级可接受）；Wave A2 spike 先行验证，结论回写 design 补记。
- **R-02**（中）：codex `turn/steer` 参数格式无官方文档（仅二进制字符串证据 `turn/startturn/steerturn/interrupt` + prompt/steer/default 枚举痕迹）——Wave A1 首任务为实机探测（本机 codex 0.147.0 app-server 手工会话），探测失败则 codex 降级轮边界、能力映射置 false 收尾（不阻塞其余 provider）。
- **R-03**（低→已消解）：能力映射漂移风险经 Grill 审查修正——改走 PROVIDER_CAPS 既有三端生成单源 + alignment 测试守护，无手维护双源。
- **R-04**（信息）：abort 时未投递引导消息的引擎原生差异（pi 丢弃/claude 存活）不做平台统一（NG-1），前端「引导中」气泡在轮终止事件时收敛为终态提示（「本轮已结束，未投递」或转已投递，按引擎事件语义）。
- **R-05**（低）：群聊 @ steering 行为零改动（同一 `_inject_mid_turn_into_run` 入口，B2 仅改 dispatch_now 调用方分支）——D1 含群聊回归用例。
- **R-06**（低）：dispatch_now 前端破坏面小——frontend/src/hooks/use-message-queue.ts:22? 明示现不消费响应 interrupted 字段，dispatch_mode 为新增消费点；旧字段保留兼容。

## 生命周期契约表

本变更触碰的状态流转（既有实体，不新建状态机）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 单聊忙轮发送（provider 支持引导） | 前端/用户 | backend inject_session | prompt、busy_strategy="inject"、provider caps steering=true | 不新建 run；消息 user_input 留痕挂**活跃 run**（mid_turn=True）；响应 steered=true |
| 单聊忙轮发送（provider 不支持） | 前端/用户 | backend inject_session | prompt、queue_when_busy=True | 落排队表（pending 行，现有状态机不变） |
| ⚡ 立即发送（支持引导） | 前端/用户 | backend dispatch_now | queue_entry_id、caps steering=true | 排队条目 **pending → 转挂活跃 run**（mid-turn 注入，不 interrupt）；响应 dispatch_mode=steered |
| ⚡ 立即发送（不支持） | 前端/用户 | backend dispatch_now | queue_entry_id、caps steering=false | 排队条目 pending →（interrupt 活跃轮）→ 派发（现状不变）；dispatch_mode=interrupted/dispatched |
| SESSION_INJECT 到达 daemon（codex 忙轮） | backend | codex 驱动 | session_id、prompt、run_id | currentTurnId 活跃 → turn/steer（引擎内 steering 队列）；被拒 → 回落输入队列轮边界消费 |
| 前端引导消息展示态 | SSE 事件 | 前端组件 | steered=true 响应 / user_input 留痕行 | 引导中（纯展示态）→ 已引导（留痕行到达）/ 轮终止未投递 → 终态提示（无持久化状态） |

不新建持久化生命周期（无新表/新状态列）；排队表与 run 状态机沿用既有，仅 dispatch_now 转移路径增加「mid-turn 注入活跃 run」分支。

## 自审（Self-Review）

- **首轮自审**（step-6 --done 记录）：锚点核对 8+ 代码点属实；发现并修正前端测试文件路径 3 处（page.test.tsx 实际位于 sessions/__tests__/、补 test_session_queue_actions.py）。
- **Design Grill 独立审查**（tier=independent，agent-tool 通道，三轮）：初审 qualityVerdict=fail（P1×2：清单漏 5 文件 schema.py/router session_queue.py/control.py/results.py/frontend sessions.ts；忽略既有 PROVIDER_CAPS 三端生成单源机制）→ 返工修复 → 复审 pass + 3 gap（B3 类名笔误 / steered 与既有 mid_turn 语义重复 / A3 中心化门控误读风险）→ 终审双 pass（docHash=319ab312…43ad1，checklist 19 项 0 fail/gap）。终审采纳「复用 mid_turn」消去 service 层三行清单（21→18 行）。
- **遗留**：无阻断项。R-02（codex turn/steer 参数实机探测）为 plan 阶段首任务；探测失败则 caps 置 false 降级收尾（in-driver 回落机制保证安全）。

## 决策引用

D-001（忙轮发送即引导）/ D-002（方案 A，可否决默认）/ D-003（三 provider 能力证据）——见本目录 decisions.md。

## 风险判级确认

CLI 判级 integration-critical（命中 daemon/backend/session/message-queue）——**接受，不豁免**：本变更横跨 backend 派发链路与 daemon 驱动注入路径，verify 阶段按真实集成证据门控执行（codex 实机 turn/steer 探测 + 单聊忙轮端到端用例）。

## 接口面（API Face）

本变更接口面：3 端点（均为响应字段扩展，无新增路由）：

| METHOD /path | 变更 |
|---|---|
| POST /api/daemon/sessions/{id}/inject | 响应加 steered: bool（映射 mid_turn） |
| POST /api/daemon/sessions/{id}/queue/{entry}/dispatch-now | 响应加 dispatch_mode 三态（interrupted 保留） |
| POST /api/daemon/sessions | 透传 inject 契约（会话创建既有，无字段变更） |
