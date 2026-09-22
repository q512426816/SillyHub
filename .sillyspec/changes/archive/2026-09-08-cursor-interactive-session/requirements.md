---
author: qinyi
created_at: 2026-09-08 12:17:40
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在前端选 Cursor 引擎开多轮对话会话的最终用户 |
| daemon | sillyhub-daemon，本机执行 agent 的 Node 服务（driver/归一化器/注册表宿主） |
| backend | FastAPI 编排服务（caps 门控 / DTO 校验 / 双轨落库） |
| frontend | Next.js 前端（引擎白名单 / caps 门控渲染） |

## 功能需求

### FR-01: cursor 注册进 interactive 三件套
覆盖决策：D-001@v1, D-004@v1

Given daemon 注册表 `INTERACTIVE_PROVIDERS` 现有 claude/codex/pi 三键且批量层 PROTOCOL_PROVIDERS.stream_json 已含 cursor
When 注册 `cursor` 条目（family='stream_json'，displayName='Cursor'，createDriver 指向 CursorDriver，caps=capsOf('cursor')）且 PROVIDER_CAPS.cursor 八键就位
Then 模块加载 `capsOf` 守卫通过；`provider-registry.test.ts` 键集合断言 `['claude','codex','cursor','pi']` 与 family 反查（stream_json）全部通过

Given 三端 caps 表（daemon providers.ts / backend provider_caps.py / frontend provider-caps.ts）加 cursor 后
When 同 commit 同步 `test_provider_caps_alignment.py` EXPECTED_PROVIDERS 加 'cursor'
Then 守护测试四用例（键集/provider 集/逐键相等/未知全 false）全绿；漏同步则 test_provider_sets_identical 失败（D-004@v1：同步动作=4 处）

### FR-02: CursorDriver 契约实现（每轮 respawn + --resume）
覆盖决策：D-001@v1

Given 用户在 cursor 会话发出第一条消息
When driver consume 循环取出 UserTurnInput 并 spawn `cursor-agent -p --output-format stream-json --trust [--model] <prompt>`（Windows 经 resolveWindowsCmdShim 解析后 spawn，.ps1 直连边缘显式 powershell -ExecutionPolicy Bypass 包装）
Then stdout NDJSON 逐帧经 normalizeCursorFrame 归一化后以 envelope-only 调 onTurnMessage（每条事件过 safeParseAgentEvent）；收到 result 帧且进程退出后调 onTurnResult（usage 五字段短名 + session_id）

Given 首轮从帧内捕获 chatId（system/init 帧 session_id 优先，result 帧备份，create-chat 兜底）
When 用户发出第二条消息
Then driver spawn 追加 `--resume <chatId>`，对话保持上一轮记忆（Wave 0 验证 B 通过为前置；未过则 caps.resume 翻 false 并记决策）

Given 一轮进行中用户触发 interrupt
When driver 置 interruptPending 标记后 kill 进程树（Windows taskkill /T /F；posix 进程组 kill）
Then 当前轮以 `{subtype:'error_during_execution', is_error:true}` 收敛 → backend 终态 failed + error_code='interactive_interrupted'（规范通道，claude SDK abort 同款；Grill B-02）；interrupt 返回 true；无 running child 时返回 false 不冒泡

Given spawn 失败或输出流异常
When driver 捕获异常
Then 经 onTurnError 上报不吞（E3）；handle.provider='cursor' 恒定（E5）；handle 不落盘（E7）；回调不缓存复用、input 队列只消费不 mutate/close（E4）

### FR-03: cursor-events 归一化器
覆盖决策：D-001@v1

Given 真实帧 fixture（Wave 0 抓取的 .ndjson 样本）
When 逐帧喂给 normalizeCursorFrame
Then 产出符合映射表的 AgentEvent[]：system/init→status/session_started（携 session_id）、assistant 文本→text、thinking 块→thinking、tool_use→tool_use（原生工具名不重命名）、tool_result→tool_result（call_id 配对）、result→turn_result+usage 短名、未知帧→status/task_notification 降级且 metadata.original_event_type 保留原值不丢弃；每条过 safeParseAgentEvent；golden 测试逐字段断言通过

### FR-04: 三端白名单放行
覆盖决策：D-002@v1

Given backend `InteractiveProviderLiteral = Literal["claude","codex","pi"]`、daemon `VALID_PROVIDERS` Set 三键、前端两处白名单（pre-session-picker / runtime-session-helpers）三键
When 四处同步加 'cursor'
Then 显式 `provider:"cursor"` 建会话请求不再 422；daemon 重启后 cursor 会话记录可从 sessions.json 载入（不依赖 backend auto-recover 兜底）；前端门户与对话框两路径都列出 Cursor 引擎

### FR-05: 前置实测
覆盖决策：D-003@v1

Given 用户已重新 `cursor-agent login` 修复本机凭证
When 执行 Wave 0 两项实测（①两轮对话抓帧样本 + resume 记忆连续性 + create-chat 兜底交叉验证；②不带 --force 的 headless 探针）
Then 帧样本落盘 tests/fixtures/cursor/*.ndjson；帧形状结论回填设计假设（R-01/R-02 解除或修正归一化器映射）；权限模式按 D-003 判定规则落参数并记 D-003@v2

### FR-06: 测试与冒烟验收
覆盖决策：D-001@v1, D-002@v1

Given 全部代码任务完成
When 执行验收（typecheck×2 + 相关测试 + 真机冒烟）
Then：daemon/frontend typecheck 零错；provider-registry/cursor-events/cursor-driver/caps-alignment 测试全绿；前端 agent-log normalize 测试不回归；冒烟清单通过（建会话跑一轮双轨落库+SSE agent_event+usage 实时 / 第二轮 resume 连续 / interrupt 走 interactive_interrupted 通道 / caps false 项 UI 隐藏 / model_select 开放 --model 生效 / claude 零回归）

## 非功能需求

- 兼容性：未安装 cursor 的环境探测 unavailable → 前端不展示，行为不变；既有三 provider 零回归；Windows/Linux/macOS 三平台兼容（Windows shim 链路为重点）。
- 可回退：cursor driver 有问题时前端不选该引擎即可完全回避；无 daemon/backend 协议面变更（无新消息 kind、无 OpenAPI 响应变更），无错配窗口。
- 可测试：归一化器 golden 用真实帧 fixture；driver 单测覆盖生命周期/interrupt/envelope-only/E3/E5；caps 三端守护测试自动比对。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03, FR-06 | driver 架构=每轮 respawn + --resume chatId（B/C 否决证据在 decisions.md） |
| D-002@v1 | FR-04, FR-06 | 范围仅最小闭环（非目标清单见 proposal） |
| D-003@v1 | FR-05, FR-02 | 权限模式先实测再定，结论回填 @v2（剩余风险：未决至 Wave 0） |
| D-004@v1 | FR-01 | caps 守护测试 EXPECTED_PROVIDERS 同步必改（4 处非 3 处） |
