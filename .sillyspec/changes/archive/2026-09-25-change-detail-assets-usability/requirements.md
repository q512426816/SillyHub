---
author: flow-machine-draft
created_at: 2026-09-25T08:10:16.781Z
---
# 需求规格（Requirements）— 2026-09-25-change-detail-assets-usability

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: FR 索引行点击落到知识库的具体条目

Given 变更详情「沉淀资产」卡列出若干 FR 索引条目（来源 knowledge/fr/<域>.md，条目 id 形如 FR-<域>-NNN）；
When 用户点击某一行；
Then 知识库页打开该 FR 所属文件，并滚动定位到这一条 FR 的条目卡（DOM 落点 data-entry-anchor=<知识库相对文件名>#<FR id>）；
且文件参数做前缀容错：`knowledge/`、`.sillyspec/`、`.sillyspec/knowledge/` 前缀与裸文件名四种写法都能落到同一文件；列表里查无该文件时静默停在列表空态（不选中、不报错、不留白屏），条目级锚点查不到时静默停在文件级顶部。

### FR-02: 决策索引行点击落到知识库的具体条目

Given 「沉淀资产」卡列出若干决策蒸馏条目（来源 knowledge/decisions/*.md，条目 id 形如 D-NNN@vN）；
When 用户点击某一行；
Then 与 FR-01 同款落位语义：选中该决策文件并滚动到该条目卡（data-entry-anchor=<文件名>#<D id>）。

### FR-03: 测试绑定行可查看仓库内测试文件内容

Given 「沉淀资产」卡「测试绑定」组列出 test-trace 行（锚点 / 测试文件路径 / 状态）；
When 用户点击该行给出的测试文件路径；
Then 弹出只读预览弹窗，展示仓库内该文件内容（走 explorer 取数，不依赖 spec 镜像），失败时弹窗内给出可读错误提示；
且行内锚点标注为「变更内 FR-NN」形态（与该变更 requirements.md 的 FR 对应），与知识库 FR 索引条目的 id 区分显示。

### FR-04: 归档留档可看到具体改动

Given 已归档变更的归档目录存在 change-patch.json（含 files 清单）与 change.patch（冻结全量 diff）；
When 用户展开「沉淀资产」卡的「归档留档」组；
Then 除既有 files/additions/deletions 统计外，列出 change-patch.json 的文件清单（超上限时显式标注截断）；
When 用户点击清单中某个文件；
Then 弹出该文件在 change.patch 中的红绿 diff 切片（后端切片，不前端解析 patch）；该文件不在 patch 内时弹窗给出明确说明而不是空 diff。

### FR-05: 范围对账降级态显式展示、不再误显三态

Given scope-audit 返回 ok=true 且 degraded_reason 非空（计划侧不可用，降级为「实际侧 only 视图」，行内无三态字段）；
When 变更详情页渲染范围对账卡；
Then 不再渲染三态 chip 的 0/0/0，改为显式展示降级原因 + 口径说明（该视图无三态列、文件面为实时窗口），明细弹窗同样带降级横幅；
且已归档变更额外提示「文件面为当前工作区未提交窗口，不代表本变更改动面，本变更改动面见沉淀资产 · 归档留档」。

### FR-06: 相关测试与静态检查全绿

Given 本变更改动了后端 assets/scope-audit 展示链路与前端两张卡、知识库页；
Then 后端 test_assets.py、前端 change-assets-card / scope-audit-command-card / knowledge-page 用例全绿，ruff 与 tsc 零错误；全量测试交 CI（仓库规则 0）。

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
FR-01: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx（FR 行 href 含 file+anchor）+ frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx（URL 参数落位与前缀容错）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
FR-02: 同 FR-01 两个用例文件（决策行 href 含 file+anchor，落位链路与 FR 行共用同一 selectEntry 通道）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
FR-03: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx（点测试文件路径开预览弹窗 + 锚点「变更内 FR」标注；弹窗内容走 FilePreview 替身，只验接线）+ frontend/src/components/explorer/__tests__/file-preview.test.tsx（「加载失败显示红条并透传 ApiError 中文文案」——FR-03 末句的失败提示面由该共享组件既有用例覆盖）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
FR-04: backend/app/modules/change/tests/test_assets.py（files 清单 + 切片命中/未命中/路径非法）+ frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx（清单渲染与点击开 diff 弹窗）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
FR-05: frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx（降级态不渲染三态 chip、显降级原因、归档提示）

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
FR-06: 不适用：验收口径本身（跑上述用例 + ruff + tsc 即其证据面，无独立测试对象）
