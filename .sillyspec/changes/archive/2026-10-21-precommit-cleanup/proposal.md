---
author: flow-machine-draft
created_at: 2026-10-21T01:35:13.760Z
---
# 提案书（Proposal）— 2026-10-21-precommit-cleanup

## 动机

任务原话转写：清理临时hook面并沉淀沙箱知识

动机：2026-10-21-precommit-sandbox-entries 已让官方 pre-commit 链在 agent 会话可用（默认 .git/hooks + 会话级 PRE_COMMIT_HOME），同会话早期自建的 .tmp/hooks 等价 hook 面完成使命应清理；本次排查实锤的「python 子树 Low IL 限制」与「WSL bash 误解析坑」尚未沉淀进知识库，后续会话会重复踩。

成功标准：
- .tmp/hooks 会话等价 hook 面删除，仓内无任何链路再引用它（配置注释与知识文档统一指向官方链 + export PRE_COMMIT_HOME 会话指引）
- .sillyspec/knowledge 新增「agent 沙箱 python 子树 Low IL 限制」条目：症状（python→msys 嵌套 0xC0000022 崩、profile 缓存写被拒）、根因（沙箱驱动降 IL、token 无 CodexSandboxUsers、DACL 修复无效）、WSL bash 误解析坑（python spawn bash 命中 System32 WSL 而非 Git Bash）、处置（去 msys 入口 + PRE_COMMIT_HOME 会话指引），INDEX 可路由
- sillyspec knowledge search 关键词实证命中；交付提交走默认官方 hook 链留痕

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. .tmp/hooks 会话等价 hook 面删除，仓内无任何链路再引用它（配置注释与知识文档统一指向官方链 + export PRE_COMMIT_HOME 会话指引）
2. .sillyspec/knowledge 新增「agent 沙箱 python 子树 Low IL 限制」条目：症状（python→msys 嵌套 0xC0000022 崩、profile 缓存写被拒）、根因（沙箱驱动降 IL、token 无 CodexSandboxUsers、DACL 修复无效）、WSL bash 误解析坑（python spawn bash 命中 System32 WSL 而非 Git Bash）、处置（去 msys 入口 + PRE_COMMIT_HOME 会话指引），INDEX 可路由
3. sillyspec knowledge search 关键词实证命中；交付提交走默认官方 hook 链留痕

## 成功标准（可验证）

1. .tmp/hooks 会话等价 hook 面删除，仓内无任何链路再引用它（配置注释与知识文档统一指向官方链 + export PRE_COMMIT_HOME 会话指引）
2. .sillyspec/knowledge 新增「agent 沙箱 python 子树 Low IL 限制」条目：症状（python→msys 嵌套 0xC0000022 崩、profile 缓存写被拒）、根因（沙箱驱动降 IL、token 无 CodexSandboxUsers、DACL 修复无效）、WSL bash 误解析坑（python spawn bash 命中 System32 WSL 而非 Git Bash）、处置（去 msys 入口 + PRE_COMMIT_HOME 会话指引），INDEX 可路由
3. sillyspec knowledge search 关键词实证命中；交付提交走默认官方 hook 链留痕
