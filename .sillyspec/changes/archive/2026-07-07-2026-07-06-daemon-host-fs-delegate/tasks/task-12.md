---
id: task-12
title: runtime _resolver_for 重构（runtime/service.py:43）（覆盖：FR-04）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/runtime/service.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [stat, read_file, list_dir]
goal: >
  把 runtime/service.py 中所有对宿主文件系统的 stat / read 操作改为统一走 HostFsDelegate（daemon-client 经 WS RPC 读宿主 spec_root/.runtime/，server-local 本地容器直接做），_resolver_for 的 root/mode 选择逻辑保留不动。
implementation:
  - "定位现有宿主访问点（grep runtime/service.py 内 Path / .is_file / .is_dir / .read_text / .iterdir / .stat() / sqlite3.connect）：get_progress / get_user_inputs / get_user_inputs_raw / get_artifacts / get_artifact_content，_resolver_for 本身无 fs 操作不改"
  - "构造 HostFsDelegate：__init__ 增加 host_fs: HostFsDelegate | None 注入（与 session/ws_hub 一起），保留 None 时退回旧行为以便 server-local / 测试平滑过渡（参考 task-01 provider 契约）"
  - "替换宿主访问（host_fs 可用时走委托，不可用时回退原 Path 行为 = server-local 分支）：db_path().is_file() 改 host_fs.stat 取 exists/size（保留 0 字节兜底逻辑不动）；SQLite 读取 daemon-client 经 host_fs.read_file 取回 db 内容临时落地或内存打开、server-local 保持 sqlite3.connect(file mode=ro)；user-inputs.md 改 host_fs.read_file；artifacts/ 列举改 host_fs.list_dir + stat；artifact_path 越界 startswith 校验保留（路径规范化不依赖 fs 仍本地做，只把 is_file/read_text 换 RPC）"
  - "相对路径计算：resolver 仍负责给出绝对路径（task-16 行为保留）；HostFsDelegate 调用前由 resolver root + 相对段算出 daemon 侧能解析的相对/绝对路径（task-01 决定路径入参形态，蓝图 expects_from 已声明 stat/read_file/list_dir 三方法）"
  - "去散落 if：path_source 分流内聚到 HostFsDelegate（task-01 已做），runtime 侧不写 if path_source != 'daemon-client'，只判 host_fs is not None"
acceptance:
  - "daemon-client runtime 页能读 .runtime/sillyspec.db（task-16 修过的「不返空」行为保持），stage/step/user-inputs/artifacts 全部可见（root 走 spec_root 忽略 strategy 的规则不变）"
  - "sillyspec.db 0 字节兜底逻辑不动（size==0 或不存在 → 返回 None，不报错）"
  - "grep -n \"path_source != .*daemon-client\" backend/app/modules/runtime/ 无命中（无散落 if）"
  - "server-local 模式零回归：现有 _read_sqlite_progress / artifacts 单测全绿（host_fs=None 走旧 Path 分支）"
verify:
  - "cd backend && uv run pytest app/modules/runtime/ -q"
  - "新增 daemon-client 分支单测（mock HostFsDelegate stat 返 exists+size / read_file 返 db 内容 / list_dir 返 artifacts 列表），覆盖 db 存在、db 0 字节、db 缺失、artifacts 空、artifact 越界拒绝 5 个用例"
constraints:
  - "daemon-client root 解析规则保留（spec_root 忽略 strategy，task-16 已修行为零回归）"
  - "sillyspec.db 0 字节兜底逻辑不动"
  - "仅重构宿主访问层（stat/read/list），SQLite 解析逻辑（_read_sqlite_progress SQL / _parse_dt / 越界校验）不变"
  - "HostFsDelegate 接口契约遵循 task-01（stat/read_file/list_dir），不在本 task 扩接口"
---

# task-12 — runtime `_resolver_for` 链路 HostFsDelegate 重构

## goal

把 `runtime/service.py` 中所有对宿主文件系统的 stat / read 操作（`sillyspec.db` 存在性判断、SQLite 只读连接、`user-inputs.md` / `artifacts/` 读取）从「resolver 给本地路径 + 后端容器直接 `Path.*`」改为统一走 `HostFsDelegate`：daemon-client 模式经 WS RPC 在宿主 `spec_root/.runtime/` 下读，server-local 模式本地容器直接做（path_source 分流，D-004 零回归）。

`_resolver_for`（service.py:43-82）的 root/mode 选择逻辑（task-16 已修：daemon-client 强制 `spec_ws.spec_root` 忽略 strategy）**保留不动**，只把下游的宿主访问替换。

## implementation

1. **定位现有宿主访问点**（grep `runtime/service.py` 内 `Path` / `.is_file` / `.is_dir` / `.read_text` / `.iterdir` / `.stat()` / `sqlite3.connect`）：
   - `get_progress`（service.py:104-106）：`resolver.db_path().is_file()` + `_read_sqlite_progress`（`sqlite3.connect` 直连容器路径）。
   - `get_user_inputs`（service.py:214-219）：`ui_path.is_file()` + `ui_path.read_text()`。
   - `get_user_inputs_raw`（service.py:239-243）：同上。
   - `get_artifacts`（service.py:254-269）：`artifacts_dir.is_dir()` + `iterdir()` + `f.stat()`。
   - `get_artifact_content`（service.py:282-286）：`artifact_path.is_file()` + `read_text()`。
   - `_resolver_for` 本身（service.py:43-82）：只返回 resolver，**无 fs 操作**，不改。

2. **构造 HostFsDelegate**：`__init__` 增加 `host_fs: HostFsDelegate | None` 注入（与 session/ws_hub 一起），保留 None 时退回旧行为以便 server-local / 测试平滑过渡（参考 task-01 provider 契约）。

3. **替换宿主访问**（`host_fs` 可用时走委托，不可用时回退原 Path 行为 = server-local 分支）：
   - `db_path().is_file()` → `await host_fs.stat(workspace, db_path_rel)` 取 `exists`/`size`（保留 sillyspec.db 0 字节兜底逻辑：size==0 或 not exists → return None，**不动**）。
   - SQLite 读取：daemon-client 时经 `host_fs.read_file(workspace, db_path_rel)` 取回 db 内容 → 临时落地 / 内存打开（uri=ro 不适用，改 `sqlite3.connect(":memory:")` 或 tmp 文件，单测覆盖）；server-local 保持 `sqlite3.connect(f"file:...?mode=ro")`。
   - `user-inputs.md` 读取 → `host_fs.read_file`。
   - `artifacts/` 列举 → `host_fs.list_dir(workspace, artifacts_rel)`；条目 `size`/`mtime` 走 `host_fs.stat`（逐项或一次返回，按 task-01 接口定）。
   - `artifact_path` 越界校验（service.py:280 `startswith(artifacts_dir)`）**保留**：路径规范化逻辑不依赖 fs，仍本地做；只把 `is_file` / `read_text` 换 RPC。

4. **相对路径计算**：resolver 仍负责给出绝对路径（task-16 行为保留）；HostFsDelegate 调用前由 resolver root + 相对段算出 daemon 侧能解析的相对/绝对路径（task-01 决定路径入参形态，蓝图 `expects_from` 已声明 `stat/read_file/list_dir` 三方法）。

5. **去散落 if**：path_source 分流内聚到 `HostFsDelegate`（task-01 已做），runtime 侧**不写** `if path_source != 'daemon-client'`，只判 `host_fs is not None`。

## 验收标准

- daemon-client runtime 页能读 `.runtime/sillyspec.db`（task-16 修过的「不返空」行为保持），stage/step/user-inputs/artifacts 全部可见（runtime-read-broken-daemon-client 记忆：root 走 spec_root 忽略 strategy 的规则不变）。
- sillyspec.db 0 字节兜底逻辑不动（size==0 或不存在 → 返回 None，不报错）。
- `grep -n "path_source != .*daemon-client" backend/app/modules/runtime/` 无命中（无散落 if）。
- server-local 模式零回归：现有 `_read_sqlite_progress` / artifacts 单测全绿（host_fs=None 走旧 Path 分支）。

## verify

```bash
cd backend && uv run pytest app/modules/runtime/ -q
```

补：新增 daemon-client 分支单测（mock HostFsDelegate stat 返 exists+size / read_file 返 db 内容 / list_dir 返 artifacts 列表），覆盖 db 存在、db 0 字节、db 缺失、artifacts 空、artifact 越界拒绝 5 个用例。

## constraints

- daemon-client root 解析规则保留（spec_root 忽略 strategy，task-16 已修行为零回归）。
- sillyspec.db 0 字节兜底逻辑不动。
- 仅重构宿主访问层（stat/read/list），SQLite 解析逻辑（`_read_sqlite_progress` SQL / `_parse_dt` / 越界校验）不变。
- HostFsDelegate 接口契约遵循 task-01（`stat`/`read_file`/`list_dir`），不在本 task 扩接口。
