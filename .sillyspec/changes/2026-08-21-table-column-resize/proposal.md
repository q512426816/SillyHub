---
author: qinyi
created_at: 2026-08-21T10:40:00
---

# 提案书（Proposal）— 表格列宽统一可拖拽

## 动机
用户要求系统所有表格列可左右拖拽调宽；antd 6.4.4 无内建能力，需共享层实现。

## 关键问题
1. antd onHeaderCell 只能返回 th 属性不能渲染子元素（手柄需 header.cell 自定义渲染，官方 demo 路线）。
2. PPM 资源表业务列全无 width（D-502 跳过规则下"全站生效"落空），需默认宽兜底。
3. 拖拽与表头排序的点击冲突需捕获/子元素方案拦截。

## 变更范围
DataTable 共享层 useResizableColumns（number width 列挂真手柄+3px 阈值+拖中禁选中）+ PpmResourceTable 默认宽兜底 + 样式 + 5 单测。

## 不在范围内
16 页直用 antd Table 的收敛（另立）；列宽持久化记忆（留回调接口）；双击复位/列序拖换；触屏。

## 成功标准（可验证）
DataTable 13 消费文件全部表格 number width 列可拖；PPM 资源表业务列经兜底全部可拖；拖拽不触发排序；5 单测全绿+全量测试过；Docker 实测 PPM 项目列表。
