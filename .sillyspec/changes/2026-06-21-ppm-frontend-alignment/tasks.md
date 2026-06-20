---
author: qinyi
created_at: 2026-06-21T01:05:40+0800
change: 2026-06-21-ppm-frontend-alignment
---

# Tasks(细节 plan 阶段展开为 Wave/Task)

| 任务 | 文件 | 覆盖 |
|---|---|---|
| **W0 基础组件** | | |
| PpmUserSelect + PpmText + PpmDictSelect 组件 | frontend/src/components/ppm-*.tsx | D-009@v1, FR-01 |
| 后端 project-member 加 pm_project_id+role_name 过滤 | backend/app/modules/ppm/project/{router,service}.py + lib/ppm/project.ts | FR-01 |
| **W1 项目成员** | | |
| 角色 auth.Role 多选 + 用户联动回填 + 项目→成员入口 | app/(dashboard)/ppm/{project-members,projects}/page.tsx | FR-02, D-009@v1 |
| **W2 里程碑** | | |
| 主子 expand + 模块三级 + 审批表单差异化 + Timeline | app/(dashboard)/ppm/milestone-details/page.tsx + ppm-sub-table.tsx | FR-03 |
| **W3 计划节点模板** | | |
| 行内批量编辑 + 字典 + 责任人下拉 | app/(dashboard)/ppm/plan-nodes/page.tsx | FR-04 |
| **W4 细节** | | |
| PpmFileUrls 附件URL + 工作日联动 + 处置按钮 | components/ppm-file-urls.tsx + milestone/problem 页面 | FR-05, D-010@v1 |
