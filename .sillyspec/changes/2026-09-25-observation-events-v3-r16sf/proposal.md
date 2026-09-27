---
author: qinyi
created_at: 2026-09-24 16:16:00
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
观测事件通道（v2，2026-09-23-change-events-channel）已承载 CLI watcher 旁路批量上行与前端只读展示，但五处缺口影响观测质量与消费安全：批量上限偏小、增量游标基于业务 ts 会永久丢失乱序晚到事件、无截断标记、detail 截断过紧、前端无告警级一次决策。本变更（v3）按任务书在**原地**演进该服务，全部新语义挂单一功能开关、缺省关闭。

## 关键问题
1. **游标丢事件**：`since` 基于事件业务 ts——业务 ts 乱序到达时，晚到的早 ts 事件落在游标左侧被永久跳过，增量消费方永远看不到它；
2. **截断不可知**：读缺省 500 条无 truncated 标记，调用方无从判断是否被 limit 截断；detail 落库截 2000 字符，观测明细损失大；
3. **告警决策粒度粗**：前端仅有卡片级首轮自动展开，同一告警在轮询重拉后反复干扰，用户手动收起的意愿不被记忆。

## 变更范围
- 后端（platform_sync + settings）：写入批量上限 500（关态 200 拒收不变）、幂等去重复合键不变、窗口 5000 按接收序剪枝（并发超删容忍）、`since` 语义改 received_at（created_at）、读缺省最近 2000 条 + truncated 标记、detail 上限 64KB（65536 字符，service 落库截断）、detail 列 Text 无损加宽迁移、平台设置 KV 开关（缺省关）+ 管理端点；
- 前端：30s 轮询全量重拉（不做增量游标）、探测式两段拉取（首轮 200 → v3 标志确认后 2000）、告警条（severity∈{warning,error}）自动展开每告警只决策一次（sessionStorage 按 id 记忆）、truncated 提示；
- 测试与文档：关态零回归（既有测试零改动全绿）+ 开态测试矩阵 + 模块文档/changelog 同步。

## 不在范围内（显式清单）
- 不做前端增量游标（任务书明确排除）
- 不触发通知/审批/门禁（沿 FR-lib-changes-022 红线：provisional 只展示不消费）
- 不改 sillyspec CLI watcher（仓外组件，其 ≤200 批推送在两态下均合法）
- 不新增表/端点组/常驻任务（D-001/D-009 裁决原地演进）
- 不做告警决策记忆后端持久化（仅前端 sessionStorage 会话语义）
- 不删除 v2 代码分支（退役另立决策）

## 成功标准（可验证）
- 未配置开关时既有行为不变：既有 `backend/app/modules/platform_sync/tests/test_change_events.py` 零改动全绿，关态响应 JSON 与 v2 逐字节一致（新字段经 exclude_none 不出现）
- 配置开关后新语义可用：批 500 / 接收序剪枝 / since=received_at / 缺省 2000+truncated / detail 64KB / 告警条一次决策，全部有开态测试覆盖
- 回退路径：开关置关即时生效，零迁移零数据损失（v3 期间写入行在 v2 读路径完全可读）
- spec 文本、design、实现三层对「缺省 2000 条窗口、64KB 上限在 service 落库层」逐字对齐
