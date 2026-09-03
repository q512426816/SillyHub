---
author: qinyi
created_at: 2026-09-02 21:26:25
---

# 提案书（Proposal）

## 动机

SillySpec 进度库（P0-1 交付 `progress show --json`）已能输出全局健康数据——活跃 change、ghost 残留、未决同步冲突——但**没有任何面板出口**：这些红灯只活在 CLI 输出里，没人主动跑就没人看见（实测 2026-09-02：ghost 持续产生至 17 个、11 条冲突挂账 08-20~08-30 无人处理）。管理员在跨 Agent 协作改进讨论中拍板（B' 方向）：把这份通用数据（任何接入平台的 sillyspec 仓天然拥有）亮到 SillyHub 工作台。

## 关键问题

1. **红灯不可见**：ghost 残留与未决冲突是 progress 库特有维度，变更中心页（spec 同步树数据源）没有这两个字段；人类可读 `progress show` 总览也不显示非活跃变更的冲突（P2-2 盲区，sillyspecer 已确认）——双重盲区。
2. **运维滞后**：ghost 在持续产生（实测 1 小时内 15→17），没有常态化监控位就只能靠人工想起跑 doctor。
3. **跨仓无总览**：多 workspace 接入后，每仓的 SillySpec 健康状况没有聚合视图；现有变更中心是单仓内页，做不到「不进 workspace 就看见」。

## 变更范围

- daemon：周期采集 `progress show --json`（三态降级矩阵），心跳载荷追加 `sillyspec_status` 摘要（32KB 预算 + 截断降级）。
- backend：Machine 表新增 JSON 列（None=清除语义，对齐 sillyspec_update 先例）+ 迁移 + 心跳落库 + 机器视图透出。
- frontend：工作台概览页新增「活跃变更总览」SectionCard（健康条/变更行/ghost 折叠/冲突区/过滤），`pnpm gen:types` 同步。

## 不在范围内（显式清单）

- 不做 `docs/sillyspec/` 工单目录状态化（原 P1-2 案已废弃，管理员拍板）
- 不做写操作（resolve 冲突 / 清理 ghost 留在 CLI，卡片只读 + 指引）
- 不做 @ 认领人推送（envelope 无 owner 字段，YAGNI，后续增量）
- 不做 SillySpec CLI 发版/升级链（sillyspecer 侧另线；联调走源码直连）
- 不做仓级路由协议（FR-C 按机器维度分组务实化）

## 成功标准（可验证）

- 工作台卡片数据与同刻 CLI 直连 `progress show --json` 一致（不断言动态计数）
- ghost 折叠组、冲突区、需关注过滤在真实数据下正确渲染；null 占位态（sillyspec 未装/版本低）与数据过期标记（瞬态失败保留快照）可见
- 既有心跳消费者（ws_hub/机器卡）不受新增载荷字段影响（回归用例覆盖）
- 后端新测试 + 前端组件测试全绿；api-types.ts 为生成产物非手写
