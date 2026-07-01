---
author: qinyi
created_at: 2026-07-01 21:30:00
type: sillyspec-tool-bug
---

# sillyspec CLI 平台模式 progress specDir 漂移（progress show 读源码空 db，run 写 daemon db）

## 现象
平台模式（源码目录 `.sillyspec/` 存在 + daemon specDir `~/.sillyhub/daemon/specs/<workspace>/` 为活跃 specDir）下：
- `sillyspec run <stage> --change <X>` 正确写入 **daemon specDir** 的 `.runtime/sillyspec.db`（`changes` 表含 change X）
- `sillyspec progress show --change <X>` 报 `❌ 未找到变更 <X>`——读的是**源码目录** `.sillyspec/.runtime/sillyspec.db`（其 `changes` 表为空）

实证（python sqlite3 直查两 db）：
```
daemon db changes:  ('2026-07-01-changes-align-sillyspec', 'brainstorm', 'active')  ✓
源码 db changes:    (空)
```

## 根因
sillyspec CLI 不同子命令的 specDir 解析逻辑不一致：
- `run` 子命令经平台 pointer（`.sillyspec-platform.json`，status=active）正确重定向到 daemon specDir
- `progress show` 子命令读源码目录 `.sillyspec/.runtime/sillyspec.db`（未走平台 pointer 重定向）

## 影响范围
- 平台模式下 `sillyspec progress show` 完全不可用（永远"未找到变更"）
- 平台后端 `dispatch.py:sync_stage_status` 读 sillyspec.db 用自己的 `_resolve_db_path`（line 1283）多候选解析（优先 SpecWorkspace.spec_root → daemon db，fallback workspace.root_path → 源码 db），**平台侧已规避**——不依赖 CLI `progress show`
- 用户/AI 在平台模式下用 `sillyspec progress` 系列命令会误判状态（需用 python 直查 daemon db 或平台 API）

## 复现步骤
```bash
# 平台模式（源码目录有 .sillyspec/ + daemon specDir 活跃）
cd <repo-with-.sillyspec/>
sillyspec run brainstorm --change <change-name>   # 写入 daemon db ✓
sillyspec progress show --change <change-name>    # ❌ 未找到变更（读源码空 db）

# 验证
python -c "import sqlite3; print(list(sqlite3.connect('<daemon-specDir>/.runtime/sillyspec.db').execute('SELECT name FROM changes')))"
python -c "import sqlite3; print(list(sqlite3.connect('<repo>/.sillyspec/.runtime/sillyspec.db').execute('SELECT name FROM changes')))"
```

## 建议修复（待工具作者）
- `progress show` 等查询命令应与 `run` 子命令共用 specDir 解析逻辑，遵循 `.sillyspec-platform.json` pointer 重定向到 daemon specDir。
- 或：所有 CLI 子命令统一经 `SpecPathResolver` / 平台 pointer 解析，而非各自硬编码。

## 本项目规避
- 平台后端 `dispatch.py:_resolve_db_path`（已 task-05 强化）优先返回 daemon specDir 的 `.runtime/sillyspec.db`，sync_stage_status 用它读 stage 真相。
- 用户在平台模式下查 stage 状态用平台 API（读 Hub changes.current_stage 缓存）或 python 直查 daemon db，不用 `sillyspec progress show`。

## 关联
- 与 `docs/sillyspec/runtime-cleanup-destroys-worktree-meta.md` 同属 sillyspec CLI 平台模式缺陷（已 3.20.5 修复 worktree 清理问题；specDir 漂移待修复）。
