---
author: WhaleFall
created_at: 2026-08-27 14:23:13
stage: quick
severity: low（漏提交可事后核对发现，但静默漏文件易污染提交粒度）
---

# PreToolUse hook deny 会吞掉同命令里的 git add——重试 commit 时漏 re-add

- 日期：2026-08-27
- 变更：quick-6afdc8ef（ql-20260827-008-70cf）
- 状态：活跃（hook 机制固有行为，流程侧规避有效）

## 现象

quick 收尾惯用一条命令完成暂存 + 提交：

```bash
git add .sillyspec/quicklog/QUICKLOG-WhaleFall.md && git commit -m "..."
```

`.claude/hooks/pre-commit-ci-check.cjs`（PreToolUse matcher=Bash）检测到命令含
`git commit` 且 staged/工作区有 `frontend/` 文件 → 先跑 `pnpm lint/typecheck/test`，
`frontend: test` 瞬时抖动失败 → **deny 整条 Bash 调用**：

```
Local CI checks failed; git commit was blocked:
- frontend: test
```

复现修好后重试时只跑了 `git commit`（没带 `git add`），结果 commit 只含 2 个文件，
QUICKLOG 文件静默漏提交（靠 `git status --porcelain` + `git show --stat` 核对才发现，
补了一个 docs commit）。

## 根因

PreToolUse 的 deny 是**工具调用级拦截**——整条命令根本没有执行，包括 `&&` 链前面的
`git add`。deny 理由只说「commit was blocked」，对「add 也没跑」只字未提，心智上容易
把这次失败当成「commit 这一步失败了」，重试自然只重跑 commit。

## 影响

- 漏 add 的文件留在暂存区外，重试 commit 静默成功且内容不完整（本次 QUICKLOG 漏提交）；
- 更隐蔽场景：add 的是**首次纳入**的新文件时，重试 commit 可能提交出「旧暂存 + 缺新文件」
  的组合，破坏提交粒度（quick 收尾代码 + 记录应同批的惯例被打散）。

## 规避（流程侧，已验证有效）

1. **add 与 commit 分两条命令发**——add 先行落定，commit 单独被拦也不伤暂存区；
2. 一条命令夹带 add 时，被 deny 后重试**必须从 add 重发整链**；
3. commit 后必查 `git show --stat --oneline HEAD` 对照预期文件数，不符即补提交；
4. `frontend: test` 瞬时抖动（全量 vitest 资源竞争）重跑即可过，不是代码债。

## 建议工具/hook 侧改进

- hook 的 deny 理由追加一句提示：「整条命令未执行（含其中的 git add），重试请从
  git add 重新发起」——一行文案即可消除歧义；
- 或 sillyspec quick 技能的收尾指引明确「git add 与 git commit 分离发送」。

## 同族坑第二例（2026-08-27 14:38 实证，ql-20260827-011 会话）

**多 agent 共享暂存区竞态：commit 夹带并发会话的暂存内容。**

时序：我 `git add` 自己的 3 个文件 → commit 被 hook deny → 手动跑全量
`pnpm test`（~4 分钟）→ 期间并发 quick 会话（ql-20260827-010-e472，daemon 附件
内容寻址）完成 `--done` 收尾，把它自己的 6 个文件 add 进**同一个共享暂存区** →
我重试 commit，8 个文件一起被提交，commit message 却只描述我的前端改动。

- 根因：多 agent 共用同一工作区/暂存区，`git commit` 提交的是「commit 执行时刻的
  整个暂存区」，不含任何归属信息；hook 拦截拉长的窗口放大了竞态；
- 影响：commit 语义与内容不符（message 说前端、内容含 daemon）；并发会话随后
  commit 会发现「nothing to commit」；
- 规避：① commit 后必查 `git show --stat HEAD` 对照预期文件数（本次靠它发现）；
  ② 发现夹带且未 push 时，`git commit --amend` 改 message 如实记录夹带内容
  （只改 message 不动内容，竞态窗口最小；内容分离 reset --soft 竞态风险更高，
  多 agent 环境不推荐）；③ 收尾 commit 尽量避开长测试窗口，被 deny 后优先
  重试 commit（抖动），把手动复现测试放在确认需要修的时候。

## 同族坑第三例（2026-08-27 15:3x 实证，ql-20260827-014 会话，已修复）

**hook spawnSync maxBuffer 默认 1MB：vitest 全量输出攒满即杀子进程 →
"frontend: test failed" 连续误拦。**

症状：commit 连续 4+ 次被拦 `frontend: test`，但 bash/cmd/node 手动跑全量
2576 测试始终全绿；hook 直跑日志显示 vitest 输出中途戛然而止（无 Test Files
汇总、status=null、死点随机）、无 OOM/SIGTERM 痕迹。

- 根因：`pre-commit-ci-check.cjs` 的 `run()` 用 `spawnSync(cmd, [], {shell:true})`
  未设 maxBuffer（node 默认 1MB）——vitest 全量 stdout+stderr（jsdom
  Not implemented 噪音刷屏）轻松超 1MB，攒满瞬间子进程被杀，status=null≠0
  → runCheck 判 failed → deny。14:11 之前能过是当时输出量未过线；测试套件
  增长后稳定踩线。**此前记录的「并发资源竞争」结论有误，此为真根因。**
- 修复（d8e867db 已落）：spawnSync 加 `maxBuffer: 64*1024*1024`；
  顺带 settings.json hook timeout 300→600s（三连最坏情况余量）。
- 教训：node `spawnSync`/`execSync` 收集大输出必须显式设 maxBuffer——
  被杀时无任何错误消息（status=null、signal 可能空），极易误诊为测试抖动。


