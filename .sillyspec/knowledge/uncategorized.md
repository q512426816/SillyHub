# 未分类知识

> execute/quick 执行中发现的坑暂存于此，用户审阅后归类到对应文件并更新 INDEX.md。

## 2026-06-03 — Claude Code PreToolUse hook 拦截 git commit

- `.claude/settings.json` 是 Claude Code hook 配置，只会拦截 Claude Code 自己发起的工具调用；普通终端或 IDE 里的 `git commit` 仍然只走 Git hooks。
- Windows 下用 `bash .claude/hooks/*.sh` 容易命中 WSL bash，并且 CRLF shell 脚本会触发 `$'\r': command not found` / `pipefail\r` 错误；跨平台 hook 优先用 `node .claude/hooks/*.cjs`。
- Claude Code `PreToolUse` 推荐用 `hookSpecificOutput.permissionDecision="deny"` 和 `permissionDecisionReason` 阻断工具调用；`continue:false` 是停止后续处理，不等同于 deny 当前 Bash 工具调用。

## 2026-06-03 — pytest patch 函数内局部导入的目标

- 被测函数内部用 `from app.core.db import get_session_factory`（函数级局部导入）时，`patch("app.modules.agent.service.get_session_factory")` 会报 `AttributeError: module does not have the attribute`，因为该名字从未绑定到 service 模块命名空间。
- 正确做法：patch 源头模块属性 `app.core.db.get_session_factory`。局部导入每次执行时从源模块取属性，patch 源头才能拦截。
- 同理适用于任何「函数内 import」的 mock。模块级 import 才 patch 使用方模块。

## 2026-06-03 — 无本地 venv 时在 Docker 后端容器跑 pytest

- 本机只有 Windows Store 的 python stub（exit 49 不执行），项目走 Docker 部署无 venv。
- 主机 F 盘挂载在后端容器 `/host-projects`，git worktree 可经 `/host-projects/WorkNew/SillyHub/.sillyspec/.runtime/worktrees/<change>` 访问。
- 生产镜像 venv 缺 pytest，但 `pip install pytest` 装到 `~/.local`(user-site)，venv python 默认不加载；运行时 `sys.path.insert(0, site.getusersitepackages())` 后 `pytest.main()` 即可。
- 用 `PYTHONPATH=<worktree>/backend` 让测试 import 命中 worktree 改动代码，不污染容器 /app（镜像层）。
- 验证回归：在 `/host-projects/.../backend`(main) 上跑同样测试对比，区分预存失败与本次引入的回归。

## 2026-06-03 — execute 的 worktree 基线不含未提交改动

- `sillyspec worktree create` 从最新 commit（HEAD）干净 checkout，**不包含主工作区里 staged/未提交的改动**。如果上一个变更（如 quick 流程）的代码改动只 `git add` 未 commit，worktree 里看到的是改动前的旧版文件。
- 后果：execute 子代理在 worktree 内基于过时基线实现，可能写出与已存在（但未提交）改动冲突、甚至撤销前序成果的代码。本次 task-04 子代理就因 worktree 内 page.tsx 缺少上一轮 quick 加的 verify_result/module_impact/DOC_LABELS，用了错误的 OPTIONAL_DOCS 列表。
- 规避：execute 前确认相关前序改动已 commit；或像本次一样，发现基线不符时在**主工作区**（正确基线）重做改动、worktree 仅作隔离参考。审查子代理产出时务必对比主工作区当前真实文件，不要盲信子代理"按蓝图实现"的报告。

