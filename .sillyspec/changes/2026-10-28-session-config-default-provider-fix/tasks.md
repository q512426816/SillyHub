---
author: flow-machine-draft
created_at: 2026-10-28T03:11:53.137Z
---
# 任务注册表（Tasks）— 2026-10-28-session-config-default-provider-fix

- [x] task-01: pi 会话/预会话下供应商控件显示按引擎（agent_kinds）过滤后的默认供应商名，无引擎匹配默认时显示「本机默认」而非 claude/codex 供应商名
- [x] task-02: 未显式选供应商但存在引擎匹配的默认供应商时模型下拉渲染且候选跟随该供应商模型列表，显式选择行为与请求载荷不变（不新增 llm_provider_id 上送）
- [x] task-03: 工作区弹窗（dialog 模式）新建会话首句携带用户填写的模型值（有值才带，空值零回归）
- [x] task-04: session-config-bar 与 session-panel-dialog 相关既有测试不回归，新增用例覆盖上述三点
- [x] task-05: 排队派发链路核查：运行中暂存配置随排队消息派发时生效（reloadWithConfig 先重载后喂消息），与用户期望「agent 接收到新消息时切换」一致，结论落档不改动切换时序
