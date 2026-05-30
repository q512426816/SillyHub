---
author: qinyi
created_at: 2026-05-30 15:07:31
---

# Tasks: 写入 Change 包

## Wave 1: Phase A — 模板增强与修复

- **Task 1**: 增强 markdown_builder — 新增 `build_tasks_md`, `build_verification_md`，增强 `build_master_md` 增加 author/change_key 参数
  - `backend/app/modules/change_writer/markdown_builder.py`
  - `backend/app/modules/change_writer/tests/test_markdown_builder.py`

- **Task 2**: 修复 batch-generate lease_id 传递 — BatchGenerateRequest 增加 lease_id，router 传递给 service
  - `backend/app/modules/change_writer/schema.py`
  - `backend/app/modules/change_writer/router.py`
  - `backend/app/modules/change_writer/tests/test_router.py`

## Wave 2: Phase B — Git 提交与推送

- **Task 3**: 实现 git_commit_and_push — 在 ChangeWriterService 内新增方法，串行调用 GitGatewayService
  - `backend/app/modules/change_writer/service.py`
  - `backend/app/modules/change_writer/schema.py`
  - `backend/app/modules/change_writer/router.py`

- **Task 4**: git_commit_and_push 测试 — mock GitGatewayService，验证调用顺序和参数
  - `backend/app/modules/change_writer/tests/test_service.py` (新增)
  - `backend/app/modules/change_writer/tests/test_router.py`

## Wave 3: Phase B — PR 创建

- **Task 5**: 实现 create_pull_request — 解密 PAT + httpx 调 GitHub API
  - `backend/app/modules/change_writer/service.py`
  - `backend/app/modules/change_writer/schema.py`
  - `backend/app/modules/change_writer/router.py`

- **Task 6**: create_pull_request 测试 — mock httpx 和 CredentialCipher，验证各种响应
  - `backend/app/modules/change_writer/tests/test_service.py`
  - `backend/app/modules/change_writer/tests/test_router.py`

## Wave 4: 回归验证

- **Task 7**: 全套回归测试 — 确认新增测试 ≥ 15，全套 540+ 测试无回归
  - `backend/` (全量 pytest)
