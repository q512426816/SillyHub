---
schema_version: 1
doc_type: module-card
module_id: components-ppm
author: qinyi
created_at: 2026-08-18 01:45:00
---

# PPM 业务通用组件（components-ppm）

## 定位
PPM（项目管理）业务通用组件集合，分三处：
- `components/ppm-*.tsx`：10 个通用控件（字典/用户/子表/CRUD 表格/成员表/计划/状态/文本）。
- `components/ppm/milestone/`：里程碑模块 5 文件（详情抽屉/导入/表单抽屉/共享辅助）。
- `components/ppm/problem/`：问题清单 Excel 导入弹窗。

是 `/ppm/*` 页面与 lib-ppm 之间的中间展示层；配置驱动的 `PpmResourceTable` 是项目/客户/项目成员/干系人四个维护页的共同 CRUD 底座。

## 契约摘要
通用控件（ppm-*.tsx）：
- `PpmDictSelect`：字典下拉；内置 `DICT_DATA: Record<PpmDictType, PpmDictOption[]>` 本地常量（不走接口）。
  - 辅助 `getPpmDictLabel(value, type)`；类型 `PpmDictType` / `PpmDictOption`。
- `PpmUserSelect`：用户/成员/角色/项目四态选择器，`PpmUserSelectRes = "user"|"projectMember"|"role"|"project"` 决定数据源；选项类型 `PpmSelectOption`。
- `PpmSubTable<T>`：可编辑子表（antd Table 展开行模式）。
  - 列定义 `PpmSubEditableColumn<T>`（`PpmSubEditType = text|number|select|textarea`，select 带 `PpmSubOption[]` options）。
  - 主表列 `PpmSubMasterColumns<T> = TableColumnsType<T>`；行类型约束 `PpmSubTableRow`。
  - `editable=true` + `value/onChange` 启用编辑，否则只读展开。
- `PpmResourceTable<T>`（907 行，本域最大件）：配置驱动 CRUD 表格，四个维护页复用。
  - `searchFields` 顶部搜索栏（Enter 触发）+ antd Table（后端直返 list[]，前端分页/排序）。
  - `formFields` 驱动新增/编辑 Modal Form；删除二次确认；可选 `exportFn` 导出。
  - 字段配置 `PpmFieldDef<T>`（`PpmFieldType` / `PpmFieldOption`）；响应类型 `PpmPageResp<T>`。
  - 底座复用 components-layout 的 DataTable/PageContainer/PageHeader/SectionCard 与 StatusBadge。
- `PpmProjectMembersTable`（642 行）：项目成员表。
  - 平铺模式（未传 projectId）首列「所属项目」——`listSimpleProjects` 建 id→name 映射，缺失回退 ID。
  - 锁定 projectId 模式按项目过滤、不显示该列。
  - 导出 `MemberFormModal`（成员表单弹窗）与 `MemberForm` 类型。
- `PpmProjectMembersGroupTable`（487 行）：按分组维度展示的项目成员表。
- `PpmProjectPlanDetail`（325 行）：项目计划详情展示。
- `PpmProjectPlanForm`（591 行）：项目计划表单（props `PpmProjectPlanFormProps`）。
- `PpmStatusActions` / `PlanDetailActions`：状态操作按钮组，`matchAnyUser(...)` 判定按钮可用性。
  - 导出文案/配色映射：`PLAN_DETAIL_STATUS_TEXT/COLOR`、`PROBLEM_STATUS_TEXT/COLOR`、`PROBLEM_TYPE_TEXT`。
- `PpmText`：文本展示（带格式化约定，props `PpmTextProps`）。

milestone/（里程碑模块）：
- `DetailDrawer`（759 行）：里程碑/模块/任务执行详情抽屉。
- `ImportModuleModal`（442 行）：模块 Excel 导入（props `ImportModuleModalProps`）。
- `milestone-helpers.tsx`（181 行）：共享辅助与小组件。
  - 常量：`IMPLEMENT_STAGE`（实施阶段）、`TASK_EXECUTE_STATUS_COLOR`。
  - 状态机：`DrawerMode` / `DetailDrawerState` / `modeForStatus(status)`。
  - 转换：`toDay`/`fromDate`（日期字符串↔Dayjs）、`processColor(nodeKey)`。
  - 小组件：`StatBox` / `Field` / `FormSection` / `ModuleReadText`。
- `ModuleFormDrawer`（149 行）：模块表单抽屉。
- `PsPlanNodeDrawer`（246 行）：PS 计划节点抽屉。

problem/：
- `ImportProblemModal`（469 行）：问题清单 Excel 导入弹窗（+ 同名测试文件）。

## 关键逻辑
```
<PpmResourceTable<T>                     // 四个维护页共用底座
  searchFields={...} formFields={...} columns={...}
  fetchPage={params => PpmPageResp<T>}   // 后端 list + 前端分页
  onCreate/onUpdate/onDelete exportFn? />

<PpmSubTable<T> editable                 // 展开行内编辑
  columns={[{ field, editType: 'select', options }]}
  value={rows} onChange={setRows} />     // 列 field 与行类型 T 对齐

PpmStatusActions: matchAnyUser(...) → 按钮可用性
  文案/色取导出映射常量（全局共享，改一处全局生效）
```

## 注意事项
- `DICT_DATA` 是前端硬编码字典，后端字典变更须手动同步源码（无接口同步）。
- 状态文案/配色常量（`*_STATUS_TEXT/COLOR`）被详情/列表多处引用，改一处全局生效需回归。
- `PpmResourceTable` 的 formFields/searchFields 配置是四个维护页的契约核心，改 `PpmFieldType` 或校验行为会级联四页。
- 文件上传/展示已迁出本域：旧 `PpmFileUrls` 已删，统一用 components-file-center 的 `FileUpload`/`FileViewer`（`file_urls` 值语义=文件 id）。
- milestone/problem 子目录文件较大（DetailDrawer 759 行），改抽屉状态机先看 `modeForStatus`/`DetailDrawerState` 的模式定义。
- 这些组件强依赖 lib-ppm 的数据形状，后端 PPM 字段调整会级联影响。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260715-001-7d2e | PpmProjectMembersTable 平铺模式补「所属项目」列（listSimpleProjects 建 id→name 映射，缺失回退 ID）（原卡「变更索引」段内容，迁移保留）
<!-- MANUAL_NOTES_END -->
