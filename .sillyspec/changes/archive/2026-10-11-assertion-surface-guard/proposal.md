---
author: flow-machine-draft
created_at: 2026-10-12T00:18:35.482Z
---
# 提案书（Proposal）— 2026-10-11-assertion-surface-guard

## 动机

任务原话转写：动机：共享断言面漏同步钉子测试已是复发 4+ 次的模式（2026-10-07/08 两轮 14 失败中 9 处 + 本周 CI 清偿又见迁移锚/TABS 数/声明序/MSG 计数四处）——知识库六面清单与源码注释属提醒性防呆，实证拦不住；需要机制化闸门，在 pre-commit 阶段对触碰断言面源文件而未同步钉子测试的提交 fail-closed。

成功标准：
- scripts/check-assertion-surfaces.py：8 条规则（六面清单 + 本周新登记的菜单注册表/协议 MSG），触发模式区分 FILE（迁移文件新增）与 DIFF 内容（TABS 条目行、menuKey 行、daemon: 常量行、_sendHeartbeatOnce、agent_kinds、export 行、caps 形状行），命中触发而配对测试文件不在 staged 面则 exit 1 并打印同步指引
- scripts/test_check_assertion_surfaces.py 单元测试覆盖规则匹配纯函数（照 scan-drift-check 测试先例 importlib 加载），定向 pytest 绿
- backend/.pre-commit-config.yaml 增 check-only hook（always_run，不修改文件，与既有 ruff 双钩同款风格）
- 知识库 testing-gotchas 登记⑦菜单注册表⑧协议 MSG 两新面 + 通用口径补机制化闸门说明；两新面源码处加同步提醒注释
- 脚本与 hook 兼容 Windows Git Bash / Linux（规则 13）；不跑全量测试（规则 0）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. scripts/check-assertion-surfaces.py：8 条规则（六面清单 + 本周新登记的菜单注册表/协议 MSG），触发模式区分 FILE（迁移文件新增）与 DIFF 内容（TABS 条目行、menuKey 行、daemon: 常量行、_sendHeartbeatOnce、agent_kinds、export 行、caps 形状行），命中触发而配对测试文件不在 staged 面则 exit 1 并打印同步指引
2. scripts/test_check_assertion_surfaces.py 单元测试覆盖规则匹配纯函数（照 scan-drift-check 测试先例 importlib 加载），定向 pytest 绿
3. backend/.pre-commit-config.yaml 增 check-only hook（always_run，不修改文件，与既有 ruff 双钩同款风格）
4. 知识库 testing-gotchas 登记⑦菜单注册表⑧协议 MSG 两新面 + 通用口径补机制化闸门说明；两新面源码处加同步提醒注释
5. 脚本与 hook 兼容 Windows Git Bash / Linux（规则 13）；不跑全量测试（规则 0）

## 成功标准（可验证）

1. scripts/check-assertion-surfaces.py：8 条规则（六面清单 + 本周新登记的菜单注册表/协议 MSG），触发模式区分 FILE（迁移文件新增）与 DIFF 内容（TABS 条目行、menuKey 行、daemon: 常量行、_sendHeartbeatOnce、agent_kinds、export 行、caps 形状行），命中触发而配对测试文件不在 staged 面则 exit 1 并打印同步指引
2. scripts/test_check_assertion_surfaces.py 单元测试覆盖规则匹配纯函数（照 scan-drift-check 测试先例 importlib 加载），定向 pytest 绿
3. backend/.pre-commit-config.yaml 增 check-only hook（always_run，不修改文件，与既有 ruff 双钩同款风格）
4. 知识库 testing-gotchas 登记⑦菜单注册表⑧协议 MSG 两新面 + 通用口径补机制化闸门说明；两新面源码处加同步提醒注释
5. 脚本与 hook 兼容 Windows Git Bash / Linux（规则 13）；不跑全量测试（规则 0）
