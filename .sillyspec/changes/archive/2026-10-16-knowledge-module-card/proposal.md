---
author: flow-machine-draft
created_at: 2026-10-16T02:43:26.709Z
---
# 提案书（Proposal）— 2026-10-16-knowledge-module-card

## 动机

任务原话转写：.sillyspec/knowledge 登记模块卡并迁移伪域 FR 到 sillyspec 真域

动机：2026-10-16-pg-index-local-followup 收口时 FR 蒸馏落伪域 fr/auto-sillyspec（knowledge 目录未登记模块卡）；登记 sillyspec 模块卡后新变更自动落真域，存量 3 条 FR（083~085）按迁域不换号铁律迁入。

成功标准：
- _module-map.yaml 新增 sillyspec 模块卡，paths 覆盖 .sillyspec/knowledge/**，配套模块文档 modules/sillyspec.md 创建
- FR-auto-sillyspec-083~085 三条迁入 knowledge/fr/sillyspec.md，条目 ID 不变（迁域不换号），伪域 fr/auto-sillyspec.md 清空或移除
- redomain 干跑与 --write 输出一致无报错，迁移后 git diff 仅涉及模块图/模块文档/知识 fr 文件

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _module-map.yaml 新增 sillyspec 模块卡，paths 覆盖 .sillyspec/knowledge/**，配套模块文档 modules/sillyspec.md 创建
2. FR-auto-sillyspec-083~085 三条迁入 knowledge/fr/sillyspec.md，条目 ID 不变（迁域不换号），伪域 fr/auto-sillyspec.md 清空或移除
3. redomain 干跑与 --write 输出一致无报错，迁移后 git diff 仅涉及模块图/模块文档/知识 fr 文件

## 成功标准（可验证）

1. _module-map.yaml 新增 sillyspec 模块卡，paths 覆盖 .sillyspec/knowledge/**，配套模块文档 modules/sillyspec.md 创建
2. FR-auto-sillyspec-083~085 三条迁入 knowledge/fr/sillyspec.md，条目 ID 不变（迁域不换号），伪域 fr/auto-sillyspec.md 清空或移除
3. redomain 干跑与 --write 输出一致无报错，迁移后 git diff 仅涉及模块图/模块文档/知识 fr 文件
