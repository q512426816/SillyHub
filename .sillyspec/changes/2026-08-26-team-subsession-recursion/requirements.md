---
author: qinyi
created_at: 2026-08-26 02:45:00
---

# 需求文档（Requirements）— 团队分身递归开闸 P2

## FR-01 深度模型

`agent_sessions.tree_depth int NOT NULL DEFAULT 0`（迁移全表 CASE 回填：
parent NULL→0/非空→1）；派发时 parent+1 落库；递归 CTE 全树枚举
`mission_worker_sessions_tree`（UNION 去重 + MAX_TREE_DEPTH=4 截断）。

**验收**：迁移后无 NULL；全树枚举含孙层不含环重复；治理门 O(1) 读深度。

## FR-02 递归派发与深度门

五端点统一调用方解析（parent 非空→爬根禁懒建 miss=404；parent NULL→保留
P1 懒建）；新子会话 parent=调用会话 + depth+1；调用方 depth+1 > 2 → 400
中文；分身调用的 payload.worktree_path 一律忽略。

**验收**：分身可派孙（parent 挂分身、depth=2）；孙调 dispatch 400 零写入；
分身调只读工具正常（不 404）。

## FR-03 converge 层 0 收口

`_converge_core` 调用方守卫：会话调用方 depth>0 → 403；JWT（Bearer）豁免；
apiKey header-less（无 Bearer 无 X-Session-Id）→ 403（通道嗅探判别）。

**验收**：分身调 converge 403；主控正常；用户 JWT 正常；apiKey 裸调 403。

## FR-04 daemon 分层工具集（D-003@v2）

lease metadata.worker_depth 全程透传（placement→context.py 白名单→daemon.ts
归一化→SessionManager）+ snapshot 持久化（restore 保档）；非叶（depth<2）
注册 dispatch_worker/list_workers/get_worker_result/mission_status/worker_done
五件，叶仅 worker_done；converge/report_progress 永不注册；旧 lease 无键按叶档。

**验收**：非叶分身工具列表恰 5 件；叶恰 1 件；重启后档位保持；旧 lease 叶档。

## FR-05 预算强收

patrol 职责⑥：活跃 mission cost_so_far≥budget_usd 且有未完成分身 → 原子置位
constraints.budget_force_ended_at + 复用 P1 收口链批量 end_session；虚拟映射
增补：标记存在时 ended 未 done → failed（可收敛 degraded）；计数键
budget_force_ended。

**验收**：触顶后未完成分身被收口；mission 可收敛出 degraded；未触顶不误收。

## FR-06 daemon 会话总数闸

SessionManager.create 前置计数 ≥ SILLYHUB_MAX_ACTIVE_SESSIONS（默认 20，0=
不限）→ 拒绝；backend run_sync 规则：首 run failed 且会话从未 ready 且
parent 非空 → 子会话置 failed+ended_at（可收敛，不误杀追问轮失败）。

**验收**：超限创建被拒且子会话 failed 终态；mission 不卡死；restore 不受限。

## FR-07 全树治理口径

七处换点（derive/complete 集合、control 三口径、cleanup/收口遍历、patrol
枚举、_worker_done_core、_converge_core busy、workers_all_terminal_with_stats）
全部换全树枚举。

**验收**：孙层计入 MAX_WORKERS/成本/kill 名单；孙 worker_done 可用；全分身
（含孙）完成才迁移唤醒。

## FR-08 存量兼容

存量 depth 回填后：既有 mission 行为零变化（一层结构与全树枚举在无孙时
等价）；非叶分身（depth=1）获得派工能力为显式预期。

**验收**：无孙存量 mission 全量回归零失败。
