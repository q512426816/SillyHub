---
author: qinyi
created_at: 2026-08-20T11:05:00+08:00
---

# 模块影响分析（Module Impact）— 前端 AI-Native 视觉重构 + 蓝紫可切换主题

依据：design.md §6 文件变更清单 + plan.md 任务列表，对照 `_module-map.yaml` 模块路径映射。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend | 修改 | 样式层重构（唯一受影响模块）：新增 `styles/themes.ts`（主题注册表）+ `stores/theme.ts`（zustand persist）+ `components/theme-toggle.tsx`；删除 `styles/tokens.ts`（9 处消费方迁移）；修改 `globals.css`（双套 CSS 变量+brand 阶）、`tailwind.config.ts`（brand 语义阶）、`antd-providers.tsx`（动态主题）、`app/layout.tsx`（防闪烁脚本）、`top-bar.tsx`（切换钮）、登录页、会话页 turn-timeline/turn-status-bar（AI 细节）；清扫 56 文件 blue-* 类名 + 9 文件 message→useNotify + 5 个测试断言文件。BFF route/API 调用/数据层零改动 |
| backend | 无影响 | 零文件变更；前端不改任何 API 契约（`pnpm gen:types` 不触发） |
| sillyhub-daemon | 无影响 | 零文件变更；SSE 数据流与协议不动（D-004@v1 仅前端表现层） |
| docs | 修改 | `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md` §7 info 档说明更新（task-15）；本次评审原型 `docs/ui-redesign-ai-native-prototype-2026-08-20.html` 作对照基线（只读） |

## 未匹配文件

无（design §6 清单全部落在 frontend 模块 path `frontend/` 下，docs 侧两文件属 docs 模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend.md` | 更新 frontend 模块卡（主题系统：themes.ts 注册表/store/切换入口/brand 阶；tokens.ts 移除） | pending（task-15 文档同步时更新） |
| `modules/docs.md` | 无需更新（FRONTEND_PAGE_STYLE.md 属 scan 文档非模块卡） | n/a |
