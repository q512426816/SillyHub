---
author: flow-machine-draft
created_at: 2026-10-21T01:23:19.299Z
---
# 提案书（Proposal）— 2026-10-21-precommit-sandbox-entries

## 动机

任务原话转写：pre-commit钩子入口沙箱会话适配

动机：本机排查实锤（本变更前序探针）——agent 沙箱把 python.exe 子树 IL 降为 Low（嵌套 token 无 CodexSandboxUsers、写 profile 被驱动层白名单拦），官方 pre-commit runner 的 bash -c 包装入口在 python 子树内嵌套 msys 必崩（NtCreateDirectoryObject 0xC0000022）、uv 默认缓存写 AppData 被拒，hook 链在 agent 会话不可用只能靠 .tmp/hooks 等价面（5bbb1a830 留痕同症）。

成功标准：
- pre-commit 三条 entry（ruff-format/ruff-check/assertion-surfaces）去 bash -c 包装改直连命令，uv 加 --cache-dir 重定向进仓内 .tmp/（gitignored），pre-push 两条既有语义不动
- 官方 runner 在 agent python 子树内实跑通过：PRE_COMMIT_HOME 指向仓内时 pre_commit run assertion-surfaces 与 ruff-check 均正常出结果（不再 msys 崩）
- hook 配置合法（pre-commit validate-config），scripts/ 断言面闸门语义不变

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. pre-commit 三条 entry（ruff-format/ruff-check/assertion-surfaces）去 bash -c 包装改直连命令，uv 加 --cache-dir 重定向进仓内 .tmp/（gitignored），pre-push 两条既有语义不动
2. 官方 runner 在 agent python 子树内实跑通过：PRE_COMMIT_HOME 指向仓内时 pre_commit run assertion-surfaces 与 ruff-check 均正常出结果（不再 msys 崩）
3. hook 配置合法（pre-commit validate-config），scripts/ 断言面闸门语义不变

## 成功标准（可验证）

1. pre-commit 三条 entry（ruff-format/ruff-check/assertion-surfaces）去 bash -c 包装改直连命令，uv 加 --cache-dir 重定向进仓内 .tmp/（gitignored），pre-push 两条既有语义不动
2. 官方 runner 在 agent python 子树内实跑通过：PRE_COMMIT_HOME 指向仓内时 pre_commit run assertion-surfaces 与 ruff-check 均正常出结果（不再 msys 崩）
3. hook 配置合法（pre-commit validate-config），scripts/ 断言面闸门语义不变
