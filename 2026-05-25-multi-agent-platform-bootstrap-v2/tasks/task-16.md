---
id: task-16
title: 实现部署、归档与知识沉淀闭环
phase: V5
priority: P2
status: draft
owner: qinyi
estimated_hours: 40
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/release/
  - backend/app/modules/archive/
  - backend/app/modules/knowledge_index/
  - frontend/src/app/(dashboard)/releases/
depends_on:
  - task-13
  - task-15
---

## 1. 目标

把 Change 从 `done` 通过 release / 部署审批 / 部署执行 / 归档 / 经验沉淀，完整走通到 SillySpec `changes/archive/` 与 `knowledge/`。

## 2. 输入

- `requirements.md` §V5
- `plan.md` §7
- `risk-mitigation-design.md`（旧）风险4 部署四重保护
- `references/18-error-recovery.md`

## 3. 产出清单

### 3.1 Release

```python
class Release:
    workspace_id: UUID
    change_ids: list[UUID]
    target_env: Literal["staging", "production"]
    plan_md: str        # 模板渲染 release notes
    pre_checks: list[str]
    post_checks: list[str]
    rollback_plan: str
```

数据表 `releases`（见 17-db-schema.md §6）。

### 3.2 部署四重保护

```text
第一重：Agent 权限模板 (devops_agent 没有 deploy:production)
第二重：Tool Gateway 风险 critical 强制审批
第三重：审批门禁（至少两人：DevOps + Workspace Owner）
第四重：发布窗口（默认 Mon-Fri 10:00-18:00）
```

`deploy_policy` YAML：

```yaml
deploy_policy:
  staging:
    auto_after_test: true
    approval_required: false
    rollback_auto: true
  production:
    approval_required: true
    approval_roles: [workspace_owner, devops, security_reviewer]
    min_approvals: 2
    deploy_window: ["Mon-Fri 10:00-18:00"]
    pre_checks:
      - all_tests_passed
      - security_review_passed
      - spec_updated
      - rollback_plan_exists
    post_checks:
      - health_check_passed
      - error_rate_below: "0.1%"
    rollback:
      auto_trigger:
        - error_rate_above: "1%"
        - health_check_failed
```

### 3.3 归档

`/api/changes/{cid}/archive` 触发：

1. 检查 status=done 且 PR 已合并
2. 物理移动 `changes/change/{cid}` → `changes/archive/{cid}`（通过 Git Tool Gateway）
3. 更新 changes.location=archive, archived_at
4. 触发知识沉淀（异步）

### 3.4 知识沉淀

`backend/app/modules/knowledge_index/`：

- 从归档 Change 抽取：proposal、design、verification、关键 ADR
- 用 OpenAI / 本地模型生成摘要
- 入 `knowledge_documents`（pgvector embedding）
- 落到 `.sillyspec/knowledge/<category>/<change_id>-summary.md`

### 3.5 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/releases` | `deploy:staging`/`deploy:production` | 创建发布单 |
| GET | `/api/releases` | `change:read` | 列表 |
| POST | `/api/releases/{id}/approve` | per policy | 审批 |
| POST | `/api/releases/{id}/deploy` | DevOps | 触发部署 |
| POST | `/api/releases/{id}/rollback` | DevOps | 回滚 |
| POST | `/api/changes/{cid}/archive` | `change:archive` | 归档 |
| POST | `/api/changes/{cid}/distill` | `change:archive` | 触发知识沉淀 |

### 3.6 前端

`releases/page.tsx`：

- 发布单列表 / 详情
- 审批面板（多人会签状态）
- 一键部署 / 回滚（带二次确认）
- 部署窗口状态

### 3.7 监控回填

- Prometheus + Grafana：部署完成后 30 分钟内拉取错误率 / p95
- 触发回滚阈值时自动调 rollback API

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | staging 自动部署 | 测试通过 → 自动 |
| AC-02 | production 缺审批 | 拒绝 |
| AC-03 | production 审批不足 2 人 | 拒绝 |
| AC-04 | 非部署窗口 | 拒绝 |
| AC-05 | pre_check 失败 | 拒绝 + 列出失败项 |
| AC-06 | post_check error_rate 超阈值 | 自动 rollback |
| AC-07 | 归档时 status != done | 拒绝 |
| AC-08 | 归档后 Git 物理移动成功 | changes/archive 下出现目录 |
| AC-09 | 知识沉淀生成 summary 文件 | knowledge/ 下存在 |
| AC-10 | 全程审计事件 | DEPLOYMENT_* / CHANGE_ARCHIVED |
| AC-11 | 单测 + 集成 | ≥ 80% |
| AC-12 | E2E：feature → done → release → deploy → archive → knowledge | 一气呵成 |

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 部署失败但状态显示成功 | post_check 失败必须翻状态 |
| 回滚脚本缺失 | pre_check 强制要求 rollback_plan |
| 知识沉淀生成低质 | 增加人工审核环节，质检通过才写 knowledge/ |
| archive Git 操作大目录 mv | 用 git mv，确保历史保留 |

## 6. 完成定义

- [ ] 12 个 AC 通过
- [ ] E2E 演示
- [ ] `verification.md` 追加 task-16 记录
- [ ] PR 合并
