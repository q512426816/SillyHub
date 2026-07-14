---
plan_level: light
author: WhaleFall
created_at: 2026-07-14 10:58:30
---

# 轻量计划（Light Plan）：/ppm/projects 页样式规范化

## 来源
直接引用 brainstorm 四件套：`design.md` §5 总体方案（W1-W4）+ §6 文件变更清单、`tasks.md`（18 细任务合并为本计划 7 任务）、`requirements.md`（FR-01~FR-06）、`decisions.md`（D-001~D-006）。不重新扩写。

## 范围
- `frontend/src/components/ppm-resource-table.tsx`（共享组件①，影响 项目/客户/干系人 页）
- `frontend/src/components/ppm-project-members-table.tsx`（共享组件②，影响 项目成员页 + 成员管理抽屉）
- `frontend/src/app/(dashboard)/ppm/projects/page.tsx`
- 无后端、无新依赖、无 schema/状态机变更
- **范围扩展（verify 后，task-08）**：同套规则推广到 `globals.css` + 10 个 ppm 页面（kanban-search-bar / plan-nodes / problem-list / problem-changes / project-plans / project-stakeholders / task-execute / task-plans / work-hours / work-hour-statistics / milestone-details），详见 design.md §6.1

## Tasks

> 依赖：task-01（接口扩展）→ task-05（枚举消费 statusKind）；task-02/03/04 相互独立可并行；task-06/07 在 task-01~05 完成后。

- [x] task-01: `PpmResourceTable` 的 `PpmFieldOption` 新增可选 `statusKind` 字段 + select 列渲染分支（`statusKind`→StatusBadge / `color="default"`→默认灰 Tag / `color`→Tag / 否则纯文本）（覆盖：FR-01, FR-02, D-003@v1, D-004@v1）
- [x] task-02: `PpmResourceTable` 两处手写浮层换 antd —— 编辑表单→`Drawer`、删除确认→`Modal`，均 `maskClosable={false}`，干掉 `bg-black/30`+`✕` emoji+原生控件（覆盖：FR-03, D-002@v1, D-006@v1）
- [x] task-03: `PpmResourceTable` toast/error 语义化（消除 `emerald-300`）+ `project_name` 列加粗 + 搜索按钮分组（数据组导出/新增在左、基础组查询/重置/展开在最右、中间分隔；**布局不动**）（覆盖：FR-04, FR-05, FR-06, D-006@v1）
- [x] task-04: `PpmProjectMembersTable` 两处手写浮层换 antd（`Drawer`+`Modal`，`maskClosable={false}`）+ 角色多 `Tag`→`Badge`/token 色 + toast/error 语义化（覆盖：FR-03, FR-04, D-002@v1, D-006@v1）
- [x] task-05: `projects/page.tsx` 枚举改造 —— `PROJECT_STATUS_OPTIONS` 加 `statusKind`（进行中=info/已完成=success/已暂停=warning）、`PROJECT_TYPE_OPTIONS` 的 `color` 改 blue/cyan/default、`ProjectMembersDrawer` 手写→antd `Drawer`（`maskClosable={false}`）（覆盖：FR-01, FR-02, FR-03, D-003@v1, D-004@v1, D-006@v1）
- [x] task-06: `tsc --noEmit` + `pnpm lint` 通过（覆盖：全局验收）
- [x] task-07: grep 验证 ppm 范围无 `bg-black/30`/`✕` emoji/`emerald-300` 残留 + Docker rebuild 实测 5 页（项目/客户/干系人/项目成员/成员管理抽屉）功能不回归 + 浮层遮罩不关 + Drawer 嵌套层级（R-06）（覆盖：全局验收, R-02, R-06）
- [x] task-08: **范围扩展（verify 后推广至全 ppm 页面）** —— `globals.css` 主题色统一（`--primary`/`--ring` 蓝 + `--radius` 0.5rem）；`kanban-search-bar` 搜索按钮分组（D-006）；`plan-nodes`/`problem-list`/`problem-changes`/`project-plans`/`project-stakeholders`/`task-execute`/`task-plans`/`work-hours`/`work-hour-statistics`/`milestone-details` 操作列居中 + ghost 按钮 + 去硬编码色（`bg-blue-500`/`bg-amber-500`）+ 危险操作红色 className（覆盖：AC-01/AC-04 推广，详见 design.md §6.1）

## 验收
- AC-01: ppm 范围 grep 不到 `bg-black/30`、emoji `✕` 关闭按钮、`emerald-300` 硬编码色
- AC-02: 状态列 = 带圆点 pill（进行中蓝/已完成绿/已暂停橙）；类型列 = Tag 色块（研发蓝/实施青/运维灰）
- AC-03: 编辑/删除/成员管理浮层均为 antd Drawer/Modal，点遮罩**不**关，ESC / ✕ / 取消可关
- AC-04: 搜索区布局保持现状（按钮行在字段上方右对齐：数据组左、基础组最右；字段 ≤4 + 展开收起）
- AC-05: 4 个 ppm 列表页 + 成员管理抽屉 CRUD/搜索/导出功能不回归
- AC-06: `tsc --noEmit` + `pnpm lint` 通过，Docker rebuild 实测核心页与原型视觉对照

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~05 | AC-05（5 页面统一达标） |
| D-002@v1 | task-02, task-04, task-05 | AC-03（antd Drawer/Modal 浮层） |
| D-003@v1 | task-01, task-05 | AC-02（状态 StatusBadge / 类型 Tag） |
| D-004@v1 | task-01, task-05 | AC-02（状态/类型色彩映射） |
| D-005@v1 | task-01~05 | 计划无 `pnpm add` 步骤（无新依赖） |
| D-006@v1 | task-02, task-03, task-04, task-05 | AC-03（遮罩不关）+ AC-04（搜索布局不变 + 按钮分组） |

## 自检（light）
- [x] 标注 plan_level: light
- [x] 含来源/范围/Tasks/验收四部分
- [x] 来源直接引用四件套，未扩写
- [x] 任务无实现细节（无函数签名/代码示例）
- [x] 任务使用 `- [ ] task-XX:` checkbox 格式
- [x] 验收 AC-01~AC-06 具体可验证
- [x] D-001~D-006 全部在覆盖矩阵可追踪
- [x] 无 P0/P1 unresolved blocker（D-001~D-006 均 accepted）
