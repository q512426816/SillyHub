---
author: qinyi
created_at: 2026-08-21T10:50:00
plan_level: light
---

# 轻量计划（Light Plan）：表格列宽统一可拖拽

## 来源
用户需求（全部表格列可拖拽）+ design.md（Grill 修订版：header.cell 真手柄路线+PPM 兜底）+ D-501~503。

## 范围
- frontend/src/components/layout/use-resizable-columns.ts（新增）
- frontend/src/components/layout/data-table.tsx（接入）
- frontend/src/components/ppm-resource-table.tsx（默认宽兜底）
- frontend/src/app/globals.css（手柄样式）
- frontend/src/components/layout/use-resizable-columns.test.tsx（新增 5 用例）

## Wave 1（hook+样式，无依赖）
- task-01

## Wave 2（接入+兜底，依赖 W1）
- task-02

## Wave 3（测试验收，依赖 W2）
- task-03

## 验收
- number width 列手柄渲染/拖拽改宽（min 60）/拖中禁选中；string width 与无 width 列无手柄
- 排序列拖拽不触发 onChange(sorter)；3px 微动不算拖拽
- PPM 资源表业务列（兜底宽）全部可拖
- onColumnsResize 回调 key=dataIndex；5 单测全绿+全量 test+tsc/eslint 0
- Docker 实测 PPM 项目列表拖拽

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-501 | task-01, 02 | header.cell 路线落地 |
| D-502@v2 | task-01, 02 | number-only+PPM 兜底 |
| D-503 | task-02 | dataIndex 回调 |
