---
author: flow-machine-draft
created_at: 2026-10-04T15:01:38.918Z
---
# 决策记录（Decisions）— 2026-10-04-handoff-doc-kind-contract

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：regex 兜底从截断 JSON 提取 path 时，若 path 类键值本身被 2KB 截断切断会取出半截路径进「涉及文件」节（展示性瑕疵，不参与任何匹配/写库）。试过放弃的方案：改 daemon 侧让 tool_input 直接下发结构化 path 字段——要动 RPC 契约 + 老 daemon 兼容窗口 + 前端同步，代价远超收益；JSON 字符串解析在 backend 侧做即可闭环，故弃。
