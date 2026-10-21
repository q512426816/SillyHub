---
author: flow-machine-draft
created_at: 2026-10-21T01:35:13.760Z
---
# 任务注册表（Tasks）— 2026-10-21-precommit-cleanup

- [x] task-01: .tmp/hooks 会话等价 hook 面删除，仓内无任何链路再引用它（配置注释与知识文档统一指向官方链 + export PRE_COMMIT_HOME 会话指引）
- [x] task-02: .sillyspec/knowledge 新增「agent 沙箱 python 子树 Low IL 限制」条目：症状（python→msys 嵌套 0xC0000022 崩、profile 缓存写被拒）、根因（沙箱驱动降 IL、token 无 CodexSandboxUsers、DACL 修复无效）、WSL bash 误解析坑（python spawn bash 命中 System32 WSL 而非 Git Bash）、处置（去 msys 入口 + PRE_COMMIT_HOME 会话指引），INDEX 可路由
- [x] task-03: sillyspec knowledge search 关键词实证命中；交付提交走默认官方 hook 链留痕
