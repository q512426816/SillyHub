---
author: qinyi
created_at: 2026-08-29 13:22:15
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话详情页/浮窗对话与 agent 对话的用户 |
| 平台 backend | FastAPI 服务，持有 agent_runs / agent_run_model_usage 数据 |

## 功能需求

### FR-01: 会话用量聚合查询
覆盖决策：D-004@v1
Given 一个会话含若干轮次（run），其中部分轮次有按模型明细行（2026-08-29 后）、部分只有 AgentRun 四维 token 列（历史轮次）
When 调用 `GET /api/daemon/sessions/{session_id}/usage`
Then 返回 `SessionUsageRead`：`totals`（输入/输出/缓存读取/缓存写入/请求次数五指标 = 明细+兜底之和）与 `by_model`（每模型五指标，按 input+output 降序，「未记录」兜底桶恒末位）；兜底桶 api_requests=0；`ctx_tokens` 快照列不参与任何求和

Given 会话无任何用量数据（新会话/全零）
When 调用同一端点
Then 200 返回全 0 totals 与空 by_model（不 404）

### FR-02: 会话内用量展示
覆盖决策：D-001@v1, D-002@v1, D-003@v1
Given 用户打开会话
When 页面渲染
Then page 会话详情页（会话头部下方）与 dialog 浮窗（输入框上方）都显示用量条：摘要行常驻五指标 + 缓存命中率（= cache_read ÷ (cache_read + input)，分母 0 显示「—」）；「按模型明细」可折叠展开分组表（模型/四维/请求/命中率）

### FR-03: 随轮次终态刷新
Given 会话内一轮对话结束（轮次终态事件到达前端）
When 用量条所在组件收到 refreshSignal 递增
Then 重新拉取聚合端点并更新显示（不做秒级轮询）

### FR-04: 归属与安全
Given 非会话属主的认证主体（或会话不存在）
When 调用 `GET /sessions/{session_id}/usage`
Then 404 resource-hiding（与既有会话端点同语义）；未认证 401

## 非功能需求
- NFR-01: 聚合在 SQL 侧完成（JOIN/GROUP BY），不拉 run 明细行进内存。
- NFR-02: 组件不依赖 react-query（dialog 零 react-query 约束），双模式单一实现。
- NFR-03: UI 中文展示，数字千分位/万级缩写对齐运行时页用量卡先例。
