---
author: qinyi
created_at: 2026-10-22 11:36:51
generated_by: sillyspec-fourpiece-init
---
# 任务注册表（Tasks）— 2026-10-22-trajectory-view-redesign

> 初稿，plan 阶段按 Wave/依赖细化后为准。

- [x] task-01: 新增 `trajectory-view-model.ts`：轮次分组、轮次/调用折叠集合、搜索过滤（AND 分词、大小写不敏感）、折叠摘要统计；同时按 D-015 补 `from-turn-views.ts` 工具行 raw/result 映射与行 id 稳定性；验证：`trajectory-view-model.test.ts` 与 `from-turn-views.test.ts` 全绿
- [ ] task-02: 新增 `trajectory-toolbar.tsx`：时长开关（含 `sillyhub.trajectory.scaleMode` 持久化）、轮次/调用折叠菜单、搜索输入；验证：组件渲染与回调用例
- [ ] task-03: 新增 `trajectory-ledger.tsx`：两列行结构、轮次标签/竖线（按 D-019 不渲染请求点）、类型标签与摘要、结果摘要、子工具缩进、折叠摘要行；验证：渲染用例与快照断言
- [ ] task-04: 新增 `trajectory-detail-panel.tsx`：工具行四标签、其它行概述+原始内容、JSON 美化/复制、计时指标、可调宽与窄屏抽屉、空选中不渲染；验证：标签切换与空态用例
- [ ] task-05: `trajectory-timeline.tsx` 增加 `scaleMode` prop（duration/equal）；按 D-017 裁剪说明行/图例/覆盖率/重置并固定约 50px；按 D-016 在 equal 下禁用缩放/平移/刷子/轴刻度且不拦截滚轮；验证：两种模式布局与手势用例、`trajectory-timeline.test.tsx` 适配
- [ ] task-06: 重写 `trajectory-view.tsx` 为装配层（组合工具栏/时间线/账本/详情，持有折叠/搜索/选中状态）；验证：集成用例
- [ ] task-07: `turn-timeline.tsx` 宿主接线——`showTrajectory` 分支移出 `turn-timeline-scroll` 与滚动容器并列、`TrajectoryPane` 补 `h-full min-h-0`；轨迹下 pending AskUser 卡置于轨迹顶部固定层，回底按钮/贴底跟随/滚动监听不生效；验证：在会话面板内滚动账本时工具栏/时间线不动，pending 卡可见可作答
- [ ] task-08: 迁移 `turn-timeline-trajectory-view.test.tsx` 既有断言到新结构，补充折叠/搜索/详情交互用例；验证：相关测试全绿、既有断言不放宽
- [ ] task-09: 重编译原型（`pnpm prototype:build`）并登记 `prototype-trajectory-redesign.html`，核对与实现一致；验证：产物与源码对账
- [ ] task-10: `frontend` 跑 `pnpm exec tsc --noEmit` 与相关 vitest；验证：退出 0、零失败
