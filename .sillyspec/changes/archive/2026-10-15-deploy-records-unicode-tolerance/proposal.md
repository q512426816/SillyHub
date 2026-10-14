---
author: flow-machine-draft
created_at: 2026-10-14T22:44:58.994Z
---
# 提案书（Proposal）— 2026-10-15-deploy-records-unicode-tolerance

## 动机

任务原话转写：修复发布记录扫描对非 UTF-8 文件的容错缺口：UnicodeDecodeError 是 ValueError 子类不被 except OSError 捕获，单个坏编码 md 文件会把 GET /api/deploy-records 整体打成 500，违背 FR-04「坏文件不炸整表」契约（2026-10-15 24h 风险审查发现，service.py:244 注释声称编码容错但实现漏接）。

成功标准：
- _iter_files 读文件容错扩为捕获 (OSError, UnicodeDecodeError)，坏编码文件降级为 invalid 条目（parse_error 与读失败同口径）
- test_service.py 新增 GBK 坏编码文件用例：列表正常返回且该条目 status=invalid，其余合法记录不受影响
- 既有 deploy_records 测试（test_service.py + test_router.py）全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _iter_files 读文件容错扩为捕获 (OSError, UnicodeDecodeError)，坏编码文件降级为 invalid 条目（parse_error 与读失败同口径）
2. test_service.py 新增 GBK 坏编码文件用例：列表正常返回且该条目 status=invalid，其余合法记录不受影响
3. 既有 deploy_records 测试（test_service.py + test_router.py）全绿

## 成功标准（可验证）

1. _iter_files 读文件容错扩为捕获 (OSError, UnicodeDecodeError)，坏编码文件降级为 invalid 条目（parse_error 与读失败同口径）
2. test_service.py 新增 GBK 坏编码文件用例：列表正常返回且该条目 status=invalid，其余合法记录不受影响
3. 既有 deploy_records 测试（test_service.py + test_router.py）全绿
