---
author: qinyi
created_at: 2026-08-21T17:10:00
change: 2026-08-21-session-message-queue
---

# 模块影响分析（Module Impact）— 会话消息排队 + 组件统一

> 归档终审版（以 git diff 61a1b709 实际 8 文件为准，修正 plan 期初版两处偏差）。

## 影响的模块

| 模块（frontend _module-map） | 影响类型 | 文件 | 说明 |
|---|---|---|---|
| components-daemon | 新增 + 逻辑变更 | message-queue-bar.tsx（新）、session-panel.tsx（新 2636 行）、interactive-session-panel.tsx（1312→127 适配层）、__tests__/interactive-session-panel.test.tsx（4 断言按 D-001/D-003 更新）、__tests__/message-queue-bar.test.tsx（新） | 共享 SessionPanel 双模式 + 排队可视化；ISP 导出面零变更 |
| app-sessions-pages | 逻辑变更（结构重构） | app/(dashboard)/sessions/page.tsx（1473→117 行外壳化） | 页内面板提取为共享组件，行为零回归 |
| （未映射）src/hooks/ | 新增目录 | use-message-queue.ts + __tests__/use-message-queue.test.ts | 仓库首个 src/hooks 文件；sync-module-docs 步在 frontend _module-map 登记（建议挂 components-daemon depends_on 或独立 hooks 微模块） |

## 与 plan 期初版的偏差修正

1. **runtimes/page.tsx 实际零改动**——plan 曾预估替换该页 import；实际链路为 page → RuntimeSessionDialog → InteractiveSessionPanel（适配层），替换发生在面板层，页面自动获得新实现（symbol-impact/symbol 备案）。
2. **interactive-session-panel.tsx 未删除**——design 文件清单「删除」降级为 127 行适配层（4 个范围外消费方存在，D-005 策略第 3 步）。

## 无影响的模块

- backend/（零改动，NFR-01：inject 守卫不动，前端负责时序）
- sillyhub-daemon/（零改动）
- 其他 frontend 模块（workspace-session-section / change-session-section / runtime-session-dialog / runtime-session-helpers 经适配层零改动获得新实现，源码与测试均未触碰，全量回归 1866 用例佐证）
