---
schema_version: 1
doc_type: module-card
module_id: migrations
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 数据库迁移（migrations）

## 定位
Alembic 数据库迁移目录（`backend/migrations/`：env.py + versions/ + script.py.mako），承载全部 schema 演进。现状（2026-08-17 时点核实）：**versions/ 下 143 个 revision 脚本，单 head `20260817100000_merge_quicklog_and_run_sender`**（merge revision），父节点无缺失。

## 契约摘要
- `env.py`：用 `get_settings()` 的同一份配置现场建 async engine 跑迁移（与应用共享 URL/池配置，但不复用应用 lifespan）；支持 autogenerate diff。
- `env.py` 顶部 eager import 全部 feature 模块的 model（admin/agent(+profile)/auth/change/daemon(+audit)/file/git_gateway/git_identity/incident/llm_provider/mcp_gateway/platform_sync/ppm 六子域/release/scan_docs(+conflict)/settings/skills/spec_profile/spec_workspace/task/tool_gateway(+policy)/workflow/workspace），确保 autogenerate 扫到全部表。
- revision 命名混用两种风格：日期时间戳式（`20260817100000`）与 alembic 默认 hex 式（`d7a1f5c2b9e4`）。
- versions/ 内存在多个 merge revision（`d7a1f5c2b9e4_merge_platform_progress_and_session_config` / `dceb0c45ab3e_merge` / `20260817100000_merge_quicklog_and_run_sender` 等），是历史上并行 change 各出迁移后收敛多 head 的痕迹。

## 关键逻辑
```
alembic revision --autogenerate -m "..."   # 前提: 新 model 已在 env.py 登记
alembic upgrade head                       # head = 20260817100000（单 head）
多 head 出现时: alembic merge <heads> 生成 merge revision 收敛
表结构变更走 batch_alter_table（SQLite 兼容场景, 如 20260814220000 加列）
```

## 注意事项
- **新 model 必须先在 env.py import 清单登记再 autogenerate**，否则表不在 metadata、autogenerate 判定多余/漏建（2026-08-14 architecture-4a §8 就是补这个登记）。
- 多 agent 并行 change 各自生成迁移时 `down_revision` 易撞出多 head：提交前核对单 head（alembic heads 或 DAG 脚本），出现多 head 用 merge revision 收敛——历史上至少三次（见 versions/ 内多个 merge 文件）。
- 新 revision 的 `down_revision` 必须指向当时最新 head；日期式编号建议精确到秒避免同日撞号（历史撞号曾迫使另一 change 改号收敛）。
- 迁移文件会被 pre-commit 的 ruff 重排格式，首次 commit 后核对文件真的落盘（历史上有 ruff 重排致 commit 静默不落地先例）。
- 本项目除 PPM 外未正式上线，不要求历史兼容与完整 down-grade，以 head 前进为准。

- 20260825230000_add_quicklog_session_links（2026-08-25-session-spec-binding）：建表 + agent_sessions.change_id 存量播种至 change_session_links（ON CONFLICT DO NOTHING）；downgrade drop 表、播种行保留无害。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
