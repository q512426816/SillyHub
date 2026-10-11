---
author: flow-machine-draft
created_at: 2026-10-11T15:26:46.590Z
---
# 决策记录（Decisions）— 2026-10-11-backend-ci-golden-fixture-path

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：fixture 再生成若频繁（daemon 侧 gen 流程再跑），每次都会白跑一轮 20 分钟 backend 全量——但 fixture 变更本就低频（快照锚定实现回归），且 parity 恰恰是这些变更最需要验证的面，代价与收益对等。放弃的方案：①把 paths 放宽到 `sillyhub-daemon/**`（daemon 任意改动都触发 backend 全量，20 分钟白跑成常态，不做）；②把 parity 测试的 fixture 复制进 backend/ 目录断开跨端引用（复制即漂移，三源对照设计的目的就是单一 fixture 源，不做）；③用 paths-filter 之类动态 job（对单路径需求过重，YAML 两行的事）。
