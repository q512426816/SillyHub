---
id: task-06
title: "FS stat 收敛"
title_zh: "_list_files_sync 改 scandir 单遍 + scan_docs parser stat 复用 + _safe_mtime 推广"
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: [task-01]
blocks: [task-10]
requirement_ids: [FR-07, FR-08]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/scan_docs/parser.py
  - backend/app/modules/change/tests/test_files_router.py
  - backend/app/modules/scan_docs/tests/test_parser.py
goal: >
  消除 reparse 读路径的多余 stat——change/service.py 的 _list_files_sync 从 rglob 加 is_file 加 stat 双 stat 改 os.scandir 显式栈单遍（照抄 change/parser.py 的 ql-008 范式）；scan_docs/parser.py 每文件 4 次 stat 收敛为 1 次（size 与 mtime 取自同一 stat_result）；三处裸 fromtimestamp 统一改用 _safe_mtime 防御 Windows bind mount 瞬态脏 mtime。
implementation:
  - change/service.py 的 _list_files_sync（:262 起）改 os.scandir 显式栈遍历——栈压目录、出栈 scandir、entry.is_file 判定后从 entry.stat 取 size 与 mtime，行为范式逐行对照 change/parser.py 的 scandir 段（ql-008 落盘代码）
  - scan_docs/parser.py 的文件遍历段（:127-186）收敛 stat 次数——同一文件只调一次 stat，size 与 st_mtime 均取自该 stat_result，消除重复 entry.stat 与 path.stat 交织
  - 三处裸 datetime.fromtimestamp 统一改 from change.parser import _safe_mtime——scan_docs/parser.py 的 :165 与 :247、change/service.py 的 :286；_safe_mtime 已在 change/parser.py:36 存在，纯 import 推广
  - 先写行为保持测试再改实现——文件列表结果与改前等价（路径集合、size、mtime 排序不变）；新增 mtime 脏值防御用例（构造 st_mtime 对应 year 30828 的超界时间戳，断言不抛异常且产出兜底时间）
acceptance:
  - _list_files_sync 遍历同一目录树结果与改前等价（文件集合与字段完整）
  - scan_docs parser 单文件 stat 次数收敛为 1，解析产物等价
  - mtime 脏值（year 30828 越界时间戳）不再触发异常，走 _safe_mtime 兜底
  - Windows 与 Linux 下行为一致（scandir 与 stat_result 跨平台语义）
verify:
  - cd backend && uv run pytest app/modules/change app/modules/scan_docs -q --no-cov
constraints:
  - _safe_mtime 只 from change.parser import，不改 change/parser.py 本体——task-07 同 Wave 要改 parser.py，避免两 task 共享文件产生 apply 冲突（plan 依赖关系节明示）
  - 不把 _safe_mtime 抽到 app/core/paths.py 等新公共位置——design 段 4 的「抽公共位置或 import」两选项中取 import，改动面最小且绕开共享文件
  - 与 task-01 共享 change/service.py，必须等 task-01（W1）完成后才可执行（W3 串行）
  - 行为零变更（NFR-01）——文件列表与解析产物对外结构不变
related_tests:
  - path: backend/app/modules/change/tests/test_files_router.py
    reason: _list_files_sync 的文件列表行为保持测试落点，现有断言作等价锚点
  - path: backend/app/modules/scan_docs/tests/test_parser.py
    reason: scan_docs parser 行为保持与 mtime 脏值防御用例落点
---
