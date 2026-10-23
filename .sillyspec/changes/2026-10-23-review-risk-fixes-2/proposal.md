---
author: flow-machine-draft
created_at: 2026-10-22T23:55:20.073Z
---
# 提案书（Proposal）— 2026-10-23-review-risk-fixes-2

## 动机

任务原话转写：审查遗留四处风险修复

动机：2026-10-23 只读审查的四个未清偿发现——①sillyhub-daemon 探针淘汰竞态：_evictedCwds 按裸 rootPath 键控、唯一清除点是同名重 claim（manager.ts:1044/1245），陈旧探针在重 claim 后落地淘汰会把同根新工作区采集永久静默跳过（skip 命中零日志，daemon.ts:2356 守卫只覆盖异根）；②turn-live-marquee.tsx:371-397 rAF 回调在追平分支外无条件续排，可见且追平后 ~60fps 空转至轮终态；③turn-file-changes.ts:694-714 diff 阶段非 timeout git 错误被静默吞（无日志无 reason，快照无因降级不可排查）；④thinking-translate requestBatch 只包 apiFetch 的 try/catch，2xx 脏响应体（null/items 缺失）在 resp.engine_ready 处 TypeError 抛出后该批 Assembler 永不 settle（UI 恒翻译中）且 inflight Map 条目泄漏。

成功标准：
- 同根新 workspaceId 的采集不再被旧探针的淘汰条目静默跳过（竞态测试钉住），skip 命中有一次性 warn 日志
- 跑马灯追平目标后 rAF 停排，新内容到达或重新可见时恢复动画
- diff 阶段非 timeout git 错误落结构化 warn 日志（stage+错误归类），不再无痕消失
- requestBatch 响应处理异常时该批回退原文并入退避，Promise 不再悬挂

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 同根新 workspaceId 的采集不再被旧探针的淘汰条目静默跳过（竞态测试钉住），skip 命中有一次性 warn 日志
2. 跑马灯追平目标后 rAF 停排，新内容到达或重新可见时恢复动画
3. diff 阶段非 timeout git 错误落结构化 warn 日志（stage+错误归类），不再无痕消失
4. requestBatch 响应处理异常时该批回退原文并入退避，Promise 不再悬挂

## 成功标准（可验证）

1. 同根新 workspaceId 的采集不再被旧探针的淘汰条目静默跳过（竞态测试钉住），skip 命中有一次性 warn 日志
2. 跑马灯追平目标后 rAF 停排，新内容到达或重新可见时恢复动画
3. diff 阶段非 timeout git 错误落结构化 warn 日志（stage+错误归类），不再无痕消失
4. requestBatch 响应处理异常时该批回退原文并入退避，Promise 不再悬挂
