---
author: flow-machine-draft
created_at: 2026-10-20T00:36:02.870Z
---
# 需求规格（Requirements）— 2026-10-20-sillyspec-gotchas-session

## 功能需求

### FR-01: sillyspec-gotchas.md 新增 4 条目（格式对齐既有条目：## 标题+机理+规避/做法+来源标注时点与 CLI 版本）

- `sillyspec-gotchas.md` **必须**新增 4 条 2026-10-20 会话实证的工具负面问题条目（①route-hindsight 改写率阈值对小任务偏紧且拦截成本错位；②flow done dirty 缺口三选一缺并行会话文件处置选项；③归档提交 pathspec 打印→执行窗口的共享暂存区竞态；④design 四问题面逐字钉死规则只在报错时学到），每条**必须**含机理描述与规避/现行兜底做法，并**必须**标注踩坑时点（2026-10-20）与 CLI 版本（v3.33.1）；条目**禁止**改动既有条目内容。

#### 场景：格式与内容对齐

- Given 现行 sillyspec-gotchas.md 的条目形态（`## 标题` + 段落机理 + 要点列表 + 来源）
- When 追加 4 条新条目
- Then 新条目形态与既有条目一致；既有条目与文件头零变化（git diff 只含追加块）

### FR-02: INDEX.md SillySpec 坑段同步 4 行关键词索引（锚点与条目标题一致）

- `INDEX.md` 的 SillySpec 坑索引段**必须**同步 4 行关键词索引，链接锚点**必须**与新条目标题逐字对应（`sillyspec-gotchas.md#<标题锚>`）；关键词**必须**覆盖条目核心检索词（如 route-hindsight/改写率、dirty/缺口/并行会话、归档/pathspec/暂存区/竞态、design/题面/钉死）。

#### 场景：索引可检索

- Given 4 条新条目已入 sillyspec-gotchas.md
- When 检视 INDEX.md SillySpec 坑段
- Then 每条新条目有一行 `关键词|… → [标题](sillyspec-gotchas.md#锚)` 且锚点命中条目标题

### FR-03: sillyspec knowledge validate 0 错 0 警

- 追加与索引完成后 `sillyspec knowledge validate` **必须**返回 0 错 0 警（INDEX 锚点/注册/幽灵条目校验全过）。

#### 场景：知识库完整性

- Given FR-01/FR-02 落盘
- When 跑 `sillyspec knowledge validate`
- Then 输出 0 错 0 警

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯知识文档追加无测试面（AGENTS.md 规则 3 文档不写测试；验收=grep 条目在场+git diff 仅追加块）
FR-02: 不适用：纯索引行追加无测试面（验收=锚点与标题逐字对照）
FR-03: 不适用：CLI 自带校验命令即验证面（validate 0 错 0 警回执留档）
