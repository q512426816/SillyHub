---
author: qinyi
created_at: 2026-08-07 09:46:47
---

# 验证报告（Verify Result）— scan 文档 drift 检测门

## 结论

**PASS WITH NOTES**

4 task 全完成、AC-01~08 全满足、32 单测全绿、drift 自测 0 漂移、CI/配置 yaml 合法、设计一致性 PASS。风险等级经 design.md frontmatter 显式声明为 unit-sufficient（详见「变更风险等级」），不触发集成/部署证据强制门控。Notes 为非阻断的待办/提示项（见各 section）。

## 任务完成度

4/4 = 100%。

| Task | 交付物 | 状态 |
|---|---|---|
| task-01 | 8 篇 scan 文档 source_commit→5a00fc7e（FRONTEND_PAGE_STYLE 补字段）+ 修失效路径 + R-06 抽检 | ✅ |
| task-02 | scripts/scan-drift-check.py（4 核心函数 + CLI）+ scripts/test_scan_drift_check.py（32 测试） | ✅ |
| task-03 | .github/workflows/scan-drift.yml（warn-only + ::warning + github-script 去重 PR 评论） | ✅ |
| task-04 | 主仓库 .sillyspec/local.yaml 加 scan:check 别名 + 收尾自测 0 漂移 | ✅ |

worktree 3 个 commit：0bf6f64b（task-01）/ f747e9d2（task-02）/ e9880d77（task-03）。task-04 的 local.yaml 为 gitignored 本地配置，别名加在主仓库（详见 Notes）。

## 设计一致性

对照 design.md（truth source）逐项核验，**PASS**。4 函数签名与 design §6 完全一致；双信号（§4）、warn-only exit 0（§4/D-002）、文件清单（§5）、风险登记 R-02/R-03/R-05（§10）均落实。

轻微偏差（非 bug，已记录）：
1. **CONVENTIONS.md frontmatter 非标准**（`# 标题` 在 `---` 前）：脚本用 lenient 解析（首个 `---`...`---` 块）兼容，检测正常。属既有 scan 文档布局，非本变更引入。
2. **task-03 PR 评论汇总措辞**：实现用「N 篇文档 / M 条告警」，design §4 文字为「X 篇落后 / Y 条失效路径」。为零耦合脚本消息解析（每条告警原文在折叠详情可见），可接受。
3. **local.yaml gitignored**（design §5 盲点）：design 把 `.sillyspec/local.yaml` 列为「修改」交付物，但它是 gitignored 本地配置（`.gitignore:16`，`docs/sillyspec/finished/local.yaml-gate-pitfalls.md` line78 证实每环境一份）。scan:check 别名加到主仓库本地配置，FR-06 本地满足；无法经 git/worktree 交付，其它开发者需各自加。建议 design §5/§9 补注或另开 change 建 tracked 模板。
4. **D-003 evidence 旧 hash**：decisions.md D-003 evidence 字段写「source_commit 推到当前 HEAD a76f2a75」（brainstorm 时值），实际执行用 5a00fc7e（执行时 HEAD）。是过时数据点非过时决策（D-003 status=accepted，意图=刷新到执行时 HEAD 已满足），建议文档同步更新该 hash。

## 探针结果

- **未实现标记扫描**（仅变更源码文件 scripts/*.py + scan-drift.yml）：无 TODO/FIXME/HACK/XXX/尚未实现。✅
- **关键词覆盖**：脚本核心能力齐全——source_commit 24、commits_behind/rev-list 6、threshold 17、isfile/isdir 5、merge-base/is-ancestor 1；CI yaml——comment API（listComments/updateComment/createComment）3、scan-drift-check/::warning 8、fetch-depth:0 1、setup-python 1、github-script 2。✅
- **测试覆盖**：task-02 有 scripts/test_scan_drift_check.py（32 测试覆盖四函数关键分支）；task-01/03/04 非代码（task-04 自测=drift 脚本运行）。✅
- **决策追踪覆盖**：D-001/002/003@v1 → requirements FR → plan/task 映射完整（见决策追踪矩阵）。✅
- **API 契约对账**：N/A（本变更无后端 router/API 端点改动，纯工具脚本 + CI + 文档）。✅
- **代码删除对账**：本变更纯新增（scripts/scan-drift-check.py、scripts/test_scan_drift_check.py、.github/workflows/scan-drift.yml）+ 文档刷新 + 配置别名，无整文件删除。git diff --name-status 复核：8 scan docs Modified、3 新文件 Added、local.yaml（gitignored 不在 git diff）。✅

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1（drift 信号=时效+文件路径） | FR-01,FR-02,FR-04,FR-07 | task-02 | scripts/scan-drift-check.py 双信号 + 32 单测（含 .tsx/.json 不被吃、非祖先返 None、env 阈值） | PASS |
| D-002@v1（warn-only 不阻塞 PR） | FR-03 | task-03 | scan-drift.yml exit0 + ::warning + github-script create-or-update 去重 + 非 required check | PASS |
| D-003@v1（加门前先刷新 scan 文档） | FR-05 | task-01 | 8 篇 source_commit=5a00fc7e + drift 自测 0 漂移 | PASS |

FR-06（local.yaml scan:check 别名）→ task-04 → 主仓库 local.yaml line21 grep 证实 → PASS。

## 测试结果

- **scripts 单测**：`python -m pytest scripts/test_scan_drift_check.py -q` → **32 passed**（4.91s）。覆盖 parse_source_commit（9）/commits_behind（5）/extract_file_refs（10）/check_drift（8）关键分支。
- **drift 自测（AC-05）**：`python scripts/scan-drift-check.py`（worktree 根，真实刷新后 scan 文档集）→ 扫描 8 篇 / 漂移 0 篇 / 缺失路径 0 条 / EXIT 0。
- **ruff**：`ruff check` + `ruff format --check`（scripts/*.py）→ All checks passed / already formatted。
- **YAML 合法性**：scan-drift.yml + local.yaml 均 `yaml.safe_load` 通过。
- **CLI 对账**：本变更文件（scripts/ + .github/ + scan docs + local.yaml）不命中 local.yaml 任何 module（modules=backend/app/modules/*、frontend/、sillyhub-daemon/），test_strategy:module 下 CLI 最终 --done 的 commands.test 按命中模块子集跑 → 无命中 → 跳过全量（无重复耗时）。

## 技术债务

变更源码文件内无 TODO/FIXME/HACK/XXX（探针 1 确认）。

## 变更风险等级

**显式声明 = unit-sufficient（覆盖关键词判级）**。

理由：本变更是 meta/tooling——纯新增独立 Python 工具脚本（scripts/scan-drift-check.py，32 单测覆盖）+ CI workflow（.github/workflows/scan-drift.yml，语法校验 + 接 unit-tested 脚本）+ scan 文档刷新（drift 自测 0 漂移 + R-06 抽检）+ 本地配置别名。**零产品源码改动**（backend/frontend/sillyhub-daemon 源码不动），**无 daemon↔backend 运行时集成、无 session/lease/lifecycle 状态机、无部署启动路径**。

CLI detectChangeRisk 关键词扫描命中 daemon/backend/session/lease/lifecycle 会误判 integration-critical——这是**误判**：`backend`/`frontend`/`sillyhub-daemon` 是漂移脚本白名单校验的**源码目录名**（脚本检查这些目录下的文件路径是否存在），非运行时服务实体；`session`/`lease`/`lifecycle`/`daemon` 仅出现在 design §7「不涉及生命周期契约」免责声明里。design §7 已明确「文中 sillyhub-daemon 指项目源码目录，非 daemon 运行时实体」。故显式声明 unit-sufficient 覆盖误判，留痕可审计。

## Runtime Evidence

本变更**无 daemon↔backend 运行时集成**（meta/tooling），不涉及 daemon 启动 / backend API 调用 / session-lease 状态机 / 部署启动路径，故无对应运行时证据可提供（也不应伪造）。

本变更的真实「集成」证据（drift 检测门工具的端到端验证，非 daemon↔backend）：
- **端到端运行**：`python scripts/scan-drift-check.py`（worktree 根）对真实刷新后的 8 篇 scan 文档集执行双信号检测，输出：扫描 8 篇 / 漂移 0 篇 / 缺失路径 0 条 / EXIT 0。这是 drift 门工具的 integration test（脚本 + git + 真实文档集联动）。
- **单元测试**：pytest 32 passed（四函数关键分支，含正则反例、非祖先、env 阈值）。
- **CI 联动**：scan-drift.yml 语法合法，wire 了 unit-tested 的脚本（checkout fetch-depth:0 → setup-python 3.12 → run script → github-script 去重评论）；真实 CI 运行需 GH Actions 环境（ubuntu-latest），本地仅静态校验。

## 代码审查

逐 task 审查子代理产出（主代理亲自验证，不盲信报告）：
- task-01：source_commit/路径/R-06 代码引用（control.py:114、execution.py:340、lease_service.py:550）全部坐实非编造；CONCERNS 改动合理（移已解决项带 merge commit + 行号）。
- task-02：代码质量高——正则长在前+负向前瞻避 R-02 坑、commits_behind 非祖先返 None（R-03）、lenient frontmatter、UTF-8 reconfigure 防 Win GBK 崩、subprocess 不开 shell 跨平台、warn-only 始终 exit 0。
- task-03：YAML 结构清晰，github-script 去重逻辑健全（marker + listComments + update/create + continue-on-error + 无漂移跳过不刷屏），permissions 显式 pull-requests:write。
- task-04：local.yaml gitignored 发现准确（主代理 git check-ignore + ls-files 亲自核实），别名加到主仓库本地配置（FR-06 唯一生效处）。

**无 P0/P1 问题**。总体评价：实现质量高、防御完善、跨平台、与设计一致；4 处轻微偏差均为可接受的实现调整或文档同步项。

## Notes（非阻断待办）

1. **base 与 origin/main 分叉（领先 1 / 落后 3）**：verify 不受影响（worktree 实现完整），但 `sillyspec worktree apply` 回 main 大概率冲突。建议 apply 前主仓库 `git fetch` + 评估冲突（rebase/merge origin/main 对齐后 cleanup+重跑，或 apply 时手动解冲突）。
2. **local.yaml gitignored**：scan:check 别名仅本机生效，团队共享需各自加或建 tracked 模板（另开 change）。
3. **D-003 evidence hash** + **design §5 local.yaml 盲点**：建议文档同步（本次未改，避免 docHash churn）。
