---
author: flow-machine-draft
created_at: 2026-10-15T00:42:33.492Z
---
# 提案书（Proposal）— 2026-10-14-decision-anchor-change-qualified

## 动机

任务原话转写：动机：变更详情沉淀资产卡的决策蒸馏弹窗定位不准——decisions/unmapped.md 等聚合文件里多个变更各有同名决策号（如三个变更各有 D-003@v1），单靠「文件#决策号」锚会命中文件里第一个同号卡片；定位锚必须用「变更号+决策号」复合形态才能唯一匹配。
成功标准：
- 决策/FR 结构化条目卡在带「变更：」字段时输出 data-entry-anchor-qualified=文件#变更号#决策号（既有 data-entry-anchor 裸锚保留不破坏旧深链）
- 沉淀资产卡弹窗定位优先按复合锚精确匹配，查无再退裸锚（FR/决策/触达/手册各形态均不回退）
- 沉淀资产卡 FR/决策行的知识库深链 anchor 参数带变更号前缀，知识库页深链滚动对含 # 的 anchor 先试复合锚再退裸锚
- 知识触达行与手册/INDEX 锚点行为不变
- 相关组件测试同步更新并通过（entry-card-list / change-assets-card / knowledge-page）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 决策/FR 结构化条目卡在带「变更：」字段时输出 data-entry-anchor-qualified=文件#变更号#决策号（既有 data-entry-anchor 裸锚保留不破坏旧深链）
2. 沉淀资产卡弹窗定位优先按复合锚精确匹配，查无再退裸锚（FR/决策/触达/手册各形态均不回退）
3. 沉淀资产卡 FR/决策行的知识库深链 anchor 参数带变更号前缀，知识库页深链滚动对含 # 的 anchor 先试复合锚再退裸锚
4. 知识触达行与手册/INDEX 锚点行为不变
5. 相关组件测试同步更新并通过（entry-card-list / change-assets-card / knowledge-page）

## 成功标准（可验证）

1. 决策/FR 结构化条目卡在带「变更：」字段时输出 data-entry-anchor-qualified=文件#变更号#决策号（既有 data-entry-anchor 裸锚保留不破坏旧深链）
2. 沉淀资产卡弹窗定位优先按复合锚精确匹配，查无再退裸锚（FR/决策/触达/手册各形态均不回退）
3. 沉淀资产卡 FR/决策行的知识库深链 anchor 参数带变更号前缀，知识库页深链滚动对含 # 的 anchor 先试复合锚再退裸锚
4. 知识触达行与手册/INDEX 锚点行为不变
5. 相关组件测试同步更新并通过（entry-card-list / change-assets-card / knowledge-page）
