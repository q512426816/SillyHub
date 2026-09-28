---
author: flow-machine-draft
created_at: 2026-09-28T14:02:06.341Z
---
# 提案书（Proposal）— 2026-09-28-remove-liveness-overview-card

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:4447b2f45a6a35e548efde2d4c894dab71a52b2538073042158f5273630c2582:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-remove-liveness-overview-card 留痕重锚 -->
任务原话转写：Agent 状态总览卡数据链路（daemon liveness 上报）在真实部署从未建立：本机库 724/725 行 state NULL（唯一非 NULL 是 manual_test 手工测试行），daemon 连远程服务器且各 workspace local.yaml 无 platform token 导致上报空转，卡片永远只显示「未知（100）」无信息量且误导，用户裁决去掉。

成功标准：
- 工作区详情页不再渲染 Agent 状态总览卡片
- agent-liveness-overview-card.tsx 组件文件删除且无残留 import
- page.test.tsx 清理对应 mock 后工作区详情页测试通过
- 会话列表活性链路（use-session-liveness / liveness-badge）不受影响
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:f6aebb2c82fb1ed3c16cde1821adb2c8ab2566772c13662671382820d8df35ca:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-remove-liveness-overview-card 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. 工作区详情页不再渲染 Agent 状态总览卡片
2. agent-liveness-overview-card.tsx 组件文件删除且无残留 import
3. page.test.tsx 清理对应 mock 后工作区详情页测试通过
4. 会话列表活性链路（use-session-liveness / liveness-badge）不受影响
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:c6a59ebcef81d7d81ed4283e0ddfee1c0b5915b030786e4f59126169f9e9b86b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-remove-liveness-overview-card 留痕重锚 -->
1. 工作区详情页不再渲染 Agent 状态总览卡片
2. agent-liveness-overview-card.tsx 组件文件删除且无残留 import
3. page.test.tsx 清理对应 mock 后工作区详情页测试通过
4. 会话列表活性链路（use-session-liveness / liveness-badge）不受影响
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
