---
author: qinyi
created_at: 2026-08-06 09:07:53
scale: large
risk_level: unit-sufficient
---

# 设计文档（Design）— scan 文档 drift 检测门

> 前置：multica 对标（[[multica-reference]]）借鉴 #2「scan 文档 source 锚定 + CI drift 检测」。本次治 scan 文档反复过期（实测 source_commit 6e78b29a 落后 HEAD a76f2a75 共 176 commit）。scan 是 LLM（sillyspec-scan skill）非确定性产物，不能像 gen:types 那样 regenerate + diff，改用 source-commit 时效 + 文件路径存在性校验。

## 1. 背景

SillyHub 用 SillySpec 文档驱动，scan 文档（`.sillyspec/docs/SillyHub/scan/*.md`，8 篇：ARCHITECTURE/CONVENTIONS/CONCERNS/INTEGRATIONS/STRUCTURE/TESTING/PROJECT/FRONTEND_PAGE_STYLE）是代码架构/约定/集成的权威描述，被 brainstorm/execute 各阶段加载。但 scan 由 LLM 生成，代码演进后 scan 不自动更新 → 全量过期。现状：scan 文档 frontmatter `source_commit=6e78b29a`，HEAD=`a76f2a75`，落后 176 commit。过期 scan 误导后续变更的上下文加载（行号漂移、已删文件、过时约定）。

已有同类可借鉴模式：`gen:types:check`（frontend/sillyhub-daemon 各有 `pnpm gen:types:check` = regenerate + `git diff --exit-code`）。但 scan 非确定性，不能 CI 内 regenerate。multica 模式（references/*-source-map.md 记 file:line + CI drift gate）是正确长期方向但需结构化锚点，工程量大。

## 2. 设计目标

1. 让 scan 文档漂移可见（CI warn + PR 评论），治「反复过期」顽疾。
2. 双信号检测：source_commit 时效（落后 HEAD 超 N commit）+ scan 文档引用的文件路径仍存在。
3. **warn-only 不阻塞 PR**（修复需人工 LLM 重跑 scan，CI 内不能自动修）。
4. 纯新增门，不改任何现有产品代码；刷新只动 `.sillyspec/docs/`。
5. 可演进（后续可升 block / 加结构化锚点，见方案 C）。

## 3. 非目标（Non-Goals）

- **不**在 CI 内自动 regenerate scan 文档（LLM 非确定性 + 需人工判断）。
- **不**做强 file:line/符号锚点（方案 C，需改 sillyspec-scan skill + 重生成 8 文档，当前过度工程，留作 A 的后续演进）。
- **不**阻塞 PR merge（A 方案权衡；block 留待 warn 验证无效后再升）。
- **不**改 sillyspec-scan skill 本身（本 change 只消费 scan 已有的 source_commit frontmatter + 文档 body 文件路径，不要求 skill 新输出）。
- **不**校验 scan 文档 prose 语义正确性（LLM 文本无法机械校验；只校验可机械验证的锚点：时效 + 文件存在）。

## 4. 总体方案

独立 Python 脚本 `scripts/scan-drift-check.py` 检测漂移，CI workflow warn-only 上报。方案 A（用户确认，brainstorm step4）。

### 信号 1 · source_commit 时效
- 读每篇 scan 文档 frontmatter `source_commit`。
- `git rev-list --count <source_commit>..HEAD` 算落后 commit 数。
- **>N（默认 50，env `SCAN_DRIFT_COMMIT_THRESHOLD` 可配）→ 漂移**。
- source_commit 缺失 / 不是 HEAD 祖先（被 rebase 掉）→ 按漂移处理（提示重跑 scan）。

### 信号 2 · 文件路径存在性
- 正则提取文档 body 的文件路径：`(backend|frontend|sillyhub-daemon|deploy)/[路径].(py|ts|tsx|mjs|js|json|yaml|yml|md)`。
- 逐个 `os.path.exists` 校验（路径带行号 `file.py:123` 时剥离行号校验文件；目录路径也认）。
- 缺失 → 漂移（列文档 + 缺失路径）。
- 白名单仅四端前缀，排除 prose 里的示例/截断路径（如 `package.js`）。

### 上报（warn-only）
- 脚本输出 GitHub `::warning file=<doc>::<msg>` 注解（自动附 PR 对应文件位置）。
- **exit 0**（不 fail job，不阻塞 merge；仅在脚本自身异常时非 0）。
- CI 额外用 `actions/github-script` 发去重 PR 评论汇总（「scan 文档漂移：X 篇落后 / Y 条失效路径，重跑 sillyspec scan」）。
- 本地可直接 `python scripts/scan-drift-check.py`（人类可读输出，无 GitHub 注解）。

### 前置：刷新 scan 文档
- 加门前必须重跑 `sillyspec scan`（skill）把 8 篇 source_commit 推到当前 HEAD `a76f2a75`，否则门首日全红。
- 本 change 第一个 task（LLM 操作，产出刷新后的 scan 文档；刷新过程顺带修失效文件路径引用）。

## 5. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `scripts/scan-drift-check.py` | drift 检测脚本（双信号 + warn 注解 + 人类可读输出） |
| 新增 | `.github/workflows/scan-drift.yml` | CI workflow（PR/push 触发，warn-only，PR 评论汇总） |
| 修改 | `.sillyspec/docs/SillyHub/scan/*.md`（8 篇） | 刷新 source_commit 到 HEAD（via 重跑 scan skill），顺带修失效路径 |
| 修改 | `.sillyspec/local.yaml` | 加 `scan:check` 命令别名（`python scripts/scan-drift-check.py`），方便本地跑 |

## 6. 接口定义

```python
# scripts/scan-drift-check.py（CLI 入口，仓库根目录跑）
# 退出码：0（warn-only，漂移也 exit 0；脚本自身异常才非 0）
# 输出：GitHub ::warning 注解（CI 自动识别）+ 人类可读报告（本地）

def parse_source_commit(doc_path: Path) -> str | None: ...      # 读 frontmatter source_commit
def commits_behind(source_commit: str, head: str = "HEAD") -> int | None: ...  # git rev-list --count；非祖先/异常返 None
def extract_file_refs(doc_path: Path) -> list[str]: ...         # 正则提四端前缀路径，剥行号
def check_drift(scan_dir: Path, threshold: int = 50) -> DriftReport: ...  # 汇总双信号
```

```yaml
# .github/workflows/scan-drift.yml（关键步骤）
on:
  pull_request: { paths: ['.sillyspec/docs/**', 'backend/**', 'frontend/**', 'sillyhub-daemon/**', 'scripts/scan-drift-check.py'] }
  push: { branches: [main] }
jobs:
  scan-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # R-04：全历史算 commit 距离
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: python scripts/scan-drift-check.py   # 输出 ::warning，exit 0
      - # 可选：actions/github-script 发去重 PR 评论汇总
```

```yaml
# .sillyspec/local.yaml commands 新增
commands:
  scan:check: "python scripts/scan-drift-check.py"
```

## 7. 生命周期契约

**不涉及生命周期契约。**（本变更是 meta/tooling（文档 drift 检测门 + CI workflow），不涉及 session/lease/agent_run/daemon 运行时生命周期事件或状态机；文中 `sillyhub-daemon` 指项目源码目录，非 daemon 运行时实体。）

## 8. 数据模型

不涉及。本变更不改任何 DB 表/字段（纯工具脚本 + CI workflow + scan 文档刷新）。

## 9. 兼容策略（brownfield）

- **纯新增门**：不改任何现有产品代码（backend/frontend/sillyhub-daemon 源码零改动）。
- **scan 文档刷新**只动 `.sillyspec/docs/SillyHub/scan/*.md` 的 source_commit + 失效路径，不改 scan 文档的语义结构。
- **warn-only**：即使门误报，也不阻塞任何 PR（exit 0）。
- **阈值可配**：N=50 默认，env `SCAN_DRIFT_COMMIT_THRESHOLD` 可调；初上线可调大阈值降噪声。
- **本地可跑**：`python scripts/scan-drift-check.py` 不依赖 CI 环境（仅需 git + Python 3.12，仓库根跑）。
- 不改的 API/表结构：无任何 API/表结构变更。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | warn-only 被忽视，漂移仍累积 | P2 | 接受（A 方案权衡）；PR 评论汇总提高可见性；后续若无效再升 block（方案 B） |
| R-02 | 文件路径正则误报（prose 示例/截断路径如 `package.js`） | P1 | 白名单仅四端前缀 + 完整扩展名匹配；刷新 scan 文档时顺带清失效引用；初版容忍少量噪声，误报项记录后逐步收紧 |
| R-03 | source_commit 被 rebase 掉（非 HEAD 祖先），git rev-list 报错 | P2 | 捕获异常 → 按漂移处理（提示重跑 scan），脚本不崩 |
| R-04 | CI fetch-depth 默认 1，算不出 commit 距离 | P2 | workflow 显式 `fetch-depth: 0`；仅 PR/push 触发，全历史成本可控 |
| R-05 | scan 文档引用带行号（file.py:123）或目录路径 | P2 | 正则剥行号后校验文件存在；目录路径 `os.path.isdir` 也认 |
| R-06 | 刷新 scan 文档（前置 task）本身可能引入 scan 内容回归 | P1 | 刷新用 sillyspec scan skill 标准 flow；刷新后人工抽检 ARCHITECTURE/CONCERNS 与代码一致 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：
- **D-001@v1**（drift 信号 = source_commit 时效 + 文件路径存在性；否决纯时效 / 强 file:line 锚点）→ 覆盖于 §4 总体方案、§3 非目标（不做强锚点）
- **D-002@v1**（warn-only 不阻塞 PR，方案 A；否决 block 方案 B）→ 覆盖于 §2 目标3、§4 上报（exit 0）、§9 兼容策略（warn-only 零阻塞）
- **D-003@v1**（加门前先刷新 scan 文档，治当前 176 commit 落后）→ 覆盖于 §4 前置（刷新 scan 文档）、§10 R-06

## 12. 自审（Self-Review）

| 检查项 | 结果 | 说明 |
|---|---|---|
| 必填章节齐全（背景/目标/非目标/总体方案/文件清单/接口定义/风险登记） | ✅ pass | §1-10 全含 |
| 生命周期契约（关键词 daemon 触发） | ✅ pass | §7 明确「不涉及生命周期契约」豁免短语（meta/tooling） |
| 数据模型 | ✅ pass | §8 不涉及（纯工具） |
| 兼容策略 brownfield | ✅ pass | §9 纯新增 + warn-only 零阻塞 + 阈值可配 |
| 文件清单覆盖脚本 + CI + 文档 + 配置 | ✅ pass | §5 四类齐全 |
| D-001@v1 被章节覆盖 | ✅ pass | §4/§3/§11 |
| 风险登记 R-01~R-06 | ✅ pass | §10 |
| 跨平台兼容（CLAUDE.md 规则 13） | ✅ pass | 纯 Python + GitHub Actions + git，Windows/Linux/macOS 通用 |

自审结论：章节齐全、决策一致、纯新增低风险。无 P0/P1 blocker。1 处自审存疑：R-02 文件路径正则的误报率需在 execute 阶段用真实 scan 文档实测调参（初版白名单/阈值可能微调），不阻塞进入 plan。
