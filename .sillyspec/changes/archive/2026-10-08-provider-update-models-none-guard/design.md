---
author: flow-machine-draft
created_at: 2026-10-08T00:36:19.669Z
---
# 设计记录（Design Record）— 2026-10-08-provider-update-models-none-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

在 `service.update()` 的 updates 弹出区（agent_kinds None-pop 之后、setattr 循环之前）补同款 models None-pop。依据：`schema.py::LlmProviderUpdate.models` 注释已声明契约「None=不动；非 None 时整表替换」（b8afd807c 引入列时声明），但实现漏配——`44eb2e5c9` 已为 agent_kinds 修复同型故障，b8afd807c 晚于其 7 小时合入 models 列却未带上同款防护。

实测故障机制（比预判更隐蔽，task-01 先红时 SQL 追踪确认）：`setattr(row, "models", None)` 后 ORM flush 在 SQLite 上把 Python None 经 JSON 绑定序列化为**字符串 `'null'`** 写入（`UPDATE llm_providers SET models='null'`，非 SQL NULL），NOT NULL 约束不拦——PATCH 返回 200、行被静默写坏；读回 `row.models is None`，`LlmProviderRead.models: list[ProviderModelEntry]` 序列化 None → 该用户 GET /api/llm-providers 列表端点 500（比写路径报错更晚暴露）。PostgreSQL 侧两种形态（SQL NULL 撞 NOT NULL 500 / JSON null 同样静默写坏）均由同一 None-pop 收敛。最小改动：一行防护 + 一条回归用例；不改列定义、不动迁移、不动前端（`formToUpdate` 恒发数组，UI 面本就不触发）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `LlmProviderService.update(provider_id, user_id, data)`：显式 `models=None` 从「setattr → SQLite 静默写坏行（JSON 'null' 字符串）/ PG NOT NULL 500 → 后续列表端点 500」收敛为「不动原列表」，与 agent_kinds / api_key 的 None=不动语义对齐。
- HTTP `PATCH /api/llm-providers/{id}`：body 携带 `"models": null` 时行不变且成功返回；非 None 列表仍整表替换（既有语义不动）。
- schema / 路由 / 迁移 / 前端：零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——单请求内同步处理，无事件序参与。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   与 agent_kinds 防护同位同险；两个并发 PATCH（一个 models=null、一个 models=[新列表]）按既有行级最后提交者胜，本变更不新增窗口（pop 只改变 null 的语义，不引入锁）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   pop 发生在 setattr 循环前，异常路径与既有完全一致；models=null 永不进写路径。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   归属校验沿用 `self.get(provider_id, user_id)`，不涉及跨工作区/多实例串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：防护误伤「显式清空/替换列表」语义——已排除：清空应传 `[]`（非 None），防护只拦 None，回归用例内双断言钉死。放弃的方案：schema 层 validator 拒收 models=None——会使 openapi anyOf null 契约与字段注释「None=不动」双双失真，且与 api_key/agent_kinds 既有 None-pop 惯例不一致，不采用。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/llm_provider/service.py | update() 补 models 显式 None-pop（一行防护+注释） |
| 修改 | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | 新增 test_explicit_null_models_is_noop 回归用例（noop + 整表替换不误伤双断言） |
