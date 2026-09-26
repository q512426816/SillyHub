---
author: flow-machine-draft
created_at: 2026-09-26T13:39:44.511Z
---
# 提案书（Proposal）— 2026-09-26-thin-badge-survives-archive

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:03a9dd3f341b7388f96848844dfc61b66403eac1a5e2c1cbf90fc54c5cd9b9b5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-thin-badge-survives-archive 留痕重锚 -->
任务原话转写：动机:thin-flow 设计「归档时自动翻转」让轻量变更归档后徽章只剩「已归档」,出身标识随归档消失——用户在归档变更上看不到轻量变更标签,今天全部收口的变更均如此,透明度受损。

成功标准:
- 已归档变更若为轻量出身则标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
- 出身判定:current_stage 为 archived 或 location 为 archive,且 change_type 为 quick,且 created_at 不早于 2026-09-25(thin 写入分流上线日,此前 quick 为存量通道非轻量出身)
- 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归
- 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归;frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:c76173771e21cb3824ead0cf2e4672870f2ca155fa54003c730beca40ffbeeb6:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-thin-badge-survives-archive 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 已归档变更若为轻量出身则标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
2. 出身判定:current_stage 为 archived 或 location 为 archive,且 change_type 为 quick,且 created_at 不早于 2026-09-25(thin 写入分流上线日,此前 quick 为存量通道非轻量出身)
3. 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归
4. 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归
5. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:46f62093c3423f6477ef81eb8d9baac269f5f1d4bcdbb5d7825dc14fef215d19:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-thin-badge-survives-archive 留痕重锚 -->
1. 已归档变更若为轻量出身则标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
2. 出身判定:current_stage 为 archived 或 location 为 archive,且 change_type 为 quick,且 created_at 不早于 2026-09-25(thin 写入分流上线日,此前 quick 为存量通道非轻量出身)
3. 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归
4. 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归
5. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
