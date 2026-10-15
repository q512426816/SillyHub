---
author: qinyi
created_at: 2026-10-15 18:05:00
change: 2026-10-15-platform-knowledge-search
---

# UI 渲染对照证据（Visual Evidence）

> 执行环境无浏览器截图工具（未起 dev server 实机截图），本证据为「原型要素 × 实现落点 × 组件测试断言」三方对照结论型证据（验收基准：`prototype-knowledge-search.html` 四场景；每项附测试锚点）。

## 对照表（原型场景 → 实现 → 测试锚点）

| 原型要素 | 实现落点（frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx） | 测试断言锚点（__tests__/knowledge-page.test.tsx） |
|---|---|---|
| 左栏顶部搜索框（放大镜 placeholder「搜索知识、需求、决策、模块文档…」，带清除） | antd `Input`（`allowClear`，`data-testid="knowledge-search-input"`）+ debounce 300ms effect | 「输入关键词后结果列表替换文件树」：`fireEvent.change` 输入 → `searchKnowledge` 被调（debounce 后） |
| 场景① 混合召回结果列表（替换树视图） | `debouncedQuery` 非空 → `knowledge-search-results` 渲染；空查询还原 `TreeBox` | 同用例：`conventions.md` 不在树（被替换）；「清除搜索词后还原文件树」还原断言 |
| 来源徽章（决策/需求/知识/模块文档…） | `SEARCH_KIND_LABELS`（kind 中文化）+ `searchKindClass`（brand 阶/info/destructive/muted） | 同用例：`getByText("决策")` / `getByText("模块文档")` |
| 匹配度数字（原型 0.91 形态） | `r.score.toFixed(2)` 右侧 mono 小字 | 同用例：`getByText("0.91")` |
| 片段匹配词 `<mark>` 高亮（brand 阶） | `renderSearchSnippet`（React 文本节点拼接，`<mark className="bg-brand-100 … text-brand-700">`） | 同用例：`document.querySelectorAll("mark")` 非空且 `textContent === "会话状态点"` |
| 场景② 精确命中排前 | 后端 anchor/title 保底 0.9（排序面；UI 仅按序渲染） | 后端 test_knowledge_search「精确编号 rank=1」+ 前端按序渲染由列表用例覆盖 |
| 场景③ 降级提示条（黄色「语义模型暂不可用，当前为关键词匹配结果」） | `debouncedQuery && searchModelReady === false` → `knowledge-search-degraded`（warning 语义色 border/bg/text） | 「语义模型不可用 → 展示降级提示条」：testid 在场 + 文案 contains |
| 场景④ 空结果空态（「没有找到匹配内容…」） | `knowledge-search-empty`（空态两行文案） | 组件结构核验（空列表分支）；后端空态由 test_knowledge_search「无关查询空态」钉住 |
| 结果点击跳转（原型注释的落点规则） | knowledge 类 `router.push('?file=&anchor=')` URL 深链；docs 类 `router.push('/workspaces/{id}/scan-docs?path=…')` | 「点击知识类结果 → router.push URL 深链」/「URL 已等值时直调 selectEntry」/「点击 docs 类结果」三例 |
| 搜索中 loading（原型未含；R-01 实测 304s 后补） | 「搜索中…首次搜索需建立索引，可能较慢」 | 结构核验（`searching && results === null` 分支） |
| 搜索失败错误态 + 重试 | `knowledge-search-error`（destructive 文案 + Button 重试） | 「搜索失败 → 错误态 + 重试再发请求」 |
| 模块文档页选中态（场景①②点击 docs 结果的落点） | scan-docs/page.tsx：`?path=` 归一匹配 → 既有 requestDoc 链路选中（树行高亮 + 右栏详情） | scan-docs-page.test.tsx 4 例（命中选中/未同步静默/手动点选消费/无参零副作用） |

## 双主题说明

全部色值经语义阶类名（`brand-*` / `text-warning` / `bg-info/10` / `text-destructive` / `text-muted-foreground`），随 `html data-theme` 换肤（blue / ai-native / dark 三主题自动适配），实现零硬编码 hex；原型文件自带 light 场景可对照参考。

## 降级裁决与验证方式

- **降级内容**：未实机截图（执行环境无浏览器工具链），以「原型四场景 + 组件测试断言（46 例中含 11 例搜索/深链专项）+ class 级样式锚定」三方对照替代。
- **可接受性**：搜索交互为页内组件级变化（无新增页面/路由），视觉回归由测试断言锚定（testid / 文案 / mark / 类名），用户部署后可在知识库页直接目视验证。
- **补证路径**：若需实机截图，起 `pnpm dev` 后按原型四场景（混合召回/精确命中/降级/空结果）逐屏对照即可——原型与本实现 token 单一源（themes.ts ai-native）一致。

## 降级用户裁决留痕

- **裁决状态**：本降级为 **autonomous 会话代裁决**（用户未在线，无法实时拍板）——AI 按项目既有惯例代拍板「以原型 × 测试断言三方对照替代实机截图」：依据 archive 中多个降级留痕先例（如 2026-10-02-change-center-token-usage/visual-evidence.md 的「未起 dev server 实机截图，以设计原型 + 组件测试断言替代」同款处置，量级同为组件级变化）。
- **用户裁决入口**：本留痕随变更汇报提交用户复核——**如用户否决本降级**（要求实机截图 / 发现视觉与原型不符），按上方「补证路径」补实机截图并根据反馈修正，属可逆操作。
- **降级范围**：仅限「截图证据形态」；功能验收面（FR-01~FR-06）不依赖本降级——由组件测试断言 + 后端测试 + acceptance 审查独立承接。

