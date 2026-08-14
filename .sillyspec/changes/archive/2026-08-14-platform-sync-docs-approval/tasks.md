---
author: qinyi
created_at: 2026-08-14 21:38:00
---

# 任务清单（Tasks）— platform_sync 契约缺口端点

- task-01 数据模型 + migration：PlatformChangeProgressORM 加 documents/approval 两 JSON nullable 列 + alembic batch_alter_table（单 head 确认）【FR-07】
- task-02 schema：DocumentsSyncRequest / ApprovalSubmitRequest（reason optional）/ DocumentsSyncOk / ApprovalSubmitOk【FR-01/02】
- task-03 service：upsert_progress 定向列重构 + upsert_documents / set_approval / get_approval_record + 占位行守卫（get_progress NULL→None / list 过滤）【FR-04/05】
- task-04 router：POST documents + POST approval 两端点 + GET approval 改读库【FR-01/02/03/06】
- task-05 测试：test_router.py 扩展全量用例（422/401/200/GET 三态/单写者/占位行守卫）【FR-09】
- task-06 gen:types：api-types.ts + openapi.json 再生成提交【FR-08】
- task-07 端到端验证：CLI `platform sync-docs` / `platform approve` / `platform reject` 实跑 + reject 后 GET 返回 rejected 核验 + 接口地图 §2 撤除"后端未实现"标注
