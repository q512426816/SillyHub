---
author: qinyi
created_at: 2026-10-12 20:57:41
---
# 提案书（Proposal）— 2026-10-12-session-defects

## 动机

生产会话 47e2ff1a 导出（30 轮 / 5654 条日志 / 174 任务行）实证平台五组缺陷：上下文超限连续 10 轮失败无归因无引导（用户被堵 43 分钟）、日志时间戳整批共享单值（同毫秒挤 8~31 行 ×8 簇）+ 消息碎片化回放乱码、任务表幽灵行成对 ×23、策略写守卫把 flag token 当路径 + 相对路径锚错致工作区写入全拒、config_snapshot 的 model/provider 全 NULL + 打断工具调用无日志。用户立项全部修复。

## 关键问题

为什么现有方案不够：

1. **归因断层**：daemon 分类器（sillyhub-daemon/src/model-error/classifier.ts）8 类错误不含 context_overflow，"Prompt is too long" 落 unknown；前端错误卡无专属文案；平台已有 compact_session（agent 原生压缩编排）与 auto_resume 恢复钩子，但没有 context_overflow 分支把它们接起来——能力在场，接线缺失。
2. **数据管道失真**：backend submit_steps.py:566 用单次提交共享的 st.now 盖章全部日志行；流式 delta 逐段落行无合并；agent_task_store 的 upsert 键与清扫竞态产出成对幽灵行——时间线、任务状态、导出全部失真，直接干扰缺陷定位与验收观测。
3. **守卫误拒**：shell-paths 提取器不过滤 `-` 前缀 token（deny 文案实证 `<工作区>/-p`）；path-utils 按 daemon 进程 cwd 解析相对路径（工作区 /mnt/e/... 被解析成 /mnt/c/Users/...），会话开场写入全部被误拒，代理浪费多轮探测绕行。

## 变更范围

按 D-002@v1 两波风险分层：波1 数据管道可靠性（F2 日志时间戳+碎片合并、F3 任务幽灵行、F5 config_snapshot+打断日志+导出去重）先行；波2 行为类（F1 context_overflow 归因+自动压缩续跑熔断、F4 策略路径解析）后行。落点三组件：sillyhub-daemon、backend、frontend（api-types 走 OpenAPI 生成链路）。零 migration、零新端点、wire 字段向后兼容。

## 不在范围内（显式清单）

- 不实现任何平台侧上下文压缩/摘要逻辑（D-R01 否决——压缩一律走 agent 原生 compact_session 双分路）
- 不修 sillyspec CLI 自身缺陷（cwd 耦合、deps 门控脆弱）——仅记档 docs/sillyspec/（D-008）
- 不改 agent_run_logs / agent_session_task / agent_sessions 表结构（零 migration）
- 不改 error_code 与 error_detail 正交契约（close_run_steps.py D-009 既有决策）
- 不重构 stream-json adapter 事件模型（碎片合并在 wire 转换层做）

## 成功标准（可验证）

- context_overflow 全链路归因（分类器→error_detail→前端专属错误卡），自动压缩续跑熔断=2 生效，429 配额卡透出重置时间（FR-01）
- 日志行时间戳=事件时刻，同批行时间戳不再整批同值；旧版 daemon 无 timestamp 字段时行为不变（FR-02）
- 同一助手消息最终只落一行完整内容；缓冲器 TTL 冲刷不丢内容（FR-03）
- 一个逻辑任务在 agent_session_task 至多一行真实终态，生产幽灵行模式复现测试先红后绿，导出与任务列表 API 无同任务双行（FR-04/FR-07）
- shell 写路径提取不把 flag token 当目标；相对路径按会话工作区根解析；deny 文案附双拼写提示（FR-05）
- config_snapshot 落 model/provider 非空；有拒绝结果必有 tool_call 日志行（FR-06）
- docs/sillyspec/ 两条工具缺陷记档在场（FR-08）
- 仅跑本改动相关测试与 lint/typecheck，全量留给 CI（FR-09）
