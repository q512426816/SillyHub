---
author: flow-machine-draft
created_at: 2026-10-11T15:25:27.215Z
---
# 需求规格（Requirements）— 2026-10-11-assertion-surface-guard

## 功能需求

### FR-01: scripts/check-assertion-surfaces.py：8 条规则（六面清单 + 本周新登记的菜单注册表/协议 MSG），触发模式区分 FILE（迁移文件新增）与 DIFF 内容（TABS 条目行、menuKey 行、daemon: 常量行、_sendHeartbeatOnce、agent_kinds、export 行、caps 形状行），命中触发而配对测试文件不在 staged 面则 exit 1 并打印同步指引

- 闸门脚本必须实现 8 条断言面规则（RULES 与 knowledge/testing-gotchas.md 清单一一对应）：迁移为 FILE 模式（staged 面出现 versions/*.py 即触发），其余 7 条为 DIFF 内容锚模式（staged diff 增删行命中锚才触发，防注释级误拦）；命中触发而任一配对钉子测试不在 staged 面时必须 exit 1 并逐条打印缺失文件与同步指引，全部同步或未触发时必须 exit 0。

#### 场景：主路径

- Given：staged 面含契约源改动（如 protocol.ts 加 MSG 常量行）。
- When：闸门运行。
- Then：配对测试未同提交 → exit 1 + 指引；测试同提交 → exit 0。

#### 场景：注释级改动不误拦

- Given：契约源仅注释行变更（不含内容锚形态，如 `// 值形如 daemon:xxx` 说明文字）。
- When：闸门运行。
- Then：不触发、exit 0。

### FR-02: backend/tests/test_check_assertion_surfaces.py 单元测试覆盖规则匹配纯函数（照 scan-drift-check 测试先例 importlib 加载），定向 pytest 绿

- 单元测试必须覆盖 changed_diff_lines 解析（增删行提取、头行/\No newline 跳过）与 evaluate 纯函数（FILE/DIFF 触发、缺测试/齐测试、注释行不误拦、无关文件不触发）关键分支，importlib 按路径加载连字符文件名（照 scan-drift-check 先例），定向 pytest 必须全绿。

#### 场景：主路径

- Given：脚本与测试文件就位。
- When：`python -m pytest backend/tests/test_check_assertion_surfaces.py -q`。
- Then：全部用例通过。

### FR-03: backend/.pre-commit-config.yaml 增 check-only hook（always_run，不修改文件，与既有 ruff 双钩同款风格）

- pre-commit 配置必须新增 `assertion-surfaces` 钩子：check-only（不修改任何文件，规避 ql-20260911-006 的 stash↔auto-fix 冲突类）、always_run + pass_filenames: false（脚本自取 staged 面）、`language: system` + bash 入口与既有 ruff 双钩同款，被拦输出必须含勿绕过提示（仓库规则 10）。

#### 场景：主路径

- Given：hook 配置就位。
- When：触碰断言面源文件且未同步钉子测试的提交执行 pre-commit。
- Then：提交被拦并打印指引；修复后可正常提交。

### FR-04: 知识库 testing-gotchas 登记⑦菜单注册表⑧协议 MSG 两新面 + 通用口径补机制化闸门说明；两新面源码处加同步提醒注释

- 知识库「共享断言面」条目必须登记⑦菜单注册表（menu-permissions.ts → menus 页测试声明序锚）与⑧协议 MSG（protocol.ts → MSG 总数钉）两新面（含本周实证来源），通用口径必须补机制化闸门说明（清单/脚本 RULES/源码注释三处同步登记约定）；protocol.ts 与 menu-permissions.ts 源码处必须各加同步提醒注释。

#### 场景：主路径

- Given：本周 CI 清偿实证两面漏跟。
- When：查 knowledge 条目与两处源码注释。
- Then：⑦⑧三处登记齐全（条目 + 注释 + 闸门规则）。

### FR-05: 脚本与 hook 兼容 Windows Git Bash / Linux（规则 13）；不跑全量测试（规则 0）

- 脚本必须仅用 Python 标准库（subprocess 调 git，fnmatch/re），hook 入口必须为 bash（与既有钩同前题，本机 Git Bash 与 Linux CI 均可用）；本变更必须只跑定向面（新脚本单测 + ruff 双钩预检 + scratch 仓端到端冒烟），禁止跑全量测试套件。

#### 场景：主路径

- Given：规则 13 跨平台要求与规则 0。
- When：本变更验证。
- Then：定向面全过，无全量执行。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/test_check_assertion_surfaces.py「TestEvaluate::test_diff_mode_content_hit_without_test_is_violation」+「test_file_mode_triggered_without_test_is_violation」（触发/放行/不误拦三面）
FR-02: backend/tests/test_check_assertion_surfaces.py（12 例全绿，含 changed_diff_lines 解析分支）
FR-03: 不适用：pre-commit hook 配置无单测面——生效验证 = scratch 仓端到端冒烟（拦/放两路径实测）+ 本变更自身提交过钩实跑
FR-04: 不适用：知识库条目与源码注释为文档面，无测试断言面——由收口文件面对账佐证
FR-05: 不适用：流程/兼容性约束条款——由脚本仅 stdlib import 面 + 定向验证方式本身佐证
