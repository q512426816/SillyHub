# SillySpec quick 平台模式改代码后状态重置（progress 回退 Step 1）

author: qinyi
created_at: 2026-07-12 23:10:00

## 现象

平台模式（specDir=~/.sillyhub）下，`sillyspec run quick` 启动时记录边界（allowedFiles + 脏文件数）。Step 1/2 --done 后改代码（Edit allowedFiles 中的文件）→ 该文件变脏 → 再次 `sillyspec run quick`（不带 --done，如查 prompt）或某些 --done 时，CLI 检测到"边界变化"（脏文件数从 0→1，提示"🛡️ quick 变更边界已记录: 1 个已有脏文件"）→ **progress 重置回 Step 1/3**，之前 --done 的 Step 1/2 进度丢失。

ql-20260712-002-mcpwin 修复 mcp-server.ts 时触发：Step 1/2 已 --done，改代码后查 prompt（sillyspec run quick），status 显示 0/3 Step 1。

## 根因

quick session 状态跨 CLI 进程靠 `--change <sessionId>` 传递（CLI 是短进程）。平台模式下 quick 启动记录 worktree 边界（allowedFiles + 脏文件快照），改代码后脏文件变化，再次 run 时 CLI 重新初始化边界疑似触发 progress 重置（session 状态持久化在平台模式下不稳定，或边界变化被视为新 session）。

## 绕过

- 改代码后**直接 --done 当前 step**（不跑 `sillyspec run quick` 查 prompt），用 sessionId 串：`sillyspec run quick --done --change <sessionId> --input ... --output ...`
- 若已重置，重新 --done 各 step（Step 1 理解任务 / Step 2 实现验证 / Step 3 暂存更新），**代码改动仍在 working tree 不丢**，只是流程状态重走
- 必须带 `--change <sessionId>`（多 session 并发时 fallback 读 current-quick-run-id 不可靠）

## 关联

ql-20260712-002-mcpwin（mcp-server.ts isMain 修复时触发）。同类 progress 回退见 finished/execute-worktree-platform-gaps.md（execute Step 10 reset 回 Step 1）+ finished/quick-baseline-blocks-dirty-worktree.md。
