---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-13
title: 后端 list/read/write/pending + 路径穿越 + 两分支单测
priority: P0
depends_on: [task-08]
wave: W6
requirement_ids: [FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-004@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/change/tests/test_files_router.py
---

# task-13 — 后端 files 四端点单测（路径穿越 + 两分支）

## 目标
为 task-08 接线的 4 端点（`GET /files`、`GET /files/content`、`POST /files/content`、`GET /files/pending`）补 HTTP 级单测，覆盖路径穿越拒（D-004@v1）与 path_source 两分支（D-006@v1）。

## 依据
- design.md §5 Phase1/2/3、§7 接口定义、§10 R-02（路径穿越）、D-004/D-006（decisions.md）。
- plan.md Wave6 task-13 行 + 覆盖矩阵 D-004@v1→task-13、D-006@v1→task-13 两分支。
- 现有范式：`backend/app/modules/change/tests/test_router.py`（`workspace_with_changes` fixture：tmp_path 复制 fixture + `POST /api/workspaces` 建工作区 + reparse）。
- conftest.py：`client`/`auth_headers`/`db_session`（SQLite in-memory aiosqlite）、`asyncio_mode=auto`（pyproject.toml:47）、`SPEC_DATA_ROOT`→tempdir。
- service 层负责守卫/截断/分流（task-04/05），本任务只测端点契约（请求/响应/状态码）。

## 测试用例
**list（FR-03）**：建 server-local 工作区 + 变更目录造 `design.md`/`tasks/task-01.md`/`.hidden`/`prototype-x.html` → `GET /files` 返扁平 items，path 含 `tasks/`、`name`/`size`/`is_text` 正确，`.hidden` 排除。
**read（FR-04）**：`GET /files/content?path=design.md` 返 content+exists=True；不存在 path 返 exists=False（不抛 500）；构造 >1MB 文件断言 content 截断到 `MAX_CONTENT_BYTES`（不绑死字面值，断言 `len <= 阈值` 且非空）。
**write 两分支（D-006@v1）**：
- server-local 工作区（`root_path` 包裹布局）→ `POST /files/content` 返 `{status:"done"}` + 落盘可经 read 端点回读校验。
- daemon-client 工作区（mock `is_daemon_client_path_source` 返 True，或造 `path_source="daemon_client"` 工作区 + 在 `SPEC_DATA_ROOT` 下铺镜像）→ 返 `{status:"pending", task_id}` + DB `daemon_change_writes` 出现 `kind="edit"` 行（`GET /files/pending` 能列出）。
**pending（FR-08）**：造 pending + claimed edit 行 → `GET /files/pending` 返回二者；造 `kind="create"` 行 + done 行 → 被过滤掉。
**路径穿越（D-004@v1）**：POST 与 GET content 对 `path` 取 `../../../etc/passwd`、绝对路径 `/etc/passwd`、相对路径指向符号链接（tmp_path 建链指向变更目录外）三类 → 均 4xx（400/404），不落盘不读盘。
**回归 smoke**：现有 `test_list_after_reparse`/`test_get_change_detail`/`test_check_archive_gate`（如已存在）等不受影响——同一文件跑全套 `app/modules/change/tests/` 即覆盖；本文件内再加一条「创建变更 / agent dispatch 端点仍 200」轻断言。

## 约束
- SQLite in-memory（conftest 已就绪），勿引入 PG 方言函数名（[[backend-test-sqlite-vs-pg]]）。
- async 测试函数无需 `@pytest.mark.asyncio`（auto 模式）。
- 遵守 backend CONVENTIONS：测试放宽 N802/N803；ruff 行宽 100。
- daemon-client 镜像卷路径取 `get_settings().spec_data_root` 拼接，勿硬编码 `/data/...`（CI 无权限）。
- mypy `# type: ignore[code]` 后禁中文（[[mypy-type-ignore-no-chinese]]）。

## 验收标准
- `cd backend && python -m pytest app/modules/change/tests/test_files_router.py -v` 全绿。
- `cd backend && python -m pytest app/modules/change/tests/ -q` 零回归（含 test_router.py）。
- `ruff check app/modules/change/tests/test_files_router.py` + `mypy app/modules/change/tests/test_files_router.py`。

## 风险
- daemon-client 镜像直写若在测试环境的 `SPEC_DATA_ROOT`（tempdir）下铺不出目录 → 改 mock `ChangeService.write_file` 内分流判定或直接 mock `is_daemon_client_path_source`（对齐 D-006，不依赖真实 daemon）。
- 符号链接在 Windows 测试机可能需管理员权限 → 用 `pytest.skipif` 或优先用 `../` 绝对路径两类（足以覆盖守卫逻辑，symlink 是补充）。
- 端点路径/方法签名以 task-08 实际接线为准（design §7 是契约，实现微调时按真实签名适配测试）。
