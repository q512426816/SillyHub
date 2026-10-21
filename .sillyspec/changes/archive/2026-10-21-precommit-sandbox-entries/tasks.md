---
author: flow-machine-draft
created_at: 2026-10-21T01:23:19.299Z
---
# 任务注册表（Tasks）— 2026-10-21-precommit-sandbox-entries

- [x] task-01: pre-commit 三条 entry（ruff-format/ruff-check/assertion-surfaces）去 bash -c 包装改直连命令，uv 加 --cache-dir 重定向进仓内 .tmp/（gitignored），pre-push 两条既有语义不动
- [x] task-02: 官方 runner 在 agent python 子树内实跑通过：PRE_COMMIT_HOME 指向仓内时 pre_commit run assertion-surfaces 与 ruff-check 均正常出结果（不再 msys 崩）
- [x] task-03: hook 配置合法（pre-commit validate-config），scripts/ 断言面闸门语义不变
