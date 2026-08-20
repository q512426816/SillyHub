---
author: qinyi
created_at: 2026-08-20T23:50:00
---

# 需求规格（Requirements）— 工作区导航整合

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 任意工作区子页面顶部菜单可达全部 13 个子页 |

## 功能需求

### FR-01: 入口唯一化
覆盖决策：D-401
Given 概览页
Then 无快速入口宫格（QuickEntryGrid 退役删除，全仓引用清零）

### FR-02: 菜单全量与滑动
覆盖决策：D-402
Given 任一非 standalone 子页
Then 顶部菜单 13 项（概览/组件/变更/会话/文件/扫描文档/运行时/智能体档案/Skills/MCP/MCP 令牌/成员/方案文件），href 与原宫格/现菜单一致；容器 flex-nowrap overflow-x-auto 滚动条隐藏可左右滑动；仅当前项高亮（overview 双高亮修复：pathname === base）

### FR-03: 子页菜单补全
覆盖决策：D-403
Given components / changes / changes-[cid] 等页
Then 渲染于 workspace layout 内含顶部菜单；topology 整屏页保留 standalone（无菜单，h-screen 零回归）

## 非功能需求
- 行为零变更（路由/数据流不动）；单 commit 可回退
- 验收：grep 宫格清零/菜单 13 项断言/全量测试/Docker 实测

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-401 | FR-01 | 删宫格 |
| D-402 | FR-02 | 13 项平铺滑动 |
| D-403 | FR-03 | standalone 收窄仅 topology |
