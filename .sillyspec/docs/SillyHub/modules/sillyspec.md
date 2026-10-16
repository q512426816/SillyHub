---
schema_version: 1
doc_type: module-card
module_id: sillyspec
author: WhaleFall
created_at: 2026-10-16 10:46:00
---

# SillySpec 规范资产（sillyspec）

## 定位
`.sillyspec/knowledge/**` 规范知识树——SillySpec 流程的交付资产面：变更收口时 fr-index 蒸馏（FR 索引）与决策收割（rejected 防复潮）写入，brainstorm/flow 的知识注入消费。2026-10-16-pg-index-local-followup 实证：该目录未登记模块卡时 FR 蒸馏落伪域 `auto-sillyspec`（fr/auto-sillyspec.md），登记后路径投票命中真域。

## 契约摘要
- 无代码端点；纯文件契约：
  - `knowledge/fr/<域>.md` — FR 索引（`sillyspec-fr-index` 机器维护，条目勿手改；`## FR-<ID>` + 变更/状态/摘要/全文/最近确认五要素）
  - `knowledge/decisions/<域>.md` — 决策库（D-xxx@vN rejected 死路防复潮）
  - `knowledge/uncategorized.md` — 收件箱（新踩坑尾部追加，成熟后迁分类文件并加 INDEX 索引）
  - `knowledge/INDEX.md` — 检索索引
- 维护命令：`sillyspec tests --redomain --from <伪域> --to sillyspec [--by-change <名>] [--write]`（迁域不换号——ID 是绑定/supersede 链寻址键）

## 关键逻辑
fr-index 蒸馏域路由按交付文件路径投票：命中本模块 paths（`.sillyspec/knowledge/**`）→ sillyspec 真域；未登记目录回退 `auto-<路径段>` 伪域（无模块卡，蒸馏仍可落但索引面割裂）。

## 已知边界
- 本卡只登记 knowledge 树；`.sillyspec/changes/**`（治理工件，不入冻结面）与 `.sillyspec/docs/**`（模块文档树）暂不归属——docs 树如需真域另立卡。
- `_module-map.yaml` 头部 generator: sillyspec-scan——scan 属 advisory 重生成（人工确认后落盘），本条目 paths 为 scan 无法推导的规范资产域，正常不冲突。
