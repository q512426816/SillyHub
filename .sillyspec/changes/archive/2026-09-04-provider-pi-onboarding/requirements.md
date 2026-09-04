---
author: qinyi
created_at: 2026-09-04 10:46:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 前端选 PI 引擎发起/继续会话（本变更主要受益者） |
| daemon | 长驻 PiRpcDriver 执行（rpc 子进程管理） |
| 平台开发者 | 后续接 pi 族 fork（omp）时的档B 参照（onboarding 案例锚） |

## 功能需求

### FR-01: PiRpcDriver 交互式驱动
覆盖决策：D-001@v1

Given pi ≥0.81.1 已安装并被 detector 探测
When 创建 provider='pi' 的交互式会话
Then spawn `pi --mode rpc --session-dir <daemon 隔离>` 长驻进程，JSONL 双向（LF 严格分帧，禁 readline U+2028 切分），实现 InteractiveDriver 契约（start/consume/interrupt/close+handle.provider='pi'）

Given 会话进行中收到 inject
When agent streaming / 非 streaming
Then 非 streaming 走 `prompt`；streaming 按场景走 `steer`（默认）/`follow_up`（含 images 多模态映射 ImageContent）；命令被拒（response success:false）转 error 事件上报

Given 用户打断 / 会话恢复 / 子进程非正常退出
When interrupt / resume / crash
Then rpc `abort` / `--session-id`+`switch_session` / onError 会话级 fail（codex 同款语义）

### FR-02: 事件归一化
覆盖决策：D-001@v1

Given rpc 下行事件流
When 经 PiEventNormalizer
Then text_delta→text（逐 delta 直通）、thinking 块→thinking、tool_execution_start/end→tool_use/tool_result（call_id 配对）、error/extension_error/失败 response→error、turn_end.message.usage→usage（cacheRead/cacheWrite→cache_read/cache_creation）；agent_settled 为 turn 收敛信号（onTurnResult）；session_started 由 get_state 合成；extension_ui_request 默认回 cancelled:true；未知事件降级 status 不丢不抛；全部产出过 safeParseAgentEvent

### FR-03: 能力矩阵如实
覆盖决策：D-002@v1

Given PI 8 项 caps
When 三端镜像表落值
Then resume/model_select/thinking/multimodal=true（原生实测）；mcp/edit_patch/permission_dialog=false（暂缺+替代说明）；subagent 初始 false，R-02 实证（examples 扩展 vendor/路径+事件归属形状）达标后翻 true——先实现后翻值（§6.2 纪律）

### FR-04: 注册与可选性
Given providers.ts 加 pi 条目（family=pi_json/capsOf 单源）
Then InteractiveProvider 联合自动扩展；cli.ts drivers 装配加一行；前端引擎白名单两处（sessions/pre-session-picker.tsx、runtime-session-helpers.tsx）加 pi；detector 补 minVersion '0.81.0'；caps 三端对齐守护测试的 EXPECTED_PROVIDERS 补 pi

### FR-05: 验收冒烟
Given 本机 pi 0.81.1 真实环境
When 按 onboarding §8+PI 适配清单跑
Then 创建→工具执行→partial→usage→inject→interrupt→resume 全链路；双轨落库（agent_event 行）；claude/codex 既有测试零回归；档C 12 步勾选记录进 onboarding 案例锚

## 非功能需求

- 兼容性：未装 pi 的机器不注册 pi runtime（既有 detector 行为）；claude/codex 零回归
- 可测试：driver 契约测试用 mock rpc 子进程+真实事件 fixture；归一化器纯函数用例
- 跨平台：pi.cmd shim 解析复用 resolveWindowsCmdShim；Windows/Linux/macOS 语义一致

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | RPC 长驻架构（prompt/steer/follow_up/abort/session 全套） |
| D-002@v1 | FR-03 | 桥接补齐+如实标记（8 caps 三态） |

无未覆盖决策。
