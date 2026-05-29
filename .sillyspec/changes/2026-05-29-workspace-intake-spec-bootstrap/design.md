---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Design

## 架构决策

### ADR-01: SpecWorkspace 由平台托管

Workspace 的 `root_path` 表示代码位置，SpecWorkspace 的 `spec_root` 表示规范资产位置。二者可以相同 repo，也可以由平台放在独立数据目录。

### ADR-02: SillySpec CLI 是格式专家

平台不直接拼写复杂规范结构。创建、同步、校验等格式敏感操作通过受控 CLI adapter 调用 SillySpec。

### ADR-03: spec_strategy 决定接入路径

建议枚举：
- `none`: 只注册代码 Workspace，不创建规范空间。
- `bootstrap`: 创建新的平台托管规范空间。
- `import`: 从 repo 内 `.sillyspec` 导入。
- `link`: 关联 repo 内现有 `.sillyspec`，不复制。

## API 设计

- `POST /api/workspaces`：新增 `spec_strategy`、`repo_sillyspec_path`。
- `POST /api/workspaces/{id}/spec-bootstrap`
- `POST /api/workspaces/{id}/spec-sync`
- `POST /api/workspaces/{id}/spec-validate`
- `GET /api/workspaces/{id}/spec-workspace`

## 文件变更清单

- `backend/app/modules/workspace/schema.py`
- `backend/app/modules/workspace/service.py`
- `backend/app/modules/workspace/router.py`
- `backend/app/modules/spec_workspace/model.py`
- `backend/app/modules/spec_workspace/schema.py`
- `backend/app/modules/spec_workspace/service.py`
- `backend/app/modules/spec_workspace/bootstrap.py`
- `backend/app/modules/spec_workspace/validator.py`
- `backend/app/modules/spec_workspace/router.py`
- `backend/app/modules/spec_workspace/tests/`
- `frontend/src/lib/spec-workspaces.ts`
- `frontend/src/components/workspace-scan-dialog.tsx`
- `frontend/src/app/(dashboard)/workspaces/[id]/settings/`（新增）

## 兼容策略

- 未传 `spec_strategy` 时保持旧行为，默认只注册 Workspace。
- 已有 SpecWorkspace 不自动覆盖，必须显式 sync。
- CLI 调用失败时记录错误并返回可读诊断，不产生半完成规范目录。

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| CLI 输出格式变化 | 平台解析失败 | adapter 层封装并加契约测试 |
| bootstrap 覆盖用户文件 | 规范资产丢失 | 默认写平台托管目录，不覆盖 repo 文件 |
| validator 规则过严 | 阻断早期接入 | 分 warning/error 级别 |
