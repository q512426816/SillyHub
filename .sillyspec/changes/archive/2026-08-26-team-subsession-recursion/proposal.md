---
author: qinyi
created_at: 2026-08-26 02:45:00
---

# 提案书（Proposal）— 团队分身递归开闸 P2（会话树深度治理）

## 动机

用户原始愿景"子会话还能开子会话"。P1 地基已就位（会话树/完成信号/收口/
判据单一真相源）但递归闸关闭（分身仅 worker_done 单工具）。P2 按路线图开闸，
并配套双子代理风险调研结论的四项治理（深度上限/converge 层 0 收口/预算树
聚合/daemon 会话总数上限），杜绝"开了闸收不住"。

## 关键问题

1. 递归深度无承载（daemon 侧拿不到树深度，工具集无法分层）。
2. 分身调用派发端点会触发懒建误锚新 mission（P1 已知坑，需统一解析规则）。
3. converge 权未收口（任何 apiKey 身份可收敛任意 mission）。
4. 预算只在派发时刻检查，运行中会话烧钱无强收；daemon 无会话总数闸。

## 变更范围

- backend：tree_depth 列（NOT NULL DEFAULT 0 + 全表回填）+ 全树递归 CTE 枚举；
  五端点统一调用方解析（爬根禁懒建）；深度门 400 + converge 层 0 收口 403；
  全树治理口径迁移（七处换点）；patrol 预算强收（budget_force_ended_at 标记
  + 虚拟映射增补）；run_sync「首 run failed + 从未 ready → 子会话 failed」
  收口规则；worker_depth 写 lease metadata。
- sillyhub-daemon：受限 server 两档工具集（非叶 5 件/叶 1 件，depth 分层）；
  worker_depth 全程透传 + snapshot 保档；SessionManager 会话总数闸（env
  默认 20）。
- 测试：深度门/层 0 收口/全树枚举/预算强收/会话闸/分层注入。

## 非目标（Non-Goals）

- 不改 P1 收口链与判据函数语义（只扩枚举范围）。
- 不做 UI（门户分组/按需开流留 P3）。
- 不做跨 mission 聚合/组织级配额。
- 递归派发不支持 caller worktree 透传（孙层一律自建副本）。

## 风险

| 风险 | 应对 |
|---|---|
| 递归风暴 | 双保险深度闸 + MAX_WORKERS 全树计数 + 预算强收 |
| 闸拒绝后卡死 | 收口置 failed + 从未 ready 触发面收窄（M1-R） |
| 重启档位丢失 | snapshot 持久化 worker_depth（P0-1 修复链路复用） |
| 存量 depth=1 分身自动获得派工能力 | 显式确认预期（未上线，规则 11） |

## 实现路径

scale=large → `sillyspec run plan --change 2026-08-26-team-subsession-recursion`
