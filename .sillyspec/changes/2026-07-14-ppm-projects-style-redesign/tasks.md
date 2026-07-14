---
author: WhaleFall
created_at: 2026-07-14 10:51:14
---

# 任务清单（Tasks）— 初版

> 本文件为 brainstorm 阶段的初步任务概览。详细 Wave / Task / 依赖关系由 plan 阶段 `sillyspec run plan --change 2026-07-14-ppm-projects-style-redesign` 细化为 `plan.md`。
> 依据：`design.md` §5 总体方案（W1-W4）、§6 文件变更清单。

## W1 — PpmResourceTable 改造（核心，影响 项目/客户/干系人 页）

- [ ] task-01: `PpmFieldOption` 新增可选 `statusKind?: StatusKind` 字段（接口扩展，向后兼容）
- [ ] task-02: select 字段渲染分支：`statusKind`→`StatusBadge` / `color="default"`→默认灰 `Tag` / `color`→`Tag` / 否则纯文本
- [ ] task-03: `PpmResourceDrawer`（手写）→ antd `Drawer`，`maskClosable={false}`，干掉 `bg-black/30` + `✕` emoji + 原生 `<select>`/`<input>`
- [ ] task-04: `DeleteConfirm`（手写）→ antd `Modal`，`maskClosable={false}`
- [ ] task-05: toast / error 提示语义化（消除 `emerald-300` 硬编码）
- [ ] task-06: `project_name` 列加粗（`font-medium`），编号独立列不加粗
- [ ] task-07: 搜索区按钮分组——数据组（导出/新增）在左、基础组（查询/重置/展开）在最右、中间分隔；**布局不动**

## W2 — PpmProjectMembersTable 改造（影响 项目成员页 + 成员管理抽屉）

- [ ] task-08: `MemberFormDrawer`（手写）→ antd `Drawer`，`maskClosable={false}`
- [ ] task-09: `DeleteMemberConfirm`（手写）→ antd `Modal`，`maskClosable={false}`
- [ ] task-10: 角色多 `Tag color="blue"` → 多 `Badge` 或 token 色
- [ ] task-11: toast / error 提示语义化

## W3 — projects/page.tsx 改造

- [ ] task-12: `PROJECT_STATUS_OPTIONS` 加 `statusKind`（进行中=info / 已完成=success / 已暂停=warning）
- [ ] task-13: `PROJECT_TYPE_OPTIONS` 的 `color` 改 token 预设名（研发=blue / 实施=cyan / 运维=default）
- [ ] task-14: `ProjectMembersDrawer`（手写）→ antd `Drawer`，`maskClosable={false}`

## W4 — 联调验收

- [ ] task-15: `tsc --noEmit` 通过
- [ ] task-16: `pnpm lint` 通过
- [ ] task-17: grep 验证 ppm 范围内无 `bg-black/30` / `✕` emoji / `emerald-300` 残留
- [ ] task-18: Docker rebuild 实测 4 个 ppm 列表页 + 成员管理抽屉（CRUD / 搜索 / 导出 / 状态胶囊视觉 / 浮层遮罩不关 / Drawer 嵌套层级 R-06）

## 依赖关系（粗略，plan 细化）

- task-01（接口）→ task-02（渲染分支）→ task-12/13（枚举使用）
- W1 / W2 可并行（两个独立组件），W3 依赖 task-01/02 接口就绪
- W4 依赖 W1-W3 全部完成
