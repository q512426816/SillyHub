---
author: flow-machine-draft
created_at: 2026-09-28T01:46:04.843Z
---
# 提案书（Proposal）— 2026-09-28-turn-nav-hover-flyout

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:0b5aa97d7e325ab9264adcdd3b9b255c093c73a245f80599389b472ffe2474c4:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-hover-flyout 留痕重锚 -->
任务原话转写：轮次导航列形态再调整：220px 常驻行式列太占地方。

动机：用户实测后反馈左侧轮次导航列占地方；此前 30px 刻度轨被嫌命中区小看不见轮号，220px 行式列信息全但常驻太宽。选定折中方案：窄轨+悬停展开。

成功标准：
- 默认 44px 窄轨：紧凑刻度+当前轮位置指示+顶部当前轮号，aria-label 保留（第N轮可达性）
- 悬停滑出完整行式列表浮层（覆盖聊天区不挤压布局，~260px），移开延迟收起；点击窄轨可 pin 锁定，点外部收起；触屏 hover:none 时点按展开收起
- 浮层内保留全部既有功能：轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转（含未加载轮 run_id 直达）
- 既有测试改断言不改意图全绿，tsc/eslint 零新增，主题 token 零硬编码
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:90b2c8a8e4861cc4552cbc5292854564b6bc1d4bbe80fc6175eb6b7458405616:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-hover-flyout 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. 默认 44px 窄轨：紧凑刻度+当前轮位置指示+顶部当前轮号，aria-label 保留（第N轮可达性）
2. 悬停滑出完整行式列表浮层（覆盖聊天区不挤压布局，~260px），移开延迟收起
3. 点击窄轨可 pin 锁定，点外部收起
4. 触屏 hover:none 时点按展开收起
5. 浮层内保留全部既有功能：轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转（含未加载轮 run_id 直达）
6. 既有测试改断言不改意图全绿，tsc
7. eslint 零新增，主题 token 零硬编码
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:ab2a8a901015dbb9d539d23ddd7c30ef0f12b074b273a035a4439baf77b200c2:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-hover-flyout 留痕重锚 -->
1. 默认 44px 窄轨：紧凑刻度+当前轮位置指示+顶部当前轮号，aria-label 保留（第N轮可达性）
2. 悬停滑出完整行式列表浮层（覆盖聊天区不挤压布局，~260px），移开延迟收起
3. 点击窄轨可 pin 锁定，点外部收起
4. 触屏 hover:none 时点按展开收起
5. 浮层内保留全部既有功能：轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转（含未加载轮 run_id 直达）
6. 既有测试改断言不改意图全绿，tsc
7. eslint 零新增，主题 token 零硬编码
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
