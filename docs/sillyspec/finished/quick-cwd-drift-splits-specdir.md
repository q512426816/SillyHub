---
author: qinyi
created_at: 2026-07-30 11:05:00
title: quick 跑测试 cd 子项目后 cwd 漂移致 specDir 分裂（frontend/.sillyspec 独立实例）
status: 已解决（2026-07-30 工具加 fail-fast 守卫）
---

# quick：cd frontend 跑测试后未回根目录，sillyspec --done 操作子项目 .sillyspec 致 session 分裂

> **✅ 已解决（2026-07-30，sillyspec v3.25.5+）**：`src/run/shared.js` 新增 `detectQuickSessionDrift`（+ `ancestorSpecDirs`/`locateQuickSessionGuard`），`src/run/command.js` 在 quick `--done`/`--status` 接入 **fail-fast 守卫**——当前 specBase 无本 session guard、但祖先链别处 specBase 有同 sessionId guard = 跨 specDir 漂移 → `exit 2` 拦截。平台模式 / 显式 `--spec-dir` / 新会话首次启动（别处无 guard）均放行，不误伤。`src/run/stage.js` guard 加 `specDir` 锚定。测试 `test/quick-cwd-drift-guard.test.mjs` + 端到端 smoke（漂移 `exit 2` / 同 specDir 放行推进 Step 1/3）双验证。下方「补救/预防」为工具修复前的 agent 纪律，保留备查。

## 现象（2026-07-30 ql-20260730-001）
quick 启动时 cwd=项目根，guard 正常建在 `.sillyspec/.runtime/quick-sessions/<id>/guard.json`，QUICKLOG「进行中」条目写根。
随后为跑测试执行 `cd frontend && pnpm exec vitest/tsc`，cwd 漂移到 frontend。接着**不带 cd** 直接跑 `sillyspec run quick --done`，CLI 按 cwd 把 specDir 解析成 **`frontend/.sillyspec`**（monorepo 子项目有独立 sillyspec 实例：自己 db/progress/QUICKLOG），于是：
- step1/step2 的 artifact 落 `frontend/.sillyspec/.runtime/artifacts/`、progress 推进的是 frontend 实例；
- 根 `.sillyspec` 的 quick session 进度停滞（根 progress.json 仍 1/3），根 QUICKLOG **从未写入** ql 条目；
- 最后回根跑 step3 --done 报 `QUICKLOG 条目 ql-... 不存在`，完成校验失败。

## 根因
sillyspec 按 **cwd** 推断 specRoot。monorepo 里 `frontend/` 是被 sillyspec 独立扫描过的子项目，带独立 `.sillyspec`。cwd 一旦进入子项目，所有 quick 命令（启动 / --done / --status）都操作子项目实例，与项目根 session 完全分裂。guard/sessionId 靠 `--change <id>` 全局复用，但 progress / QUICKLOG / artifact 按 specDir 落盘 → 分裂。

## 补救（已验证 2026-07-30）
1. `cd` 回项目根（绝对路径），后续所有 sillyspec 命令都用 `cd "<项目根绝对路径>" && sillyspec ...` 前缀，杜绝再漂移。
2. 根 progress 停在哪步用 `sillyspec run quick --status --change <id>` 确认（回根 cwd 跑）。
3. 在根重跑缺失的 step --done（`--allow-new --files` 补全）逐 step 推进。
4. 若 step3 --done 拦 `QUICKLOG 条目不存在`：手动把 ql 条目骨架（状态=进行中）追加到根 `.sillyspec/quicklog/QUICKLOG-<user>.md`，再重跑 step3 --done，CLI 会翻「已完成」。
5. CLI 翻状态时会把「文件：」行改写成单行逗号路径，需手动精修回多行 bullet（quick 精修契约）。
6. 清理 `frontend/.sillyspec/.runtime/artifacts/<id>-quick-step*.txt` 漂移产物（子项目实例既有，只删本次 id 的两个文件）。

## 预防
跑 monorepo 测试务必用 `cd "<绝对路径>" && ...`；**跑完测试 cd 回根再碰 sillyspec CLI**。或测试命令也用绝对路径 cd，避免 cwd 持久化跨命令漂移（exec 工具 working directory persists between calls）。

关联记忆 `sillyspec-quick-done-unreliable-specroot`、`sillyspec-cli-path-nvm-broken`。
