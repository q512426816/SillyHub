---
author: flow-machine-draft
created_at: 2026-09-28T14:40:31.961Z
---
# 提案书（Proposal）— 2026-09-28-change-detail-header-overflow

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:c7e5fa8aa904fd96186e4acf64ca93f39b436790595da0dbbbba2afc2d91c48e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-detail-header-overflow 留痕重锚 -->
任务原话转写：变更详情页头部 PageHeader 左侧 flex 项无 min-w-0，长描述（nowrap min-content）把头部 div 撑到 1861px、页面出横向滚动条，生产实测 scrollWidth 2219>1600；列表行同类问题 2026-09-28 已修但详情页头部链路漏了。
成功标准：
- PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破头部宽度
- 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth 等于视口宽（无横向滚动）
- 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）
- 相关前端测试与 tsc 通过
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:783e942169b7b53fe468f33f2a3c2b19556307edecdb695a3823138bb13fd591:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-detail-header-overflow 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破头部宽度
2. 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth 等于视口宽（无横向滚动）
3. 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）
4. 相关前端测试与 tsc 通过
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:4701ac032193c343a19437371cfad10e286ba0fd5b0a3b823f6e09a25b4bc4d5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-change-detail-header-overflow 留痕重锚 -->
1. PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破头部宽度
2. 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth 等于视口宽（无横向滚动）
3. 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）
4. 相关前端测试与 tsc 通过
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
