---
author: flow-machine-draft
created_at: 2026-10-13T03:53:45.019Z
---
# 决策记录（Decisions）— 2026-10-13-agentlog-write-diff

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：共享模块迁移（daemon/tool-args-detail → agent-log/tool-diff）破坏既有导入面。缓解：daemon 侧保留同名 re-export，既有测试（tool-args-detail.test.tsx 直接 import DiffView/parseStructuredPatch）零改动通过即证明。 放弃的方案：(a) agent-log 直接 import daemon/tool-args-detail 的 DiffView——会形成 tool-renderers ↔ tool-args-detail 循环依赖（后者已 import 前者的 CopyButton），放弃；(b) 同步接线 agent-log-card 会话化对话视图——其数据源是 daemon read_agent_log_messages（另一条链，daemon 侧需动 messages 解析），超出薄跑道范围，留后续变更；(c) Write 无 patch 时也整文件全绿（照搬会话面板行为）——本变更成功标准承诺零回归保持全文预览，且 agent-log 面已提供「原始数据」折叠兜底，不做双面不一致的行为扩散。
