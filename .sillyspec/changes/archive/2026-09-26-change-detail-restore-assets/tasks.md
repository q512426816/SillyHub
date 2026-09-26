---
author: flow-machine-draft
created_at: 2026-09-26T05:54:31.129Z
---
# 任务注册表（Tasks）— 2026-09-26-change-detail-restore-assets

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> 覆写说明：原 task-04/task-05 为摘录括号切分碎片，按实际实现路径合并为 task-04（测试面）+ task-05（钉子测试）。

- [x] task-01: 变更详情页 aside 末尾重新挂载 ChangeAssetsCard（import + 挂载注释，对齐 a7eca0727；注释中范式引用由已退役的 ChangeEventsCard 更新为现行 ChangeObservationEventsCard），304eba982 的观测事件卡保留不动
- [x] task-02: STATUS_BADGE 恢复四态（quick 快速任务（存量）/ thin 轻量变更 / blocked / archived）与 01a9dfcbd 注释口径
- [x] task-03: ScopeAuditCommandCard 调用处恢复 archived={isTerminalChange(change)} 传参与 9cb48847d 指路注释（组件侧 prop 未动）
- [x] task-04: 聚焦测试全绿——详情页 __tests__ 3 文件 22 用例 + change-assets-card 10 用例 + scope-audit-command-card 14 用例 = 46 passed；tsc --noEmit exit 0
- [x] task-05: 新增页面级钉子测试 page-restore-assets.test.tsx（4 用例：thin 徽章精确文本 / 资产卡与观测事件卡并存挂载 / archived 非终态 false / 终态 true），防挂载再次被夹带提交静默删除
