---
author: qinyi
created_at: 2026-10-12 20:57:41
---
# 需求规格（Requirements）— 2026-10-12-session-defects

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 通过平台会话与 agent 协作的人；缺陷直接受害者（会话堵死/日志乱码/任务状态失真/写入误拒） |
| 平台开发者 | 维护 backend / sillyhub-daemon / frontend 三组件；依赖日志与任务数据排障 |
| daemon 执行端 | sillyhub-daemon 进程，spawn claude/pi/codex 等 agent CLI，回传消息与终态 |

## 功能需求

### FR-01: context_overflow 全链路归因与自动压缩续跑（含熔断）
覆盖决策：D-003@v1, D-006@v1

- daemon 分类器 MUST 新增 `context_overflow` 类型：错误文本含 "Prompt is too long"（大小写不敏感）/ "maximum context length" / "context_length_exceeded" / "context window" 之一即 MUST 命中归类；ERROR_INFO 中文文案按 design §W2-T1。
- backend `maybe_auto_recover_failed_turn` MUST 新增 context_overflow 分支：error_detail.type=context_overflow 且 provider caps compact=true 且连续链计数 <2 时，MUST 调 `compact_session` 并在成功后重放本轮用户消息（内联直插 AgentSessionScheduledMessage，delay=0；场景化新模板，禁走 maybe_enqueue_auto_resume——G3 门禁仅放行 daemon_restarted）。
- 连续链计数 ≥2 或 compact 失败/不支持时 MUST NOT 入队重放，且 MUST 落用户引导（_write_chain_limit_hint 同款，AppError 不得吞引导；仅 DB 写失败降级纯日志）。
- 前端 MODEL_ERROR_META MUST 增加 context_overflow 专属中文卡；quota 卡 MUST 透出 resetAt。
- error_code 与 error_detail 正交契约 MUST NOT 被本需求改写（D-009 保持）。

#### 场景：上下文超限自动恢复

- Given interactive 会话 run 收口 error_detail.type=context_overflow（首次）
- When auto_recover 钩子执行
- Then compact_session 被调用且成功后定时消息表入队一条场景化标记的原文重放消息

#### 场景：熔断

- Given 同会话沿链已连续 2 次 context_overflow
- When 第 3 次 context_overflow run 收口
- Then 不调 compact_session、不入队重放，落链上限引导

#### 场景：归因命中

- Given turn 失败且 resultText="API Error: Prompt is too long"
- When classifyModelError 执行
- Then 返回 type=context_overflow、retryable=false、中文 hint

### FR-02: 日志行时间戳反映事件发生时刻
覆盖决策：D-004@v1

- wire 消息对象 MUST 增加可选 `timestamp`（ISO-8601，事件到达时刻捕获）；backend submit_steps 落库 MUST 优先解析 msg["timestamp"]，缺省/非法/与本地钟差 >5 分钟 MUST 回落 st.now；SSE 推送 MUST 携带同一事件时间戳。
- 旧版 daemon（无 timestamp 字段）行为 MUST 与现状完全一致。

#### 场景：批量提交时间戳分散

- Given daemon 单次 submit 携带 N≥3 条消息、各消息 timestamp 互异
- When backend 落库
- Then N 行 agent_run_logs.timestamp 与各消息 timestamp 一致，不再整批同值

#### 场景：向后兼容

- Given 旧版 daemon submit 消息无 timestamp 字段
- When backend 落库
- Then timestamp=st.now（现状行为），无异常

### FR-03: 同一助手消息单行完整落库
覆盖决策：D-004@v1

- daemon wire 层 MUST 按 message id 缓冲连续 assistant/thinking 流式 delta，消息完结时输出单行完整内容；缓冲器 MUST 带 TTL/上限（超限冲刷为独立行，宁可碎片不丢内容）。
- segment_id partial→final 覆盖链路 MUST 在流式路径补删残留。

#### 场景：delta 合并

- Given 同一 message id 的 3 个流式 delta（"A"、"B"、"C"）+ 完结事件
- When wire 转换执行
- Then 输出恰 1 条 content="ABC" 的完整行，无独立 delta 行残留

#### 场景：缓冲不丢失

- Given 某 message 只有 delta 无完结事件且缓冲达 TTL
- When 冲刷触发
- Then 已缓冲内容按序输出为独立行（宁可碎片不丢失）

### FR-04: 任务幽灵行根治（一逻辑任务一行）
覆盖决策：D-005@v1

- MUST 以生产成对模式（同 session 同名 stopped(空摘要)+completed(真摘要)）写复现测试（先红后绿）；修复后同会话同名任务 MUST 在 agent_session_task 至多一行真实终态。
- 既有语义 MUST 保持：迟到 running 不复活终态行、异种终态允许覆盖、清扫复活守卫不变。
- 若引入「停用旧行」标记，MUST 与 RUN_CLOSE_SWEEP_REASON 文案显式区隔（复活守卫仅精确匹配清扫文案）。

#### 场景：复现转绿

- When 执行幽灵行复现测试（按生产事件序列：完成回写后到达同名新 task_id 事件/清扫竞态）
- Then 修复前断言失败（成对行存在），修复后同断言证明至多一行真实终态

### FR-05: 策略写守卫路径解析三类误拒清零
覆盖决策：D-007@v1

- shell-paths 提取 MUST 过滤 `-` 前缀 token（tee/mkdir/touch 捕获组、重定向目标、PowerShell/CMD 位置参数捕获，捕获即弃）。
- 相对路径解析 MUST 以会话工作区根为 anchor（path-utils anchor 参数贯通 path-utils→filesystem-policy→write-guard 四分支；anchor 默认值 MUST 保持 process.cwd() 现行为，其他调用点零变化）。
- deny 文案在 normalizedPath 与原始拼写不一致时 MUST 附「原始路径 X 解析为 Y」。

#### 场景：flag 不当路径

- When 对 `mkdir -p foo && unzip -p x.zip a > b.txt` 执行提取
- Then 提取结果不含 `-p`

#### 场景：相对路径锚定会话根

- Given 会话工作区根 /ws/root 且 allowed_roots 含之，命令 `echo hi > out.txt`
- When write-guard 裁决
- Then 目标解析为 /ws/root/out.txt 且放行（不再锚定 daemon cwd）

#### 场景：deny 双拼写提示

- Given 目标 realpath 与原始拼写不同且判定 deny
- When 生成 deny 文案
- Then 文案含原始路径与解析后路径两个拼写

### FR-06: config_snapshot 落 model/provider + 打断工具调用日志行
覆盖决策：D-001@v1（范围），落点 design W1-T4

- 会话供应商绑定/切换后 config_snapshot 的 model/provider_name/profile_name MUST 非空（create.py 绑定前窗口 + inject.py 切换分支回写）。
- daemon run 中断/工具拒绝路径 MUST 保证「有拒绝结果必有对应 tool_call 行」。

#### 场景：快照非空

- Given 会话创建时供应商未绑定、后经 inject 绑定/切换 llm_provider
- When 导出该会话
- Then config_snapshot.model 与 provider_name 非 null

#### 场景：拒绝有痕

- Given 工具调用被用户拒绝（产生拒绝对结果日志）
- When 检查该 run 日志行
- Then 存在对应 tool_call 行（工具名+入参）

### FR-07: 导出与任务列表去重
覆盖决策：D-005@v1

- session 导出（export.py）与任务列表 API（session_insights.py GET /sessions/{id}/tasks）MUST 同口径去重：同 session 同名任务取最新真实终态行，输出 MUST NOT 出现同任务双行。

#### 场景：导出无幽灵

- Given 库中存在生产幽灵成对行（历史数据）
- When 执行 full 档导出
- Then 渲染输出每任务名恰一行（真实终态行）

### FR-08: sillyspec 工具缺陷记档
覆盖决策：D-008@v1

- docs/sillyspec/ MUST 新增两条活跃坑记录：cli-cwd-coupling.md、deps-gate-offline-fragile.md（含现象/根因/影响/绕过方案）。

#### 场景：记档在场

- When 检查 docs/sillyspec/ 目录
- Then 两个新文件存在且含四要素

### FR-09: 仅跑本改动相关测试（规则 0）

- 本变更 MUST 只运行改动模块相关测试（backend pytest 按 module、daemon/frontend vitest 相关文件）与 lint/typecheck；MUST NOT 跑全量测试套件（全量留给 CI）。

#### 场景：相关面回归

- When 运行相关测试与 lint/typecheck
- Then 全部通过且未执行全量套件

## 非功能需求

- 兼容性：wire timestamp 可选向后兼容（旧 daemon 行为不变）；ModelErrorType 新枚举部署顺序 backend 先发（Literal 拒绝风险见 design R-05 实测预案）。
- 可回退：auto_resume 新分支 caps.compact=false 自动跳过；path anchor 默认值=现行为；全部改动不带新配置项即可回退到既有行为。
- 可测试：每 FR 有对应自动化用例（验收矩阵见 requirements 尾表）；FR-04 复现测试先红后绿留痕。
- 恢复安全：auto_recover 钩子异常 MUST NOT 影响已 commit 终态（既有 NFR 延续），但用户引导面 MUST NOT 被静默吞掉。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01~FR-08 | 五组全修范围 |
| D-002@v1 | FR-02/03/04/06/07 先行，FR-01/05 后行 | 两波风险分层 |
| D-003@v1 | FR-01 | 压缩复用 agent 原生 compact_session，平台只编排 |
| D-004@v1 | FR-02, FR-03 | wire 事件时间戳 + delta 合并 |
| D-005@v1 | FR-04, FR-07 | 幽灵行不变量 + 导出/列表双面去重 |
| D-006@v1 | FR-01 | 可恢复失败不终态化 interactive 会话 |
| D-007@v1 | FR-05 | flag 过滤 + 会话根 anchor + 双拼写文案 |
| D-008@v1 | FR-08 | CLI 缺陷只记档不修码 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-07: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-08: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-09: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
