# 坑7：跨仓 change 的 repo: 声明必须内联 plan.md（独立 task 卡不被扫描）

> 发现于 2026-08-15-init-trigger-sillyspec-init execute/verify 阶段。
> 状态：活跃坑，待 sillyspec 工具修复。

## 现象

跨仓 task 的 review.json 写了 `repo: sillyspec` + 跨仓仓真实 base/head commit，Task Review Gate 却报：

```
- task-01: review.repo="sillyspec" 在 MultiRepoContext 未解析到 entry，退回主仓 gitDir 校验
- task-01: base "f13e96..." 不是仓库中的真实 commit — review.json 疑似伪造
```

（base/head 明明在跨仓仓 `git rev-parse --verify` 可达。）

## 根因

`aggregateDeclaredRepos`（`src/run/shared.js`）只扫 **plan.md 文本内出现的 frontmatter 块**（`/^---\r?\n([\s\S]*?)\r?\n---/gm` 逐块 parseRepo），不读 `tasks/task-NN.md` 独立文件。plan 阶段把 task 卡写到 tasks/ 目录、plan.md 只放 checkbox 行时，MultiRepoContext 的 declaredRepos 只有 'main'，跨仓仓未注册进 ctx → 跨仓 review 退回主仓 gitDir 校验必然失败。

报错指向"review 疑似伪造"而非"plan.md 缺内联 repo 声明"，误导排查方向（本坑排查了三层：commit 可达性 → review 格式 → 才到 ctx 解析）。

## 绕过方案（已验证）

plan.md 里每个跨仓 task 的 checkbox 行下追加 frontmatter 块（CLI 自家测试 `test/multi-repo-context-entry.test.mjs` 的 `writeChange` 就是这种格式）：

```markdown
- [x] task-01: CLI --no-skills（repo: sillyspec）

---
id: task-01
repo: sillyspec
base_commit: f13e96da...
head_commit: 00f72179...
---
```

## 建议修复（工具侧）

1. `aggregateDeclaredRepos` 兼扫 tasks/task-NN.md 文件（plan.md 同目录）；或
2. execute 启动构造 MultiRepoContext 时校验"review.json 含非 main repo 但 declaredRepos 无该 repo"→ 显式报错提示内联声明；或
3. plan-postcheck 跨仓对账通过时（local.yaml repos 已注册 + task 卡 repo: 存在）顺带校验 plan.md 内联块存在，缺失即 error。

## 关联

- 坑6-plan-postcheck-隐性格式契约.md（同类：契约靠报错反推）
- 同变更还踩：task 卡 YAML 列表项以反引号开头 → js-yaml 整个 frontmatter 解析失败 → parseRepo 返 null → 同样报"文件未覆盖"（另记 docs/sillyspec/ 待整理，或并入本坑家族）。
