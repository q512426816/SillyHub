---
author: flow-machine-draft
created_at: 2026-10-17T09:23:32.275Z
---
# 决策记录（Decisions）— 2026-10-17-dsh-rc2-routing-restore

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：dsh 下个版本再改 compatProfile/valueId 形状——探针脚本 + configOptions 运行时可观测（模型目录出现/消失一目了然），回归成本低。已放弃：保留 compat 块仅修正漂移字段（rc.2 schema 字段集未文档化，逐字段试探成本高于整块去除——catalog 默认值由引擎按 api 协议自动补齐，语义无损）。
