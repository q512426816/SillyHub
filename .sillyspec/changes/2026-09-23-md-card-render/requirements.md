---
author: qinyi
created_at: 2026-09-23 01:33:44
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区成员 | 在 scan-docs / knowledge 页浏览知识资产卡片的最终用户 |

## 功能需求

### FR-01: 卡片正文 markdown 渲染
覆盖决策：D-002@v1, D-003@v1
Given scan-docs 或 knowledge 页选中一份含表格/列表/加粗/行内代码的 md 文档
When 切换到「卡片」视图
Then 每张小节卡/单卡的正文按 markdown 正常渲染（表格 th/td、列表、加粗、行内 code 生效），且渲染**必须**经统一 rehype-sanitize 过滤（**禁止**新开无过滤渲染路径）；**必须**全文渲染、**禁止**折叠与卡片内二级滚动（D-002）

### FR-02: 卡片头视觉重构（manual 小节卡与 SingleCard）
覆盖决策：D-003@v1
Given 卡片视图渲染一张小节卡或整文件单卡
When 卡片展示
Then 卡片左侧**必须**有 3px 品牌色条（brand-600 语义阶）、头部为 brand-50 底色带、小节标题 brand-700 加粗、右侧**必须**有 🔗 锚点复制图标（点击复制锚点定位并 toast 提示，SingleCard 复制串=裸文件名）；🔥 热度徽标**必须**仅出现在卡片头一处（列表头文件级徽标不动）；视觉与 prototype-card-render.html panel-c 一致；色值**禁止**硬编码 hex（**必须**走 brand-* 语义阶）

### FR-03: frontmatter 元信息条（含降级）
覆盖决策：D-003@v1
Given 文档含 frontmatter（author / created_at 字段）
When 卡片头渲染
Then 头部下方显示一行小字元信息（✍ 作者 · 收录时间）；frontmatter 缺失或字段缺失时该行**必须**整体隐藏，**禁止**渲染空行、**禁止**抛错；stripFrontmatter 签名**必须**保持不动（经新增 parseFrontmatterMeta 提取）

### FR-04: 既有交互零回归
覆盖决策：D-003@v1
Given 卡片模式完成改造
When ① 从知识库 INDEX 路由行点击跳转目标条目锚点；② 顶栏切换 blue / ai-native 主题
Then ① 页面**必须**滚动定位到目标卡片（data-entry-anchor + scrollIntoView 保留有效）；② 品牌色条/表头色/头底色**必须**随主题正确换肤

## 非功能需求
- 兼容性：纯前端组件内部改造，EntryCardList 对外 props 协议不变，两页面 page.tsx 零改动；后端 API 与表结构零改动。
- 可回退：纯静态渲染改造，回退 = git revert 组件目录提交，无数据迁移/状态残留。
- 可测试：FR-01/02/03 有组件测试覆盖（card-markdown.test.tsx + entry-card-list.test.tsx 更新）；FR-04 锚点/主题有断言与手动验收清单。
- 安全：卡片渲染扫描文档/知识库等不可信内容，**必须**经项目统一 sanitize（MARKDOWN_SANITIZE_SCHEMA）。
- 性能：MarkdownText 已 memo，卡片静态内容不重复解析（与现状「原文」tab 同引擎，无新增性能债务）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | （非目标约束，无 FR 承载） | conventions.md 仅作原型演示样本、不沉淀约定——约束 proposal「不在范围内」清单与原型产物，无功能需求承载，显式归属此行 |
| D-002@v1 | FR-01 | 渲染全文、不折叠、无卡片内二级滚动，写入 FR-01 验收语义 |
| D-003@v1 | FR-01 / FR-02 / FR-03 / FR-04 | 方案 C 全集：CardMarkdown 薄壳（FR-01）+ 卡片头视觉重构与零回归约束（FR-02/FR-04）+ frontmatter 元信息条（FR-03），原型 panel-c 为视觉基准 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
