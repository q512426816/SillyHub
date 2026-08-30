---
author: qinyi
created_at: 2026-07-28 13:51:03
change: 2026-07-28-ppm-project-link-workspace
---

# 任务清单(Tasks)— PPM项目关联平台工作区

> brainstorm 阶段为**粗粒度**任务清单,plan 阶段将拆成 Wave/Task 并细化函数签名、依赖与验收。design.md §6 文件变更清单一一对应。

## 后端

- [x] T1: 新增 `PpmProjectWorkspace` 模型(`workspace/model.py`,仿 `TaskWorkspace`,复合主键 + 双向 CASCADE + workspace_id 索引)
- [x] T2: 新增 migration `ppm_project_workspace` 建表(`backend/migrations/versions/`,revision 唯一 + down 接当前 head)
- [x] T3: 新增 `workspace/link_service.py`(表级 bind/unbind/list 逻辑,权限无关,供两 router 复用;含重复绑定 409、存在性 404)
- [x] T4: 新增 `workspace/link_router.py`(工作区维度 GET/POST/DELETE `/workspaces/{id}/ppm-projects` + 工作区成员权限)
- [x] T5: `ppm/project/router.py` 加项目维度 GET/POST/DELETE `/projects/{id}/workspaces` + 项目 manager 权限
- [x] T6: `workspace/schema.py` 关联请求/响应 DTO
- [x] T7: `main.py` sibling include 注册 link_router(仿 `members_router`)
- [x] T8: 后端测试(link_service 单测 + 工作区维度接口 + 项目维度接口 + 越权 403 + 重复 409 + 软删过滤 + CASCADE + 存在性 404)

## 前端

- [x] T9: 前端关联 API 客户端(bind/unbind/list,项目侧 + 工作区侧)
- [x] T10: `ppm/projects` 页加「关联工作区」按钮 + `LinkWorkspaceDialog` 弹窗(已关联可解绑 / 可选工作区可绑定)
- [x] T11: `workspaces/[id]` 页加「关联项目」区块 `LinkedProjectsSection`(对称操作)
- [x] T12: 前端组件测试(弹窗绑定/解绑交互 + 区块对称)

## 收尾/验收

- [x] T13: `pnpm gen:types` 重新生成 OpenAPI 类型并对齐前端调用
- [x] T14: 全量回归(workspace 模块 + ppm 模块测试零回归)
- [x] T15: 三端 lint/typecheck/build 通过

## 依赖关系(粗)

- T1 → T2 → T3 → (T4, T5) → T6/T7 → T8
- T9 → (T10, T11) → T12
- T13 在后端 API 稳定后
- T14/T15 收尾
