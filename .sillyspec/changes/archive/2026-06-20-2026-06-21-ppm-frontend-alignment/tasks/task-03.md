---
id: task-03
title: W1 项目成员 角色多选 + 用户联动回填 + 成员入口
priority: P0
estimated_hours: 5
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-009@v1]
author: qinyi
created_at: 2026-06-21T01:10:00+0800
---

## 目标
对齐源 `ppm/projectmember/ProjectMemberForm.vue` 交互:角色改 auth.Role 多选(value=role name)、选用户联动回填部门/手机/姓名、项目行新增「成员管理」抽屉入口(带 pm_project_id 过滤)。

## 文件
- 修改 `frontend/src/app/(dashboard)/ppm/project-members/page.tsx`
- 修改 `frontend/src/app/(dashboard)/ppm/projects/page.tsx`

## 实现要点(对照源 ProjectMemberForm.vue,不写代码)
- **角色 auth.Role 多选**(对照源 `silly-select res="role" multiple multiple-value-type="join"`):
  - 用 task-01 的 PpmUserSelect(res="role", multiple, multipleValueType="join")
  - 角色值=role.name 字符串(对齐 D-009@v1,与源 valueFunc=item?.name 一致),存 roleName 字段(逗号拼接多角色)
  - 取代原 role_id 单选 ID 方案
- **选用户联动回填**(对照源 `changeDepartAndPhone`):
  - PpmUserSelect(res="user") onChange,从 onLoadedOptions/userList 找到选中项,回填:`depart_name=item.deptName`、`depart_id=item.deptId`、`phone=item.mobile`、`user_name=item.nickname`、`user_id=item.id`(字段名按本仓 schema 实际,对照源 5 字段)
  - 用户名/联系方式/部门字段改为只读展示(联动回填后不可手填)
- **角色 onChange**(对照源 `changeRoleName`):多选时 roleName 取逗号拼接的 name 列表(单选时回写单个 name + 可选 roleId)
- **成员管理入口**(projects/page.tsx):
  - 项目表格行操作列新增「成员管理」按钮 → 打开 Drawer
  - Drawer 内复用 project-members 页面组件,但带 `pm_project_id` 过滤参数(传给 lib page 调用 + PpmUserSelect searchData)
  - 新增成员时自动带入当前项目 pm_project_id(对照源 `data.pmProjectId = parentData.pmProjectId`)
- **兼容 X-001**:旧成员 role_id 为源 system_role 值,新 UI 读 roleName 字符串;若 roleName 缺失则 role_id 原样展示,不做反解

## 验收
- [ ] 成员表单角色字段为多选下拉,选项来自 /api/admin/roles,值=role.name
- [ ] 选用户后部门/手机/姓名自动回填且只读
- [ ] 项目表格每行有「成员管理」按钮,打开抽屉只显示该项目成员
- [ ] 抽屉内新增成员自动绑定当前项目 id
- [ ] 旧成员(只有 role_id)角色列不报错,未知值原样展示(X-001 兼容)
- [ ] 对照源 ProjectMemberForm.vue 逐项 verify
- [ ] frontend typecheck + build 通过
