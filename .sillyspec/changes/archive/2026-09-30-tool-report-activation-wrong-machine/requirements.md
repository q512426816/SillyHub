---
author: qinyi
created_at: 2026-09-30 11:00:12
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 开发者（会话属主） | 在平台上浏览本地 Agent 会话回放并发起接手继续对话的用户 |
| CLI/daemon（上报方） | 上报本地 harness 会话日志元信息与机器身份的客户端 |
| 平台后端 | 接管 takeover 派发、机器匹配、重置与协议接收 |
| 接手 agent | 分叉出的新会话执行引擎（native resume 或 handoff 交接文档） |

## 功能需求

### FR-01: 上报协议 v2 携带机器身份并落库

覆盖决策：D-001@v1

Given `POST /api/platform-sync/agent-logs` 上报链路（CLI 直跑与 daemon 注入两路）
When entries 携带 `machine` 块（`machine_id?`、`hostname?`）
Then platform_agent_logs MUST 落 `reported_machine_id`/`reported_machine_name` 两列；会话聚合分支 MUST 将最新 entry 机器身份写入 `config_snapshot.latest_reported_machine`（producer=上报 body → platform_sync schema 解析 → 两列/快照 → consumer=FR-03 匹配与 GET /agent-logs 响应字段）

#### 场景：老协议兼容

Given 老 CLI 上报不含 machine 块
When upsert 处理该 entries
Then 两列 MUST 落 NULL 且 MUST NOT 报错（extra=ignore 既有行为），上报幂等语义不变

### FR-02: 分叉式接手（原会话只读）

覆盖决策：D-006@v1
承接: 归档 2026-08-23-agent-activity-sessions FR-05 懒激活（退役理由：原会话激活错机钉死+回放主体被切走，改为只读+分叉接手）

Given 未激活 tool_report 会话（status=pending、turn_count=0）
When 用户在输入区发送首条消息（POST /sessions/{id}/takeover）
Then 后端 MUST 创建新接手会话（origin='fork' + `fork_of_session_id`=源会话 + fork 三件套，源会话零 run 时 `fork_at_run_id`/`engine_fork_anchor` 为 NULL）并派发首轮；源会话 MUST 保持 pending/turn_count=0（任何路径 MUST NOT 写 active/lease/runtime 到源会话）

#### 场景：旧入口拒绝

Given pending tool_report 会话收到 inject 请求
Then MUST 返回 409 + 中文指引（引导 takeover 端点），懒激活分支 MUST 已退役（`_activate_tool_report_session` 删除）

### FR-03: 原机四级钉定派发

覆盖决策：D-001@v1, D-002@v1

Given takeover 请求
When 解析目标 runtime
Then MUST 按四级顺序匹配：① 最新 entry `reported_machine_id` 精确匹配在线 runtime → ② `reported_machine_name` 匹配 `daemon_runtimes.name`（在线）→ ③ 无机器信息时按 `cwd ∈ runtime.allowed_roots` 匹配唯一在线机器 → ④ 无果或多台歧义 MUST 409 中文报错（含机器名与"开机/装 daemon"指引）；匹配后 MUST 钉定该 runtime 派发，MUST NOT 静默换机

#### 场景：原机离线

Given 上报机器可识别（①②级命中身份）但该机器 runtime 离线
When takeover
Then MUST 409（文案含机器名），MUST NOT 建会话 MUST NOT 回退其它机器

### FR-04: 引擎分档衔接（native resume / handoff 交接文档）

覆盖决策：D-004@v1, D-005@v2

Given 源会话 harness 可判定
When takeover 分档
Then harness ∈ {claude-code, codex}（caps.resume=True）MUST 走 native 档：lease metadata 携带 `resume_session_id`=上报 session_id（producer=platform_agent_logs.session_id → lease metadata → daemon claim payload → SDK resume）；其余 harness（zcode 等）MUST 走 handoff 档：经 daemon RPC `read_agent_log_messages` 读归一化消息 → `build_handoff_prompt` 模板（体积帽+截断声明）→ 新会话首 prompt=交接文档+用户消息

#### 场景：handoff 引擎/档案重选

Given handoff 档请求携带 provider/agent_profile_id/llm_provider_id
When 校验
Then 所选 provider MUST 属于原机 runtime 支持集合（按 daemon_instance 聚合），不符 MUST 422；默认值 = harness 映射

#### 场景：交接文档读取失败降级

Given 原机在线但 RPC 读日志失败
When handoff 档组装
Then MUST 降级为普通新会话激活（不带交接文档），响应 `handoff_doc=false` 供前端提示，MUST NOT 阻塞接手

### FR-05: 存量钉死会话一键重置

覆盖决策：D-003@v1

Given 存量已激活（旧懒激活路径）钉死在错误机器的 tool_report 会话
When 属主调用 POST /sessions/{id}/reset-tool-report
Then 后端 MUST 校验（origin=tool_report、属主、无 running run，running 时 409）后回滚：status=pending、turn_count=0、runtime_id/lease_id=NULL、失败 run 保留审计标记；MUST 发布 sessions_changed 事件使前端回放主体自动恢复

### FR-06: 前端衔接状态 UI

覆盖决策：D-002@v1, D-005@v2, D-006@v1

Given 未激活 tool_report 会话面板
When 渲染输入区
Then MUST 展示衔接方式提示条（native 档=接续原会话+派发机器名；handoff 档=分叉新会话+交接文档说明）；handoff 档 MUST 提供接手 agent 选择器（原机引擎集合 + 智能体档案下拉）；原机离线 MUST 禁用输入并显示错误卡（回放仍可浏览）；发送 MUST 走 takeover 端点并按响应 new_session_id 切换会话；已激活（turn_count>0）tool_report 会话 MUST 提供「重置为未激活」入口（确认弹窗）

#### 场景：普通会话零影响

Given origin=chat 会话
When 渲染会话面板
Then 以上新元素 MUST NOT 出现

## 非功能需求

- 兼容性：老 CLI 上报、旧前端 inject、存量已激活会话三条回退路径 MUST 可用（design 兼容策略节）
- 可回退：takeover/reset 为纯新增端点，回退 = 移除入口；协议 v2 字段全部 nullable 无破坏
- 可测试：四级匹配、分档、交接模板帽、重置守卫、协议兼容均有单测（文件清单三测试文件）
- 约束强度：全文 MUST/MUST NOT 按 RFC 2119；「宁拒不猜」（歧义匹配 409）为红线语义

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03 | 方案 B 总纲（机器身份+原机钉定+交接+machineId 就绪） |
| D-002@v1 | FR-03, FR-06 | 原机优先离线 409 不换机 |
| D-003@v1 | FR-05 | 存量重置（D-006 后收敛为存量兜底） |
| D-004@v1 | FR-04 | resume 引擎感知（claude-code 回原会话/zcode 交接） |
| D-005@v2 | FR-04, FR-06 | handoff 引擎+档案重选（载体 takeover 端点，supersedes v1 inject 措辞） |
| D-006@v1 | FR-02, FR-06 | 分叉式接手（原会话只读+fork 溯源） |

## 测试绑定（收编追加——每条 FR 至少一行：test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名，如 test/foo.test.mjs「用例组」或 test/foo.test.mjs#用例；无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
