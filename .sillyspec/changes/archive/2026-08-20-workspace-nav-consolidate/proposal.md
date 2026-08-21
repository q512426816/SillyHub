---
author: qinyi
created_at: 2026-08-20T23:50:00
---

# 提案书（Proposal）— 工作区导航整合

## 动机
概览页快速入口宫格与顶部菜单入口重复分裂；components/changes 等页因历史 standalone 分支无顶部菜单。

## 关键问题
1. 跳转入口两套并存（宫格 6 项 vs 菜单 9 项，部分重叠部分互补）。
2. 菜单缺 4 个子页入口（扫描文档/运行时/智能体档案/方案文件）。
3. standalone 双前缀剥离连带 changes/[cid] 深层页无菜单。

## 变更范围
删宫格（组件退役）；菜单扩 13 项+左右滑动；standalone 收窄为仅 topology；overview 双高亮顺手修；测试同步。

## 不在范围内
- 7 个更深层子页（audit 等）入菜单与否
- 菜单分组/下拉收纳
- 子页内部布局（含 components 页次级 NAV_ITEMS 重复——follow-up 留档）

## 成功标准（可验证）
- 概览页无 QuickEntryGrid 渲染且组件文件删除、引用清零
- 菜单 13 项一次可达，容器可左右滑动，任意子页下仅当前项高亮
- components/changes 及 changes/[cid] 页显示顶部菜单；topology 保持整屏无菜单
- 全量 pnpm test 通过、tsc/eslint 0 error、Docker 实测两恢复页与 topology 零回归
