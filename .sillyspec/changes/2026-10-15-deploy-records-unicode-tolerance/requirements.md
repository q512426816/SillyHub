---
author: flow-machine-draft
created_at: 2026-10-14T22:44:58.994Z
---
# 需求规格（Requirements）— 2026-10-15-deploy-records-unicode-tolerance

## 功能需求

### FR-01: _iter_files 读文件容错扩为捕获 (OSError, UnicodeDecodeError)，坏编码文件降级为 invalid 条目（parse_error 与读失败同口径）

- `DeployRecordService._iter_files` 读取 docs/releases/*.md 时**必须**同时捕获 `OSError` 与 `UnicodeDecodeError`（后者是 `ValueError` 子类、现状穿透 `except OSError`），坏编码文件**必须**降级为 `status=invalid`、`summary=记录文件格式异常（frontmatter 缺失或不合规）`、`deployed_at=None` 的容错条目（`parse_error="file read error"` 与读失败同口径），**禁止**因任一 workspace 的单个文件读取/解码失败使 `list_records` / `get_record` 抛未捕获异常（HTTP 500）——补齐 FR-04「文件是 agent 手写的，坏文件不能炸整表」契约的编码缺口。

#### 场景：坏编码文件不炸整表

- Given 一个 workspace 的 docs/releases/ 同时含合法 md 与含非 UTF-8 字节（GBK 编码）的 md
- When 调用 `list_records()`
- Then 返回 2 条：GBK 条目 `status=invalid` 且 `deployed_at=None`，合法条目正常解析不受影响

#### 场景：坏编码文件详情可读不抛错

- Given 上述 GBK 文件对应的 record_id
- When 调用 `get_record(record_id)`
- Then 返回 `status=invalid` 的详情（content 为空串），不抛异常

### FR-02: test_service.py 新增 GBK 坏编码文件用例：列表正常返回且该条目 status=invalid，其余合法记录不受影响

- test_service.py **必须**新增非 UTF-8（GBK 字节序列）坏编码文件用例，断言列表正常返回、该条目 `status=invalid`、同目录合法记录解析不受影响，并覆盖详情路径（`get_record` 返回 invalid 不抛错）；该用例**必须**在实现改动前对现状失败（先红后绿），**禁止**改动既有用例断言。

#### 场景：主路径

- Given 用例写入 GBK 字节文件 + 合法 md 文件
- When 新用例运行
- Then 修复前因 `UnicodeDecodeError` 穿透而失败，修复后全绿

### FR-03: 既有 deploy_records 测试（test_service.py + test_router.py）全绿

- 修复后 `backend/app/modules/deploy_records/tests/` 下 test_service.py 与 test_router.py 既有用例**必须**全绿（只跑相关测试，全量留给 CI），**禁止**为通过而修改既有测试断言。

#### 场景：主路径

- Given FR-01/FR-02 改动就位
- When 运行两测试文件
- Then 既有全部用例 + 新用例通过，零断言改动

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/deploy_records/tests/test_service.py「test_non_utf8_file_degrades_to_invalid」
FR-02: backend/app/modules/deploy_records/tests/test_service.py「test_non_utf8_file_degrades_to_invalid」
FR-03: backend/app/modules/deploy_records/tests/test_service.py + backend/app/modules/deploy_records/tests/test_router.py「全量既有用例回归」
