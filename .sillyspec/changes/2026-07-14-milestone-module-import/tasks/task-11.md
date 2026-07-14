---
id: task-11
title: 导入端点集成测试
title_zh: 导入预览/提交 API 集成测试
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-001, FR-004, FR-006, FR-009]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/ppm/plan/tests/test_router.py

goal: >
  为 import-preview / import-commit 两个端点编写集成测试，覆盖预览解析+责任人反查、提交新建/同名合并/模块汇总/原子回滚/未匹配行跳过。
implementation: |
  - 复用 test_router.py 现有 client（AsyncClient, platform_admin 全权限）+ auth_headers fixture
  - import-preview 测试：用 openpyxl 构造 xlsx（含已知项目成员姓名 + 未知姓名），multipart files=file 上传，断言返回 sheets/rows，已知成员 duty_matched=True、未知行 valid=False（FR-004, D-002）
  - import-commit 测试五类场景：
    - ① 新建模块+明细：created_modules/created_details 计数正确，明细 module_id 关联、status=draft（FR-001, D-001）
    - ② 同名模块合并：第二次提交同名 module_name → merged_modules++、不重复建模块、追加明细到已有模块（FR-006, D-004）
    - ③ 模块汇总：plan_begin_time=组内 min、plan_complete_time=组内 max、plan_workload=求和、duty_user_id=首个匹配（FR-009, D-005）
    - ④ 原子回滚：mock 注入异常（如 monkeypatch service 写明细抛错）→ 断言 DB 无脏数据（无残留模块/明细）、ImportResultResp.failed_rows 非空（FR-009, D-008@v1）
    - ⑤ 未匹配行跳过：valid=False 行不入库、skipped_rows 计数正确（D-002）
  - preview 用 multipart 上传（files=file），commit 用 JSON body（ImportCommitReq）
acceptance: |
  - 5 类提交场景 + 预览反查全部通过（断言计数 + DB 落库 + 关联关系）
  - 原子回滚验证无脏数据（D-008@v1，核心验收点）
  - 路由顺序无 422（R-06）
verify: |
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/ppm/plan/tests/test_router.py -k import -q
constraints: |
  - 集成测试走真实 DB session（test schema），不 mock service 内部
  - 仅原子回滚场景用 monkeypatch 注入异常，其余走完整端点链路
  - xlsx 用 openpyxl 在测试内构造（参考 test_importer.py 的 fixture 风格）
---
