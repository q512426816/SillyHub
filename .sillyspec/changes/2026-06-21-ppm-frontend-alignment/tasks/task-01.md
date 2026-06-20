---
id: task-01
title: W0 基础组件 PpmUserSelect / PpmText / PpmDictSelect
priority: P0
estimated_hours: 6
depends_on: []
blocks: [task-03, task-04, task-05, task-06, task-07]
requirement_ids: [FR-01]
decision_ids: [D-009@v1]
author: qinyi
created_at: 2026-06-21T01:10:00+0800
---

## 目标
提供 ppm 通用基础组件,覆盖 W1-W4 所有人员/字典/展示需求:服务端搜索分页下拉、id→名字展示、字典下拉。对照源 SillySelect(6 资源 resConfig)重写为 React+AntD Select。

## 文件
- 新增 `frontend/src/components/ppm-user-select.tsx`
- 新增 `frontend/src/components/ppm-text.tsx`
- 新增 `frontend/src/components/ppm-dict-select.tsx`

## 实现要点(对照源,不写代码)
- **PpmUserSelect**(对照源 `SillySelect/index.vue` + `Silly/src/resConfig.ts`):
  - props `{ res: "user"|"projectMember"|"role"|"project"; searchData?: Record<string,any>; value; onChange; multiple?; placeholder?; pageSize? }`
  - res 映射(对照源 resConfig,迁移到本仓 API 路径):user→`/api/admin/users`(simple, label=nickname);projectMember→`/api/ppm/project-member`(page,searchData 过滤,value=userId,label=userName,pageSize=50);role→`/api/admin/roles`(simple,value=name,label=name — 注意 role 用 name 作 value,对齐 D-009@v1 auth.Role);project→`/api/ppm/project-maintenance/simple-list`(label=projectName)
  - 服务端搜索:debounce 300ms(对照源 `dataFilter`),更新 `searchText`+pageNo=1 重新请求
  - 分页加载:滚动到底部 loadMore(对照源 `loadMore`+`unLoadMoreFlag`),pageTotal 判断终止
  - 初始值回填:有 value 时带 selectIds 请求首屏(对照源 `initPageValueFlag`)
  - 去重:valueFunc 去重(对照源 `removeDuplicates`)
  - onChange 回传 value;onLoadedOptions 透出全量 options(供 task-03 联动回填)
  - 用 AntD Select + onPopupScroll,apiFetch 统一请求
- **PpmText**:props `{ value; res; }`,内部复用 PpmUserSelect 逻辑拉单条,只渲染 label 文本(对照源 id→名展示场景)
- **PpmDictSelect**:props `{ dictType; value; onChange; }`,对接现有 dict API(查本仓 dict 接口),普通本地过滤下拉

## 验收
- [ ] PpmUserSelect 四种 res 均可下拉、搜索、分页加载更多
- [ ] res=role 时 value/name 为角色 name 字符串(对齐 D-009@v1)
- [ ] searchData={{pm_project_id, role_name}} 生效(配合 task-02)
- [ ] 多选 onChange 透传数组/数组元素
- [ ] PpmText 传 user id 能显示 nickname
- [ ] PpmDictSelect 按字典类型渲染选项
- [ ] frontend typecheck + build 通过
