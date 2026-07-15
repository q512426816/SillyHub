---
schema_version: 1
doc_type: module-card
module_id: components-ppm
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-ppm

## 定位
PPM（项目管理）业务通用组件集合（`components/ppm-*.tsx`），被 `/ppm/*` 各页面复用。提供字典下拉、用户选择、文件链接、子表（展开行编辑）、状态操作按钮、计划详情/表单、资源表等业务级控件，数据走 lib-ppm，是 PPM 页面与 lib-ppm 之间的中间展示层。

## 契约摘要
- `PpmDictSelect`：字典下拉，props `PpmDictSelectProps`；内置 `DICT_DATA: Record<PpmDictType, PpmDictOption[]>`，`getPpmDictOptions(type)` / `getPpmDictLabel(value, type)` 辅助；`PpmDictType` 覆盖 customer/project 等字典类型。
- `PpmUserSelect`：用户选择器，props `PpmUserSelectProps`（含 `PpmSelectOption`），从 lib-ppm 拉用户列表。
- `PpmFileUrls`：文件链接展示/上传，props `PpmFileUrlsProps`。
- `PpmSubTable<T>`：可编辑子表（展开行模式），`PpmSubTableRow` / `PpmSubOption` / `PpmSubEditableColumn<T>`（`PpmSubEditType = text|number|select|textarea`，select 带 `options`）/ `PpmSubTableProps<T>`；`editable=true` + `columns` + `onChange` 启用编辑，否则只读。
- `PpmProjectPlanDetail`：项目计划详情展示。
- `PpmProjectPlanForm`：项目计划表单。
- `PpmProjectMembersTable`：项目成员表；平铺模式（未传 `projectId`）首列展示「所属项目」（`listSimpleProjects` 建 id→name 映射，缺失回退 ID），锁定 `projectId` 模式按项目过滤、不显示该列。
- `PpmResourceTable`：资源表。
- `PpmStatusActions`：状态操作按钮组；导出 `matchAnyUser`、`PLAN_DETAIL_STATUS_TEXT/COLOR`、`PROBLEM_STATUS_TEXT` 等状态文案/配色映射。
- `PpmText`：文本展示（带格式化约定）。

## 关键逻辑
- 子表编辑模式（伪代码）：
  ```
  <PpmSubTable<T>
    mainColumns={...}            // 主表列（展开行模式）
    editable
    columns={[{ field, editType:'select', options, render? }]}
    value={rows} onChange={setRows}
  />
  ```
- 字典选择：`PpmDictSelect` 直接读本地 `DICT_DATA`，不走接口；改字典需改源码常量。
- 状态操作：`PpmStatusActions` 根据 `matchAnyUser` 等判定按钮可用性，文案/色取自导出的映射常量。

## 注意事项
- `PpmSubTable` 是泛型组件，列定义 `PpmSubEditableColumn<T>` 的 field 需与行类型对齐，否则 TS 报错。
- 字典数据 `DICT_DATA` 是前端硬编码，后端字典变更要同步这里（无接口同步）。
- 状态文案/配色常量（`*_STATUS_TEXT/COLOR`）被详情/列表多处引用，改一处全局生效，需回归。
- 这些组件强依赖 lib-ppm 的数据形状，后端 PPM 字段调整会级联影响。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260715-001-7d2e | PpmProjectMembersTable 平铺模式补「所属项目」列（listSimpleProjects 建 id→name 映射，缺失回退 ID）
