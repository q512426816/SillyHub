---
author: qinyi
created_at: 2026-07-28 10:14:18
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 管理自己的 LLM 供应商，选预设快速新建，查余额/套餐额度 |

## 功能需求

### FR-01: 预设供应商模版一键填表单
覆盖决策：D-001
Given 用户进入「新建供应商」表单
When 用户点一个预设（如 Kimi For Coding）
Then 表单自动填好 name / base_url / auth_field / 默认模型 / 官网（api_key 留空给用户填）

Given 用户点「＋自定义」预设
When 进入表单
Then 所有字段空白，用户手填（行为同现状）

### FR-02: 预设分类排序展示
覆盖决策：D-001
Given 预设选择器展示
Then 按分类分组：官方 → 国内官方 → 聚合站，每家带图标；支持用量的标「💰 可查用量」

### FR-03: 用量查询端点
覆盖决策：D-002 / D-003 / D-004 / D-009
Given 用户有一个支持用量的供应商（如 DeepSeek）
When 前端调 `POST /api/llm-providers/{id}/usage`
Then 后端解密 api_key，按 base_url 识别供应商，代查余额接口，返回 `UsageResult{success, data:[UsageData], error}`

Given 供应商 base_url 识别不到对应 handler
When 查询
Then 返回 `success:false`（不报错，前端显示不支持）

### FR-04: 用量查询错误两态
覆盖决策：D-005
Given 上游瞬时失败（网络 / 5xx / 429 / 超时）
When 查询
Then 后端 raise（HTTP 5xx），前端保留上次成功值 10 分钟

Given 上游确定性失败（401 / 403 鉴权失败）
When 查询
Then 返回 `success:false, is_valid:false`，前端翻红（仍保留上次值）

### FR-05: 用量多窗口展示
覆盖决策：D-007
Given 供应商返回多 tier（如智谱 5 小时窗 + 周限额）
When 前端展示
Then 每个 tier 一行（plan_name / used / remaining / unit + 重置时间 + 进度条）

### FR-06: 用量触发方式
覆盖决策：D-006
Given 用户进入供应商列表页
When 页面加载完成
Then 对支持用量的供应商自动查一次余额

Given 用户点某行「查余额」按钮
When 触发
Then 手动刷新该供应商余额

### FR-07: 不支持用量的友好提示
覆盖决策：D-010
Given 不支持用量的供应商（百炼 / Anthropic 官方 / detect 不到）
When 列表展示
Then 显示「该供应商暂不支持余额查询」（不带 cc-switch 字样），不报错

### FR-08: 安全（SSRF + api_key）
覆盖决策：D-009 / R-01 / R-02
Given 用量查询代查外部 URL
When 发请求前
Then 过 SSRF 防护（复用 `tool_policy.assert_public_hostname`，IPv4+IPv6）

Given api_key 处理
When 全链路
Then 明文不出后端 / 不入响应 / 不入日志（仅局部变量，同 fetch-models NFR-02）

## 非功能需求

- **NFR-01**：用量查询上游超时 15s
- **NFR-02**：api_key 明文永不落库 / 入响应 / 入日志
- **NFR-03**：SSRF 防护 IPv4+IPv6，`getaddrinfo` 包 `asyncio.to_thread`
- **NFR-04**：预设纯前端常量，后端 / DB 无预设数据
- **NFR-05**：跨平台兼容（Windows / Linux / macOS）
