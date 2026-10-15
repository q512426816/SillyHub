---
author: flow-machine-draft
created_at: 2026-10-14T04:14:14.822Z
---
# 决策记录（Decisions）— 2026-10-14-litellm-retire

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：未来新增 openai_like 供应商（无原生 anthropic 端点的上游）时转换链路缺失——当前零供应商依赖 litellm，且重引路径已文档化（本坑记录 + spike-litellm-routing 历史可考古）；接受。次风险：本机 plain v1.95.0 healthy 3 天提示上游构建可能已修复，退役放弃了「零成本复测复活」机会——拍板时已向用户披露并选择退役（不再等上游）。死路：尝试「只删 prod 留 dev」——两处定义漂移正是 10-06 compose 同步教训的反面，不留双态。
