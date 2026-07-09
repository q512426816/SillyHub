---
id: task-11
title: 跨 Wave 验证（清理 + Docker 实测）
wave: verify
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
  - task-08
  - task-09
  - task-10
allowed_paths:
  - .sillyspec/changes/2026-07-09-remote-folder-picker/verify-report.md
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  全量清理 browse_folder 残留；Docker rebuild 实测跨平台浏览与即时刷新。FR-5 / FR-6 / NFR-1 / NFR-2。
implementation: |
  - grep 三端 browse_folder/browseFolder/BrowseFolder 为空。
  - docker compose up -d rebuild；实测 Win 盘符根/Linux / 根可展开；非递归懒加载；保存即时生效；非 admin 403。
  - 产出 verify-report.md。
acceptance: |
  - grep 空；Win+Linux 浏览正常；保存即时生效；非 admin 403；verify-report 产出。
verify: |
  - grep -r "browse_folder\|browseFolder\|BrowseFolder" sillyhub-daemon/src backend/app frontend/src
  - cd deploy && docker compose up -d
constraints: |
  - 依据 design §10；task-11 产出 verify-report.md。
---

# task-11 · 跨 Wave 验证

> Wave verify · FR-5 / FR-6 / NFR-1 / NFR-2

## 验收标准
- [ ] grep 三端 `browse_folder`/`browseFolder`/`BrowseFolder` 为空
- [ ] Win + Linux daemon 浏览均正常展开
- [ ] 保存后 daemon 即时生效（在线）
- [ ] 非 admin 保存收 403
- [ ] `verify-report.md` 已产出

## TDD/验证步骤
- grep 全量扫描 + Docker rebuild 手动实测
- 记录结果到 `verify-report.md`
