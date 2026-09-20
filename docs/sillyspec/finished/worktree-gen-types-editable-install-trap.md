# worktree 内跑 gen:types 会产出主仓库旧 schema（editable install 陷阱）

- 状态：活跃坑（2026-09-18-single-chat-steering task-09 实证，未修）
- 场景：sillyspec execute worktree 里跑 `pnpm gen:types`（frontend package.json 链内 `python scripts/dump_openapi.py`）
- 根因：主仓库 backend `.venv` 的 editable install（`_editable_impl_multi_agent_platform_api.pth`）指向**主仓库** backend 绝对路径——worktree 里裸跑 dump 脚本时 `import app` 解析到主仓库旧代码，产出**旧 schema**（本次实证：首次 dump 缺 steered/dispatch_mode，看似「后端没生效」的假象）。
- 绕过方案：worktree 内跑生成链前设 `PYTHONPATH=<worktree>/backend` 再调主仓库 venv 的 python（PYTHONPATH 优先于 .pth）。
- 待修建议（工具侧）：`sillyspec worktree doctor` 增加「venv editable 指向检查/自动注入 PYTHONPATH」，或 execute 步骤 prompt 注入该环境变量指引。
- 影响范围：所有需要在 worktree 里跑 OpenAPI/后端导入链的变更（gen:types、dump_openapi、任何 import app 的脚本）。

## 处置记录（2026-09-19 定时收口，双面落地，归档）

- **Prompt 侧（主修）已实现**（sillyspec 仓 `src/stages/execute.js` buildWavePrompt worktree 段）：新增「Python 后端导入链陷阱」警示——worktree 内跑 `import app` / dump_openapi / gen:types 类命令用主仓 venv 时 editable install 指向主仓绝对路径、`import app` 静默解析旧代码的机制说明 + **轻量出口 `PYTHONPATH=<worktree>/backend`**（PYTHONPATH 优先于 .pth）+ doctor 检查指引。有 worktree 才注入（无 worktree 零变化）；实证注入 PASS / 无 worktree 零注入 PASS。
- **Doctor 侧文案升级**（`src/worktree.js` editable-install-escape 检查——2026-08-25 已内建，本坑是该坑的 worktree 外主仓 venv 变体）：修复指引从单一「worktree 内重装」扩为「轻量 PYTHONPATH 出口优先 + 彻底重装兜底」两级。
- **机制说明**：本坑场景（worktree 无自建 venv、junction/裸调主仓 venv）不触发 doctor 的 editable-install-escape（它查 worktree 内 venv）——prompt 警示是该场景的主防线，doctor 覆盖自建 venv 变体，两者互补。
- 验证：execute prompt 回归 15/15 绿 + 注入门控双 PASS。归档。
