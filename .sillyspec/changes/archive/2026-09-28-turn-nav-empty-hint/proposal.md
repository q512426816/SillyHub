---
author: flow-machine-draft
created_at: 2026-09-28T02:37:49.046Z
---
# 提案书（Proposal）— 2026-09-28-turn-nav-empty-hint

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:14c801f7c8d0a0d1273d17ba60a4a8ff189011206560c3431469bcf1131126bb:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-empty-hint 留痕重锚 -->
任务原话转写：轮次导航无摘要轮的占位文案语义修正。

动机：用户看到导航列「未加载 — 点击加载该轮并定位」占位误以为轮次信息没加载。实证（生产 46 轮群聊会话）：14 轮 prompt/answer 摘要均为空——这些 run 只有 1 条空 content 的 user_input 日志（群聊轮用户正文在群消息表，agent 日志留空记录），大纲如实返回空摘要；但占位文案说「未加载」是错误语义（轮次状态/时间已在大纲中），指令文案「点击加载该轮并定位」也多余（点击是导航列普遍行为）。

成功标准：
- 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载/点击加载」误导文案
- 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）
- 桌面窄轨/浮层行与 mobile Drawer 的同源占位文案一并修正
- 相关测试改断言不改意图全绿，tsc/eslint 零新增
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:64e7dab729f3b6f3190a4a43b37e8a1282fa3dc3709a8ba805f5f07f7fdf3e09:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-empty-hint 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载
2. 点击加载」误导文案
3. 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）
4. 桌面窄轨
5. 浮层行与 mobile Drawer 的同源占位文案一并修正
6. 相关测试改断言不改意图全绿，tsc
7. eslint 零新增
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:1b3641ce3711c540d4394e30e9e8162d14a30f3909ae083c5af771fd4bbff285:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-empty-hint 留痕重锚 -->
1. 无摘要轮显示中性占位「（无内容记录）」（muted 样式），不再出现「未加载
2. 点击加载」误导文案
3. 「未加载」状态语义保留在 aria-label（读屏可辨）与视觉（未加载行 muted 降调不变）
4. 桌面窄轨
5. 浮层行与 mobile Drawer 的同源占位文案一并修正
6. 相关测试改断言不改意图全绿，tsc
7. eslint 零新增
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
