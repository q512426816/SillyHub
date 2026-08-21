---
author: qinyi
created_at: 2026-08-20T23:35:00
scale: large
source_change: 2026-08-20-workspace-nav-consolidate
---

# 设计文档（Design）— 工作区导航整合（宫格并入顶部菜单）

> 背景：概览页"快速入口宫格"6 项与顶部 WorkspaceTabs 菜单重复（用户反馈"跳转按钮重复了"）；且 components/changes 两页因历史 standalone 分支无顶部菜单（用户反馈"跳过去的子页面部分没有顶部菜单"）。用户确认方案：删宫格统一走顶部菜单，菜单扩全+左右滑动，standalone 恢复统一。

## 1. 背景

- 概览页 QuickEntryGrid 6 入口（项目组件/变更中心/扫描文档/运行时/智能体档案/方案文件）与 WorkspaceTabs 9 项中的组件/变更重复，且扫描文档/运行时/智能体档案/方案文件 4 页不在菜单里——入口分裂。
- layout.tsx isStandalone 分支（ql-20260707-004 历史决策）使 components/changes 两页脱离 workspace layout，无 WorkspaceTabs。
- 菜单扩到 13 项后 1440px 容器放不下，需左右滑动。

## 2. 设计目标

1. 跳转入口唯一化：概览页删宫格，全部子页面入口由顶部菜单承担。
2. 菜单全量 13 项 + 超长左右滑动（overflow-x-auto，滚动条隐藏）。
3. components/changes 恢复顶部菜单（去 standalone）。
4. 行为零变更：各页路由/数据流不动。

## 3. 非目标

- ❌ 不动 7 个更深层子页（audit/approvals 等）是否入菜单——本次只并入宫格已有的 4 项（用户清单口径）
- ❌ 不改各子页内部布局
- ❌ 不做菜单分组/下拉收纳（13 项平铺滑动，用户指定）

## 4. 拆分判断

单一小变更（迭代修复），5 文件，单 Wave 顺序执行。

## 5. 总体方案

| # | 项 | 方案 |
|---|---|---|
| 1 | 概览删宫格 | page.tsx 删 QuickEntryGrid import 与渲染段（:470 附近） |
| 2 | 组件删除 | quick-entry-grid.tsx 删除（无其它引用） |
| 3 | 菜单扩 13 项 | WorkspaceTabs TABS 数组补 4 项（label/路径）：扫描文档 /scan-docs、运行时 /runtime、智能体档案 /agent-profiles、方案文件 /files；顺序按使用频率：概览/组件/变更/会话/文件/扫描文档/运行时/智能体档案/Skills/MCP/MCP 令牌/成员/方案文件 |
| 4 | 菜单滑动 | nav 容器加 flex-nowrap overflow-x-auto + 滚动条隐藏（[scrollbar-width:none] [&::-webkit-scrollbar]:hidden 类组合） |
| 5 | standalone 收窄 | layout.tsx isStandalone 由 includes(changes)/includes(components) 双前缀**收窄为仅 `/components/topology`**（Grill P1 修正：原分支连带剥离 changes/[cid] 等深层页；topology 是 h-screen 整屏画布页，包裹后 +88px chrome 必然溢出裁切，保留其 standalone）；components/changes/changes-[cid] 等普通页全部恢复统一菜单（PageContainer 在包裹内 members/changes 先例正常——components 页用 default size 亦兼容） |
| 6 | 测试同步 | page.test 删宫格 href 断言用例；layout/tabs 相关测试若有断言 standalone 行为同步 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 删宫格段+import |
| 删除 | `frontend/src/components/workspace/quick-entry-grid.tsx` | 组件退役 |
| 修改 | `frontend/src/components/workspace-tabs.tsx` | TABS 扩 4 项+滑动容器 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx` | isStandalone 收窄为仅 topology |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx` | 宫格断言用例删 |

## 7. 接口定义

无新接口（WorkspaceTabs props 不变；QuickEntryGrid 退役删除）。

## 8. 生命周期契约

不涉及生命周期契约（纯导航展示层）。

## 9. 数据模型 / 兼容策略

不涉及。兼容：路由全部已有（4 新菜单项路由现存），零新增路由；回退单 commit revert。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | components/changes/changes-[cid] 回包裹布局后视觉回归 | P1 | PageContainer 在包裹内 members(size=full)/changes 先例正常，components 用 default size 亦兼容（Grill P2-1 修正措辞）；topology 整屏页保留 standalone 零风险；Docker 实测两页 |
| R-04 | 菜单双高亮缺陷被放大（overview startsWith 致子页下概览+当前页并置 aria-current） | P2 | 顺手修：overview isActive 改 pathname === base（一行，Grill P2-2） |
| R-02 | 13 项菜单滑动在触屏板/鼠标下的可达性 | P2 | overflow-x-auto 原生滚动+隐藏滚动条不隐藏能力；Docker 实测 |
| R-03 | 宫格删除后概览页信息密度下降（用户已确认删） | — | 用户明确指令 |

## 11. 决策追踪

decisions.md：D-401 删宫格入口唯一化（用户确认）、D-402 菜单 13 项平铺滑动不分组（用户指定）、D-403 standalone 收窄为仅 topology（Grill P1 修正：ql-20260707-004 的宽度理由与现码本就不符（AppShell 无 max-w）故废止双前缀剥离，但 topology h-screen 整屏页例外保留；overview 双高亮顺手修）。无未解决决策。

## 12. 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 需求覆盖（删重复/菜单补全/滑动/子页菜单补） | ✅ §5 六项 |
| 非目标明确 | ✅ §3 |
| 章节齐全 | ✅ |
| 文件清单真实性 | ✅ 本会话 grep 实证 |
| YAGNI | ✅ 不做分组/不动深层子页 |
| 验收可测 | ✅ grep 宫格清零/菜单 13 项/两页含 tabs/全量测试 |
| ⚠️ 自审存疑 | 无 |
