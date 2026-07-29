---
author: qinyi
created_at: 2026-07-29T10:19:10
---
# 需求规格（Requirements）— 模型调用失败可见性完整修复

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在 claude code 会话页与 agent 交互，遇到模型失败时需看到原因并能为操作 |
| 开发者 | 实现 daemon / backend / frontend 三端错误可见性 |

## 功能需求

### FR-01: claude 模型调用失败归类为结构化错误
覆盖决策：D-001@v1, D-005@v1, D-006@v1
Given claude code 交互会话中 claude 调模型失败（result.is_error=true 或 api_retry 带 error 或 assistant stdout 含 "API Error"）
When daemon 收到 result / 错误事件
Then 归类为 ModelError{type, code, message, retryable, hint, raw}；type ∈ {auth_failed, quota_exceeded, rate_limited, timeout, model_not_found, network, provider_error, unknown}；429 区分 quota_exceeded（文本含「上限/quota」，不可重试）与 rate_limited（Too Many Requests，可重试）

### FR-02: 错误结构化存储与透传
覆盖决策：D-005@v1, D-007@v1, D-009@v1
Given daemon 归类出 ModelError
When notifyRunResult 回传后端（payload 带 error）
Then AgentRun.error_detail（JSON）存储完整 ModelError；run status=failed；`GET /sessions/{id}/runs` 返回 error_detail；SSE 推 error 事件；error_code（调度层/系统错误）与 error_detail（模型层 ModelError）正交，不互相覆盖

### FR-03: 错误项展示与操作
覆盖决策：D-002@v1, D-003@v1, D-004@v1
Given run failed 且有 error_detail
When 前端渲染会话
Then 消息流插入 RunErrorItem（图标按 type + 「运行失败」+ message + hint）；run/session 标 failed（标红）；带 actions：重新发送（重新 inject 同一 prompt）/ 切换供应商（跳 llm-provider 设置）/ 查看详情（展开 raw 原始错误）

### FR-04: 成功路径与既有日志不回归
覆盖决策：D-008@v1
Given run is_error=false（成功）或历史 run 无 error_detail
When 前端渲染
Then 成功路径无 ModelError（error_detail=None，不受影响）；历史 failed run 兜底显示「运行失败（无详情）」；agent-log-display-fix 的 NOISE 折叠 / 去重不误吞 error_detail 错误项

## 非功能需求
- **兼容性**：新旧 daemon/backend 混合不阻断（error 字段可选，缺失兜底）；兼容 Windows / Linux / macOS。
- **可回退**：migration down = drop_column；前端 error_detail 缺失兜底；error 字段在契约中可选。
- **可测试**：classifier 各 type 单测；backend 存储 + API 测试；前端组件 + normalize 测试；e2e 复现（GLM 额度耗尽 → 错误项）。
- **不影响 PPM 模块**（已上线）。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 范围 = claude 交互会话优先 |
| D-002@v1 | FR-03 | 展示 = 消息流错误项 + 状态失败 |
| D-003@v1 | FR-01, FR-03 | 细分类型 + 针对性提示 |
| D-004@v1 | FR-03 | 重发 / 切换供应商 / 查看详情 actions |
| D-005@v1 | FR-01, FR-02 | 方案 C 三端标准协议 |
| D-006@v1 | FR-01 | 429 区分 quota_exceeded vs rate_limited |
| D-007@v1 | FR-02 | AgentRun 用 JSON 列 error_detail |
| D-008@v1 | FR-04 | Non-Goals 边界（不改 GLM token / 不回填 / 不自动恢复） |
| D-009@v1 | FR-02 | error_code vs error_detail 分工 |

全部当前版本 D-001@v1 ~ D-009@v1 均有 FR 覆盖，无剩余风险。
