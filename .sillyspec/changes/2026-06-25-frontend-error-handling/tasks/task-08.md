---
id: task-08
title: 展示策略规范同步模块文档（新建 lib-errors.md + _module-map 注册）
priority: P2
estimated_hours: 0.5
depends_on: [task-01, task-02, task-06]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-007@v1]
allowed_paths:
  - .sillyspec/docs/frontend/modules/lib-errors.md
  - .sillyspec/docs/frontend/modules/_module-map.yaml
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

把「前端错误文案 + 通知」展示策略规范沉淀进模块文档，作为后续新页/新组件落地错误的统一约定来源（FR-06 / D-007@v1）。产出物：

1. **新建** `.sillyspec/docs/frontend/modules/lib-errors.md`（module-card 格式），把 `lib/errors.ts`（errMessage + useNotify）登记为独立模块，并把 design §5 的展示策略表写进「注意事项」区作为强制约定。
2. **更新** `.sillyspec/docs/frontend/modules/_module-map.yaml`：在 lib 模块区新增 `lib-errors` 条目（参照 `lib-token-refresh` 新增条目的写法），把 `frontend/src/lib/errors.ts` 从「无主文件」状态纳入模块体系。

> 本 task 不改任何产品代码；只产文档。task-01/02 已落地 `errors.ts` 的真实签名，task-04 已落地 daemon 删除首场景，本 task 据实记录。

## 前置依赖

- **task-01**：`errMessage` 真实签名（network_error 中文兜底 / err.message / fallback 默认值）已确定 → 文档「契约摘要」据实写。
- **task-02**：`useNotify` 真实签名（error/success）已确定 → 文档「契约摘要」据实写。
- **task-04**：daemon 删除首场景已落地（Modal.confirm + notify.error 409 友好 + notify.success）→ 作为「注意事项」里展示策略的范例引用。

## 实现步骤

### 步骤 1：新建 `.sillyspec/docs/frontend/modules/lib-errors.md`

按现有 module-card 格式（参考 `lib-api.md` / `lib-daemon.md`）书写，frontmatter 字段照惯例：

```yaml
---
schema_version: 1
doc_type: module-card
module_id: lib-errors
source_commit: <execute 时填当前 HEAD 短 hash，如 ba87eec>
author: qinyi
created_at: 2026-06-25T10:21:25+08:00
---
```

**正文 5 个 section 内容要求**：

#### `# lib-errors`

#### `## 定位`
一句话：前端错误文案 + 通知的统一入口（`frontend/src/lib/errors.ts`）。承接 `lib-api` 抛出的 `ApiError`，向上层组件/页面/store 提供「取中文文案（errMessage）」与「antd 通知（useNotify）」两个能力，消灭 D 反模式（`{code}: {message}` 把英文 `HTTP_xxx` 暴露给中文用户）与重复局部 util。不携带任何领域语义，纯表现层辅助。

#### `## 契约摘要`
据 task-01/02 真实实现写两条 export：

- `errMessage(err: unknown, fallback?: string): string` — 纯函数，从任意错误取面向用户的中文文案。绝不返回 `err.code`。规则：`ApiError` 且 `code === "network_error"` → 「网络连接失败，请检查网络后重试」；否则 `err.message`（后端业务错误已中文）；无 message 或非 Error → `fallback ?? "操作失败"`。
- `useNotify(): { error(err, fallback?): void; success(msg): void }` — hook，封装 antd `App.useApp().message` + `errMessage`。**必须在 `<AntApp>` 内调用**（dashboard layout 已被 `components/antd-providers.tsx` 的 `<AntApp>` 包裹）。`error` = `messageApi.error(errMessage(err, fallback))`，`success` = `messageApi.success(msg)`。

依赖：`ApiError`（`lib-api`，仅 `instanceof` 类型判断 + 读 `code`/`message`）、antd `App.useApp()`。

#### `## 关键逻辑`
用代码块描述 errMessage 决策流（参照 lib-api.md 关键逻辑块的写法）：

```
errMessage(err, fallback?):
  if err instanceof ApiError && err.code === "network_error":
    return "网络连接失败，请检查网络后重试"   # 网络层失败，后端无业务 message
  msg = (err as Error)?.message
  if typeof msg === "string" && msg.length > 0:
    return msg                              # 后端业务错误，message 已是中文
  return fallback ?? "操作失败"              # 兜底
# 铁律：任何分支都不读 err.code 拼进文案（code 是英文 HTTP_xxx）
```

useNotify 关键点：内部 `const messageApi = App.useApp().message`，返回稳定闭包；不在 hook 外缓存 messageApi（每次调用走 hook 取最新 context）。

#### `## 注意事项`（**核心：展示策略规范写在这里**）

> **重要**：依据记忆 `scan-regenerates-module-docs.md`，sillyspec-scan 重生模块文档时会**删除手动追加的「变更记录」section**，但保留 5 个标准 section 的内容。因此**展示策略规范必须写进本「注意事项」区**，不要新增「变更记录 / Change Log」section。

注意事项逐条写明（这是本 task 的核心交付）：

1. **【铁律】绝不把 `err.code` 拼给用户**。`err.code` 是英文 `HTTP_xxx`（如 `HTTP_409_CONFLICT`），暴露给中文用户是反模式（D 模式）。任何展示路径都走 `errMessage(err)` 或 `notify.error(err)`，文案只来自后端中文 message / network 兜底 / fallback。

2. **【展示策略规范·按场景区分】**（D-007@v1，源自 design §5）：

   | 场景 | 展示方式 | 入口 |
   |---|---|---|
   | 操作类（删/建/改/启停，用户主动触发） | antd toast 即时反馈 | `useNotify().error/.success` |
   | 页面加载 / 列表拉取 / 详情获取失败 | inline 红条（保留页面上下文） | `setError(errMessage(err))` |
   | 表单字段校验失败 | inline 字段错误 | 现有 antd Form 校验方式 |
   | 危险操作二次确认 | antd `Modal.confirm`（**非** `window.confirm`） | `App.useApp().modal` |

   选型理由：操作类需即时反馈且不依赖页面位置 → toast；加载类失败需保留已渲染列表/详情上下文 → inline；二次确认需统一 destructive 主题与样式 → `Modal.confirm`。

3. **useNotify 调用约束**：必须在 `<AntApp>` 内调用。当前 dashboard layout（`components/antd-providers.tsx`）已全局包裹 `<AntApp>`，故所有 dashboard 内页面/组件均可直接 `useNotify()`。**登录页 / 顶层 error-boundary 等不在 `<AntApp>` 内的位置不要用 useNotify**，改用 `errMessage(err)` + 自行控制展示。

4. **范例（task-04 落地）**：daemon runtime 删除是首场景，完整展示三条策略：失败 `notify.error(err)`（409 时弹后端中文「该 daemon 仍被 N 个 workspace 绑定…」而非英文 code）、成功 `notify.success("运行时已移除")`、二次确认 `App.useApp().modal.confirm({...})` 取代 `window.confirm`。详见 `app/(dashboard)/runtimes/page.tsx` 的 `handleDeleteRuntime`。

5. **store 层例外**：`stores/kanban.ts` 等 zustand store 内不能用 hook（`useNotify`），store 错误文案用 `errMessage(err)` + 静态 `message` 字段（task-07 已把 store 局部 errMessage 改 import 全局）。详见 N2 / R-03 遗留。

6. **fallback 用法**：当 catch 处已知操作语义、且后端可能返回空 message 时，传业务化 fallback，如 `errMessage(err, "删除失败，请稍后重试")`。默认 fallback「操作失败」是兜底的兜底。

#### `## 人工备注`

```html
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
```

（保留空人工备注区，与 lib-api.md / lib-daemon.md 一致；本 task 不在此区写内容。）

### 步骤 2：更新 `_module-map.yaml` 新增 `lib-errors` 条目

在 `# ─── Daemon Client ───`（lib-daemon）条目之后、`# ─── Admin Client ──` 之前插入新条目（lib 区按子域分组，errors 是横切关注点，放在 daemon 之后、领域 client 之前合理）。参照 `lib-token-refresh` 新增条目的字段完整度：

```yaml
  # ─── Error Message & Notify Helpers (2026-06-25-frontend-error-handling 新增) ──

  lib-errors:
    status: active
    doc: modules/lib-errors.md
    paths:
      - "frontend/src/lib/errors.ts"
    tags: [errors, notify, antd, i18n, ux]
    aliases: [errors-lib, error-message]
    entrypoints: []
    main_symbols:
      - errMessage
      - useNotify
    depends_on: [lib-api]   # 仅 instanceof ApiError + 读 code/message
    used_by: [app-pages, app-admin-pages, app-ppm-pages, app-workspace-pages, components-shared, components-admin, stores-kanban]   # task-04/06/07 接入点；execute 时按实际接入情况微调
    needs_review: false
    concerns: []
    review_reasons:
      - 新增模块(2026-06-25-frontend-error-handling),展示策略规范见 modules/lib-errors.md 注意事项区
```

> `used_by` 在 execute 时按 task-04（runtimes/page）/ task-06（16 处 D 模式）/ task-07（3 处 store/forms）实际接入的模块清单微调；上面列出的是预期范围。

### 步骤 3（可选，低优先）：lib-daemon.md / components-daemon.md 补一句

> **风险提示**：依据记忆 `scan-regenerates-module-docs.md`，scan 重生会覆写模块文档 5 个标准 section 的内容（保留人工备注区）。若在 lib-daemon.md 注意事项区补「daemon 删除已用 notify（D-007）」，下次 scan 重生时**可能被覆盖丢失**。故本 task **优先只建 lib-errors.md**（新模块 scan 不会覆写首次创建的内容）；lib-daemon.md / components-daemon.md 的交叉引用**留待下次 sillyspec-scan 自然吸收**，不在本 task 强改。若 execute 时间充裕且确认要补，仅追加一句到「人工备注」区（`MANUAL_NOTES_START/END` 之间），scan 会保留。

## 参考代码/文档

- **格式参考**：`.sillyspec/docs/frontend/modules/lib-api.md`（module-card 5 section 标准结构 + frontmatter 字段）
- **新增条目参考**：`.sillyspec/docs/frontend/modules/_module-map.yaml` 中 `lib-token-refresh` 条目（同为新增模块的完整字段写法）
- **规范来源**：`design.md` §5 展示策略表 / §7 接口定义 / §11 D-007@v1
- **落地范例**：`app/(dashboard)/runtimes/page.tsx` 的 `handleDeleteRuntime`（task-04 产出）
- **记忆约束**：`scan-regenerates-module-docs.md`（规范写注意事项区，不加变更记录 section）

## 验收标准（对应 AC-05 / AC-06）

本 task 对应 plan.md 全局验收 **AC-06**（brownfield 未接入页面行为零变化）的文档侧面 —— 规范成文后，新页面/新组件有据可依，避免再次引入 D 反模式。具体验收：

- [ ] **AC-08a**：`modules/lib-errors.md` 存在，frontmatter 含 `module_id: lib-errors` / `author: qinyi` / `created_at: 2026-06-25T10:21:25+08:00`，正文含定位/契约摘要/关键逻辑/注意事项/人工备注 5 个 section。
- [ ] **AC-08b**：「注意事项」区包含展示策略规范表（4 场景 × 展示方式 × 入口）+ 「绝不暴露 err.code」铁律，且**未新增「变更记录」section**（规避 scan 重生风险）。
- [ ] **AC-08c**：`_module-map.yaml` 新增 `lib-errors` 条目，`paths` 指向 `frontend/src/lib/errors.ts`，`main_symbols` 含 `errMessage` + `useNotify`，`depends_on: [lib-api]`。
- [ ] **AC-08d**：`lib-errors.md` 的契约摘要与 task-01/02 真实实现签名一致（execute 时打开 `errors.ts` 核对，不得凭 design 抄写而偏离实现）。

## 测试/验证命令

本 task 为纯文档变更，无单测。验证手段：

```bash
# 1. 确认文件存在且 frontmatter 完整
cat .sillyspec/docs/frontend/modules/lib-errors.md | head -10

# 2. 确认 _module-map.yaml 含 lib-errors 条目（YAML 语法正确）
grep -A 3 "lib-errors:" .sillyspec/docs/frontend/modules/_module-map.yaml

# 3. （可选）YAML lint
python -c "import yaml; yaml.safe_load(open('.sillyspec/docs/frontend/modules/_module-map.yaml'))" && echo OK

# 4. 确认未误加「变更记录」section（规避 scan 重生覆盖）
grep -i "变更记录\|变更索引\|change log" .sillyspec/docs/frontend/modules/lib-errors.md || echo "无变更记录 section（符合预期）"
```

> 不跑 `pnpm test` / `tsc` / `lint`（无产品代码变更）。

## 风险/注意事项

1. **scan 重生覆盖风险（主要）**：依据记忆 `scan-regenerates-module-docs.md`，sillyspec-scan 重生模块文档时会删除手动追加的「变更记录 / 变更索引」section，且会覆写 5 个标准 section 的内容。**应对**：展示策略规范写进「注意事项」区（标准 section，scan 重生时会重新生成但内容来自代码扫描，规范要点已被 errors.ts 注释 + 本 task 沉淀的双重保障）；**绝不**新增「变更记录」section。下次 scan 重生 lib-errors.md 时，注意事项区的规范表若被简化，需在 scan 后人工恢复（属 scan 的已知行为，记录在 `docs/sillyspec/`）。
2. **契约与实现漂移**：design §7 的签名是设计阶段产出，task-01/02 实现可能微调（如 useNotify 多了 info/warning、errMessage 兜底文案微调）。**应对**：execute 步骤 1 写「契约摘要」前**必须打开 `frontend/src/lib/errors.ts` 核对真实签名**，不得直接抄 design。
3. **_module-map used_by 范围估算偏差**：execute 时 task-06（16 处 D 模式收敛）可能未全部完成，used_by 列表是预期范围。**应对**：按实际接入的模块填 used_by，宁可少列不虚报；scan 重生时会据 import 关系自动修正。
4. **source_commit 填写**：frontmatter 的 `source_commit` 在 execute 时填当前 HEAD 短 hash（`git rev-parse --short HEAD`），不要留占位符。
