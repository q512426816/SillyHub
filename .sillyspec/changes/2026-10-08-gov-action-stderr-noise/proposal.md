---
author: flow-machine-draft
created_at: 2026-10-08T09:02:41.497Z
---
# 提案书（Proposal）— 2026-10-08-gov-action-stderr-noise

## 动机

任务原话转写：动机：知识库信号卡「一键修复路径」点完只看到 Node SQLite ExperimentalWarning——daemon 把 CLI stderr 告警拼进 output 尾部返回，前端仅展示末尾 160 字符，真实结果文案（如『1 个无法定位需人工核』）被挤掉，用户无法得知修复到底成没成。
成功标准：
- daemon knowledge.action 返回的 output 过滤 Node 进程告警噪声行（(node:NNN) XxxWarning 行与其 (Use node --trace-warnings 续行），CLI 真实结果文案完整保留
- 失败路径（action failed 前缀）同样不再携带告警噪声
- tests/knowledge-governance-handler.test.ts 新增 stderr 含 ExperimentalWarning 场景用例，该文件既有用例全绿

## 变更范围

按成功标准机械推导，共 1 条验收面：
1. daemon knowledge.action 返回的 output 过滤 Node 进程告警噪声行（(node:NNN) XxxWarning 行与其 (Use node --trace-warnings 续行），CLI 真实结果文案完整保留- 失败路径（action failed 前缀）同样不再携带告警噪声- tests/knowledge-governance-handler.test.ts 新增 stderr 含 ExperimentalWarning 场景用例，该文件既有用例全绿

## 成功标准（可验证）

1. daemon knowledge.action 返回的 output 过滤 Node 进程告警噪声行（(node:NNN) XxxWarning 行与其 (Use node --trace-warnings 续行），CLI 真实结果文案完整保留- 失败路径（action failed 前缀）同样不再携带告警噪声- tests/knowledge-governance-handler.test.ts 新增 stderr 含 ExperimentalWarning 场景用例，该文件既有用例全绿
