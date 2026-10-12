---
author: flow-machine-draft
created_at: 2026-10-12T00:18:35.482Z
---
# 任务注册表（Tasks）— 2026-10-11-assertion-surface-guard

- [x] task-01: scripts/check-assertion-surfaces.py：8 条规则（六面清单 + 本周新登记的菜单注册表/协议 MSG），触发模式区分 FILE（迁移文件新增）与 DIFF 内容（TABS 条目行、menuKey 行、daemon: 常量行、_sendHeartbeatOnce、agent_kinds、export 行、caps 形状行），命中触发而配对测试文件不在 staged 面则 exit 1 并打印同步指引
- [x] task-02: backend/tests/test_check_assertion_surfaces.py 单元测试覆盖规则匹配纯函数（照 scan-drift-check 测试先例 importlib 加载），定向 pytest 绿
- [x] task-03: backend/.pre-commit-config.yaml 增 check-only hook（always_run，不修改文件，与既有 ruff 双钩同款风格）
- [x] task-04: 知识库 testing-gotchas 登记⑦菜单注册表⑧协议 MSG 两新面 + 通用口径补机制化闸门说明；两新面源码处加同步提醒注释
- [x] task-05: 脚本与 hook 兼容 Windows Git Bash / Linux（规则 13）；不跑全量测试（规则 0）
