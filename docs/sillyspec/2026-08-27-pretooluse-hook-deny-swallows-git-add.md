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
