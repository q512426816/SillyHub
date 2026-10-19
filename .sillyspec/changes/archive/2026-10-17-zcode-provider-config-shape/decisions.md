---
author: flow-machine-draft
created_at: 2026-10-17T04:50:08.758Z
---
# 决策记录（Decisions）— 2026-10-17-zcode-provider-config-shape

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：引擎版本演进改目录推送时序或 setModel schema（如将来允许字符串/免 reasoningLevel）——60s 窗口与 levels 提取按当前实证形状钉死，引擎升级需回归（MIN_VERSIONS zcode (0,16,9) 已有版本门兜底）。已试并放弃：裸 setModel 兜底重试（引擎对象路径缺 reasoningLevel 恒拒，重试无意义）；setModel 前置到会话空闲期后台执行（engine 默认模型不保证等于平台路由模型，turn 1 可能脱路由——保持阻塞确定性优先）。
