---
schema_version: 1
doc_type: module-card
module_id: runtime
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# runtime

## 定位
只读聚合器：解析 workspace 对应 SillySpec 运行时目录（`.sillyspec/.runtime` 下的 sqlite + 文件），对外暴露执行进度、用户输入、产物（artifacts）。本身不产生运行时数据，只读 spec_workspace 解析出的运行目录并结构化返回。

## 契约摘要
- `GET /api/workspaces/{workspace_id}/runtime` — 聚合进度（`RuntimeProgress | None`）
- `GET .../runtime/user-inputs` — 结构化用户输入列表（`list[UserInputEntry]`）
- `GET .../runtime/user-inputs/raw` — 原始文本（`PlainTextResponse`）
- `GET .../runtime/artifacts` — 产物清单（`list[ArtifactEntry]`）
- `GET .../runtime/artifacts/{filename}` — 单个产物内容（纯文本）
- `RuntimeService.get_progress/get_user_inputs/get_user_inputs_raw/get_artifacts/get_artifact_content`

## 关键逻辑
```
get_progress(workspace_id):
  base = await _get_base(workspace_id)            # workspace + spec_ws
  runtime_dir = _resolve_runtime_dir(workspace_id, workspace, spec_ws)
  if runtime_dir is None: return None
  db_path = runtime_dir / 'progress.db'
  if db_path.exists(): return _read_sqlite_progress(db_path, runtime_dir)
  return None
```

## 注意事项
- 进度数据来自 `.runtime/progress.db`（sqlite），由外部 agent/daemon 写入；本模块只读，不写
- `_resolve_runtime_dir` 依赖 spec_workspace 解析出的 spec 数据根；repo-native 策略下用 spec_root，其余用 workspace.root_path；spec 未配置则返回 None
- 产物按文件名读取，`get_artifact_content` 用 resolve + startswith 防路径穿越，filename 不能含 `..`/绝对路径
- `response_model_by_alias=False` 用于 progress 端点，控制 camelCase 别名序列化
- 无独立数据库表，纯文件系统 + sqlite 解析；测试需构造 `.runtime` 目录
- 二进制产物以纯文本返回，不可解码字节用 `errors="replace"` 替换

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
