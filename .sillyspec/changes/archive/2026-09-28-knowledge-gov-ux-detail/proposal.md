---
author: flow-machine-draft
created_at: 2026-09-28T08:46:09.450Z
---
# 提案书（Proposal）— 2026-09-28-knowledge-gov-ux-detail

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:75764110c09bb858c491f06bec8ac20e37541fcc7b65689124723e1fb726f3af:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux-detail 留痕重锚 -->
任务原话转写：治理信号卡二轮（用户实测反馈）：①rot/收件箱两卡没有处理入口；②未归位/路径失效看不到具体条目，得先看到才能处置。
- 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncategorized.md，复用页面既有深链消费能力，同页软导航）
- rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失败降级为内联展示提示词文本）
- binding-unresolved 卡正文补明细（锚点 id 列表）
- 伪域未知池（如 auto-round5）也给查看链接

成功标准：
- 四类卡都能看到具体数据入口（深链到本页对应知识文件）
- rot/inbox 有一键复制处理指令入口（复制成功有反馈；clipboard 不可用时内联显示可手动复制）
- 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
- 既有测试同步更新全绿，tsc/eslint 0 错
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:38a91f6ce6ca00f7861e8e99cbd560111917db0c0ba36accb8c11c1773050bb7:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux-detail 留痕重锚 -->
按成功标准机械推导，共 11 条验收面：
1. 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncategorized.md，复用页面既有深链消费能力，同页软导航）
2. rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失败降级为内联展示提示词文本）
3. binding-unresolved 卡正文补明细（锚点 id 列表）
4. 伪域未知池（如 auto-round5）也给查看链接
5. 四类卡都能看到具体数据入口（深链到本页对应知识文件）
6. rot
7. inbox 有一键复制处理指令入口（复制成功有反馈
8. clipboard 不可用时内联显示可手动复制）
9. 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
10. 既有测试同步更新全绿，tsc
11. eslint 0 错
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:b7f30fe27ac1975f6792b9add23b823343de3d606a7cc8c369a11921b35fff4a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-gov-ux-detail 留痕重锚 -->
1. 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncategorized.md，复用页面既有深链消费能力，同页软导航）
2. rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失败降级为内联展示提示词文本）
3. binding-unresolved 卡正文补明细（锚点 id 列表）
4. 伪域未知池（如 auto-round5）也给查看链接
5. 四类卡都能看到具体数据入口（深链到本页对应知识文件）
6. rot
7. inbox 有一键复制处理指令入口（复制成功有反馈
8. clipboard 不可用时内联显示可手动复制）
9. 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
10. 既有测试同步更新全绿，tsc
11. eslint 0 错
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
