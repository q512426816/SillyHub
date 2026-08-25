---
author: qinyi
created_at: 2026-08-26 02:45:00
---

# 决策记录（Decisions）— 团队分身递归开闸 P2

## D-001@v1 — 最大树深 3 层

- **status**: accepted（用户弹窗未作答，按持续授权推荐默认记录）
- **question**: 递归开到多深？
- **decision**: 总深 3（主控 0/分身 1/孙 2），MAX_DISPATCH_DEPTH=2（孙为叶）。
  常量可调；4 层治理/成本/测试矩阵翻倍暂不开。

## D-002@v1 — 分身工具集=派工集+收敛收口

- **status**: accepted（同上默认；用户原意"会话全部功能"的治理收敛）
- **decision**: 非叶五件（dispatch_worker/list_workers/get_worker_result/
  mission_status/worker_done）；converge_mission 与 report_progress 主控独有
  （层 0 权不下放）；叶仅 worker_done。全工具下放方案否决（任何分身可收敛
  整棵树，层 0 收口形同虚设）。

## D-003@v2 — 深度承载=tree_depth 列 + lease metadata 双源

- **status**: accepted
- **supersedes**: D-003@v1（P1：受限 server 仅 worker_done 单工具）
- **question**: 递归深度怎么承载与治理？
- **options**: A) tree_depth 列 + worker_depth metadata 双源各司其职
  （DB 治理门 O(1)/daemon 工具集分层）**selected**；B) stage 编码深度
  （自由协议易碎）；C) 运行时爬链（daemon 拿不到，否决）。
- **impacts**: 迁移 NOT NULL DEFAULT 0 + 全表回填（Grill B1）；snapshot
  持久化 worker_depth 保档（M3）；旧 lease 无键按叶档兜底。

## D-004@v1 — 五端点统一调用方解析规则

- **status**: accepted（Grill B2 修正产物）
- **decision**: parent 非空 → 爬根定位 mission 禁懒建（miss=404）；parent
  NULL → 保留 P1 懒建。适用 dispatch/list/get_result/status/worker_done。

## D-005@v1 — 预算强收=mission 标记 + 虚拟映射增补

- **status**: accepted（Grill M2 修正产物）
- **decision**: patrol 触顶置 constraints.budget_force_ended_at + 批量收口；
  映射规则「标记存在时 ended 未 done → failed」保证强收后可收敛（degraded）。

## D-006@v1 — 闸拒绝收口置 failed + 从未 ready 触发面

- **status**: accepted（Grill M1-R 终版）
- **decision**: 会话闸拒绝的收口置 status='failed'（对齐 P1
  _fail_worker_subsession），触发面「首 run failed 且从未 ready」——
  防误杀追问轮中途失败的存活分身（turn 失败≠会话死亡，P1 原则）。

## D-007@v1 — converge 收口按鉴权通道判别

- **status**: accepted（Grill minor 修正）
- **decision**: 层 0 守卫按通道嗅探（Bearer 豁免/X-Session-Id 会话判深度/
  apiKey 无会话上下文一律 403），勿按用户角色实现（mcp_tools.py:897-899 先例）。
