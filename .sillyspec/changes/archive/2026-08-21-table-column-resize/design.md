---
author: qinyi
created_at: 2026-08-21T10:05:00
scale: large
source_change: 2026-08-21-table-column-resize
---

# 设计文档（Design）— 表格列宽统一可拖拽

> 需求：系统中表格列都应可左右拖动改变大小（用户原话）。antd Table 无内建列宽拖拽。

## 1. 背景

- 全站表格两形态：共享 `DataTable`（components/layout/data-table.tsx，13 页消费，PPM 资源表 PpmResourceTable 走它）+ 16 页直用 antd `<Table>`（多为 PPM 旧列表，P2 收敛债）。
- antd 6.4.4 无内建 resize；官方推荐 onHeaderCell 自定义表头 + 自管 width 实现。

## 2. 设计目标

1. DataTable 共享层实现列宽拖拽，13 个消费页自动生效（含全部 PPM 资源表）。
2. 交互：表头右缘拖拽手柄（col-resize 光标、hover/拖中主题色高亮、拖中 body 禁文本选中防划选）；最小 60px。
3. 无 `width` 列（自适应列）不拖拽——拖自适应列会挤其它列，antd 官方同建议。
4. 受控回调 `onColumnsResize?(widths)` 预留（页面可存 localStorage 记忆宽度，本轮不实现记忆）。

## 3. 非目标

- ❌ 16 页直用 Table 的收敛（另立批量迁移）
- ❌ 列宽持久化记忆（留接口即可）
- ❌ 双击复位/拖拽交换列序等进阶交互
- ❌ 触屏适配（桌面后台）
- ❌ 改 16 个直用页面的列定义

## 4. 拆分判断

单一变更：共享层一个 hook+接入，内聚清晰。

## 5. 总体方案

| # | 项 | 方案 |
|---|---|---|
| 1 | hook | 新增 `frontend/src/components/layout/use-resizable-columns.ts`（Grill P1-1/P1-2 修正：antd 官方 demo 路线）：`useResizableColumns(columns, onResize?)` 返回包装后 columns + 自定义 `components.header.cell`（th 内渲染真手柄 span）。**仅 `typeof width === "number"` 的列挂手柄**（P2-3：string width 如 "20%" 跳过防算术崩溃）；手柄 span onMouseDown 记录起点（pageX+当前 width），document mousemove 更新本地 widths state，mouseup 结束回调 onResize。**排序拦截走捕获阶段**（P1-2：antd triggerSorter 在 th onClick 先执行，冒泡 stopPropagation 无效）——拖拽中给 th 挂 onClickCapture stopPropagation，或手柄 click 事件天然不落在 th onClick 目标（真子元素方案天然满足）；移动阈值 3px 内不算拖拽恢复点击 |
| 2 | 接入 | `data-table.tsx`：props 加 `onColumnsResize?(widths: Record<string, number>)`（P2-2：key=dataIndex ?? title 字符串，防列序漂移）；columns 经 hook 包装+components.header.cell 透传 Table。**PpmResourceTable 兜底**（P1-3）：无 width 业务列给默认 width（按字段类型 120-200px 映射），使 PPM 资源表业务列全部可拖 |
| 3 | 样式 | globals.css 追加 `.sh-resize-handle`（绝对定位右缘 -right-1 top-0 h-full w-1.5 cursor-col-resize，hover/active 背景 brand-400；表头 position relative 由 th 自带）；拖拽中 body `.sh-col-resizing`（user-select none，cursor col-resize） |
| 4 | 测试 | 新增 `use-resizable-columns.test.tsx`：①number width 列渲染手柄②无 width/string width 列无手柄③mousedown+mousemove 模拟拖拽 width 增大且 onColumnsResize 收终值（key=dataIndex）④排序列拖拽后 click 不触发 onChange(sorter)（Grill 补）⑤3px 内微动不算拖拽不触发回调 |
| 5 | 实测 | Docker rebuild 后 PPM 项目列表页拖拽验证（固定列/斑马纹共存无碍） |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/layout/use-resizable-columns.ts` | 核心 hook（含 header.cell） |
| 修改 | `frontend/src/components/layout/data-table.tsx` | 接入 hook+onColumnsResize |
| 修改 | `frontend/src/components/ppm-resource-table.tsx` | 无 width 业务列默认宽兜底（P1-3） |
| 修改 | `frontend/src/app/globals.css` | 手柄+拖拽中样式 |
| 新增 | `frontend/src/components/layout/use-resizable-columns.test.tsx` | 4 用例 |

## 7. 接口定义

```ts
// use-resizable-columns.ts
export function useResizableColumns<T>(
  columns: TableProps<T>["columns"],
  onColumnsResize?: (widths: Record<string, number>) => void,
): {
  columns: TableProps<T>["columns"];
  components: { header: { cell: React.ComponentType<React.ThHTMLAttributes<HTMLTableCellElement> & { "data-col-key"?: string }> } };
};
// PpmResourceTable 兜底：PpmFieldDef 无 width 时按类型映射默认宽（文本 160/日期 130/数字 110/枚举 120），业务列全可拖
```

## 8. 生命周期契约

不涉及生命周期契约（纯表格交互展示层）。

## 9. 数据模型 / 兼容策略

不涉及数据模型。兼容：无 width 列行为不变；不传 onColumnsResize 行为=纯本地拖拽；消费页零改动自动生效；回退单 commit。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 自定义 header.cell 与消费方潜在 components 覆盖 | P2 | grep 实证全库唯一直用 Table 自传 onHeaderCell 在 weekly-plan（非 DataTable 消费方）；13 消费文件均不自传 components——hook 透传合并用户 components 属性 |
| R-02 | scroll.x 场景（PPM 表 max-content）拖拽后总宽变化布局跳动 | P2 | width 变化即列宽变化，antd tableLayout 自动；Docker 实测 PPM 表 |
| R-03 | 拖拽与排序点击冲突 | P1 | 真子元素手柄（antd triggerSorter 在 th onClick 执行，手柄 click 目标非 th）+3px 移动阈值；测试用例④锁定 |

## 11. 决策追踪

decisions.md：D-501 共享层实现（用户确认）、D-502@v2 仅 number width 列可拖（supersedes v1：string width/无 width 均跳过）+ PpmResourceTable 默认宽兜底使 PPM 业务列可拖（Grill P1-3）、D-503 受控回调 key=dataIndex（Grill P2-2）。无未解决决策。

## 12. 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 需求覆盖（全部表格列可拖） | ✅ DataTable 层 13 页生效；16 直用页非目标已声明 |
| 非目标明确 | ✅ §3 |
| 章节齐全 | ✅ |
| 文件清单真实性 | ✅ grep 实证 13+16 消费面 |
| YAGNI | ✅ 不做记忆/复位/触屏 |
| 验收可测 | ✅ 4 单测+Docker 实测 |
| ⚠️ 自审存疑 | 无 |
