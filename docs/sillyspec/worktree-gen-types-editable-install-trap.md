# worktree 内跑 gen:types 会产出主仓库旧 schema（editable install 陷阱）

- 状态：活跃坑（2026-09-18-single-chat-steering task-09 实证，未修）
- 场景：sillyspec execute worktree 里跑 `pnpm gen:types`（frontend package.json 链内 `python scripts/dump_openapi.py`）
- 根因：主仓库 backend `.venv` 的 editable install（`_editable_impl_multi_agent_platform_api.pth`）指向**主仓库** backend 绝对路径——worktree 里裸跑 dump 脚本时 `import app` 解析到主仓库旧代码，产出**旧 schema**（本次实证：首次 dump 缺 steered/dispatch_mode，看似「后端没生效」的假象）。
- 绕过方案：worktree 内跑生成链前设 `PYTHONPATH=<worktree>/backend` 再调主仓库 venv 的 python（PYTHONPATH 优先于 .pth）。
- 待修建议（工具侧）：`sillyspec worktree doctor` 增加「venv editable 指向检查/自动注入 PYTHONPATH」，或 execute 步骤 prompt 注入该环境变量指引。
- 影响范围：所有需要在 worktree 里跑 OpenAPI/后端导入链的变更（gen:types、dump_openapi、任何 import app 的脚本）。
