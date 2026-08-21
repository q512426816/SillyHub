---
author: qinyi
created_at: 2026-08-21T10:40:00
---

# 需求规格（Requirements）— 表格列宽统一可拖拽

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 任意 DataTable 表格拖表头右缘调整列宽（min 60px） |

## 功能需求

### FR-01: 可拖拽手柄
覆盖决策：D-501, D-502@v2
Given DataTable 渲染的表格
Then `typeof width === "number"` 的列表头右缘渲染拖拽手柄（col 光标/hover 主题高亮）；无 width 或 string width 列无手柄；拖拽实时改宽、最小 60px、拖中 body 禁文本选中

### FR-02: 拖拽不误触排序
覆盖决策：D-501
Given 排序列的表头手柄
When 按住手柄拖拽
Then 不触发 onChange(sorter)；3px 内微动视为点击不误判拖拽

### FR-03: PPM 资源表覆盖
覆盖决策：D-502@v2
Given PpmResourceTable（projects/customers/project-stakeholders）
Then 业务列经默认宽兜底（类型映射 110-200px）全部可拖

### FR-04: 受控回调接口
覆盖决策：D-503
Given 页面传 onColumnsResize
Then 拖拽结束回调 { [dataIndex]: width }；不传=纯本地拖拽

## 非功能需求
- 消费页零改动生效；单 commit 回退；React 18 兼容

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-501 | FR-01, FR-02 | 共享层 header.cell 路线 |
| D-502@v2 | FR-01, FR-03 | number width only+PPM 兜底 |
| D-503 | FR-04 | dataIndex key 回调 |
