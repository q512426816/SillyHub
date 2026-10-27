---
author: flow-machine-draft
created_at: 2026-10-27T07:04:27.238Z
---
# 需求规格（Requirements）— 2026-10-27-task-parser-md-check-fallback

## 功能需求

### FR-01: TaskParser.parse_tasks 厚档双源回退：TaskCard frontmatter 未写 status 键时，status 回退取 tasks.md 同 key 勾选态（[x]→done、[ ]→draft、无行→draft）；frontmatter 显式 status 仍优先不被覆盖

- TaskParser.parse_tasks 必须对 tasks/task-*.md 卡片在 frontmatter 未显式写 status 键时，用 tasks.md 同 key 勾选态回退 status（[x]→done、[ ]→draft、无该 key 行→draft）；frontmatter 显式 status 必须优先、禁止被勾选态覆盖；卡片富信息面（title/字段/正文/path 锚卡片文件）必须保留不变。

#### 场景：主路径

- Given 厚档变更：tasks/task-01.md（frontmatter 无 status）+ tasks.md 行 `- [x] task-01: 描述`
- When TaskParser.parse_tasks 解析
- Then task-01 status=done，title/path 来自卡片（富信息不被勾选行覆盖）

#### 场景：优先级

- Given 卡 frontmatter 显式 `status: in_progress` + md 行 [x]
- Then status=in_progress（显式优先）

### FR-02: tasks.md 注册表行仍只补卡片未覆盖的 key（既有行为不变，thin 单源场景零回归）

- tasks.md 注册表行必须只补卡片未覆盖的 key（卡片优先既有语义禁止改变）；thin 单源（无卡片目录）场景解析行为必须与修复前逐字节一致。

#### 场景：thin 单源零回归

- Given 变更仅有 tasks.md（`- [x] a` / `- [ ] b`）无 tasks/ 目录
- Then a=done、b=draft（与修复前一致）

### FR-03: backend/app/modules/task/tests/test_parser.py 补四类用例：卡无 status+md 勾选→done / 卡无 status+md 未勾→draft / 卡显式 status 优先 / 卡无 status 且 md 无行→draft

- test_parser.py 必须覆盖四类回退判定用例（done/draft/显式优先/无行缺省），并必须补无 frontmatter 裸卡 + md 勾选 → done 的第五用例（无 frontmatter 分支同款回退）。

#### 场景：主路径

- Given TestMdCheckFallback 五用例
- When pytest 跑 test_parser.py
- Then 全部通过

### FR-04: 聚焦测试全绿（test_parser.py + task 模块），ruff/mypy 净

- 收口前必须跑 task 模块聚焦测试全绿；parser.py 必须 ruff check/format 与 mypy 零错误；禁止跑全量测试（规则 0，归 CI）。

#### 场景：主路径

- Given 修复后代码
- When 聚焦 pytest + ruff + mypy
- Then 全绿/零错

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: backend/app/modules/task/tests/test_parser.py「test_card_no_status_md_checked_done」「test_card_no_status_md_unchecked_draft」「test_card_explicit_status_wins」「test_card_no_frontmatter_md_checked_done」
FR-02: backend/app/modules/task/tests/test_parser.py「test_parse_three_tasks」等既有用例零回归（18 passed）+「test_card_no_status_no_md_line_draft」
FR-03: backend/app/modules/task/tests/test_parser.py「TestMdCheckFallback（五用例）」
FR-04: 聚焦 pytest app/modules/task/ 18+ passed + ruff/mypy 净（命令实录在 flow done 实测门）
