---
author: qinyi
created_at: 2026-08-29 13:34:52
plan_level: light
---

# 轻量计划（Light Plan）：会话内 Token 用量统计展示

## 来源
用户需求（2026-08-29）：「会话中，加个本会话 token 用量统计显示 输入输出 缓存输入 请求次数 这些，再加个缓存命中率显示」。brainstorm 四件套 + decisions D-001~D-004（双模式展示/汇总+模型明细/cache_read÷(cache_read+input)/新增聚合端点方案 A）为唯一直接来源，不重新扩写。

## 范围
- backend：`daemon/schema.py`（SessionUsageRead/SessionUsageModelItemRead）、`daemon/session/service.py`（get_session_usage 两段聚合）、`daemon/router.py`（GET /sessions/{id}/usage）、`daemon/tests/test_session_usage.py`
- frontend：`lib/daemon.ts`（getSessionUsage）、`components/daemon/session-usage-bar.tsx`（新组件）+ `__tests__/session-usage-bar.test.tsx`、`components/daemon/session-panel.tsx`（双模式接线+refreshSignal）
- 生成物：`backend/openapi.json` + `frontend/src/lib/api-types.ts`（gen:types）
- 任务链（tasks.md task-01→05）纯线性无并行，light 单隐式 Wave 串行执行即真实拓扑。

## 验收
- AC-01（FR-01）: `GET /sessions/{id}/usage` 返回 totals+by_model；纯明细/纯兜底/混合三态 SUM 正确，「未记录」桶恒末位、api_requests=0、ctx_tokens 不参与求和（对账测试）。
- AC-02（FR-01, FR-04）: 非属主 404 resource-hiding / 未认证 401 / 无数据会话 200 全 0 空 by_model。
- AC-03（FR-02）: page 会话详情与 dialog 浮窗均渲染用量条：摘要行五指标+命中率（分母 0 →「—」），按模型明细可折叠。
- AC-04（FR-03）: 轮次终态后 refreshSignal 递增触发重新拉取（mock 调用次数断言，无 QueryClientProvider）。
- AC-05（FR-01）: gen:types 同步提交；backend 相关 pytest + frontend 组件/面板测试全绿；tsc 0 错。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-04 | AC-03 |
| D-002@v1 | task-01, task-03 | AC-01, AC-03 |
| D-003@v1 | task-03 | AC-03 |
| D-004@v1 | task-01, task-02 | AC-01, AC-02 |
