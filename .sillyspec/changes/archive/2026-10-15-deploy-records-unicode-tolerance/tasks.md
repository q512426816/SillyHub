---
author: flow-machine-draft
created_at: 2026-10-14T22:44:58.994Z
---
# 任务注册表（Tasks）— 2026-10-15-deploy-records-unicode-tolerance

- [x] task-01: test_service.py 先行新增 GBK 坏编码用例 test_non_utf8_file_degrades_to_invalid——先红：现状 UnicodeDecodeError 穿透 except OSError 使 list_records 抛错（验证：单独跑该用例对现状失败）
- [x] task-02: service.py _iter_files except 扩为 (OSError, UnicodeDecodeError) + 注释与实现对齐（验证：task-01 用例转绿）
- [x] task-03: deploy_records 两测试文件回归全绿（验证：pytest test_service.py + test_router.py 全过，零既有断言改动）
