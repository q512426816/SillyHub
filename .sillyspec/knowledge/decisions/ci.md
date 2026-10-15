# 决策知识 — ci

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-backend-ci-golden-fixture-path
锚点：未记录
最近确认：4892540870bff8d45997995ad89d60eb9ed323ed
理由：最大风险：fixture 再生成若频繁（daemon 侧 gen 流程再跑），每次都会白跑一轮 20 分钟 backend 全量——但 fixture 变更本就低频（快照锚定实现回归），且 parity 恰恰是这些变更最需要验证的面，代价与收益对等。放弃的方案：①把 paths 放宽到 `sillyhub-daemon/**`（daemon 任意改动都触发 backend 全量，20 分钟白跑成常态，不做）；②把 parity 测试的 fixture 复制进 backend/ 目录断开跨端引用（复制即漂移，三源对照设计的目的就是单一 fixture 源，不做）；③用 paths-filter 之类动态 job（对单路径需求过重，YAML 两行的事）。
