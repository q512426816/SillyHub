---
author: qinyi
created_at: 2026-08-30 20:10:00
change: 2026-07-28-ppm-project-link-workspace
---

# 模块影响分析（Module Impact）— PPM 项目 ↔ 平台工作区多对多关联骨架（A 阶段）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:models | 数据结构变更 | 新表 ppm_project_workspace（复合主键 + 双向 CASCADE + workspace_id 索引，零 PPM 数据模型改动） |
| backend:ppm | 接口变更+新增 | link_service 表级逻辑（bind/unbind/list：404 存在性 + 409 重复 + 软删过滤）；项目侧对称 router（登录可见 GET + _require_project_manager POST/DELETE） |
| backend:workspace | 接口变更 | workspace 侧 link_router（WORKSPACE_READ GET / MEMBER_MANAGE POST/DELETE） |
| frontend:lib-workspace | 接口变更 | 关联 API 客户端 + PpmProjectBrief 类型（gen:types） |
| frontend:app-ppm-pages / workspace 页 | 新增 | ppm/projects 行内「关联工作区」弹窗 + workspaces/[id]「关联 PPM 项目」区块（6 组件测试） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| migration（ppm_project_workspace 建表） | versions 目录既有归属 |
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `backend modules/ppm.md` | 契约摘要已含「workspace↔PPM 项目绑定对称端点」（scan 收录，归档期核实） | skipped（已同步） |
| `backend modules/workspace.md` | ppm-projects link_router 已列（grep 核实） | skipped（已同步） |
| `backend _module-map.yaml` | workspace entrypoints 含 ppm-projects、PpmProjectWorkspace 已列 main_symbols | skipped（已同步） |
| `frontend modules/lib-workspace.md` | ppm-projects 关联已收录（grep 核实） | skipped（已同步） |
