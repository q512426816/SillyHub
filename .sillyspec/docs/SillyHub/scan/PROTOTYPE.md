# PROTOTYPE.md — 原型分型与「原型即实现」管线规约

> 2026-09-27-prototype-pipeline 落档。背景：2026-09-26-core-pages-visual-redesign 实证
> 「选型方言原型（手写 HTML）→ 项目方言实现」之间无机械桥梁，视觉保真度全流程零承接，
> 差距部署后才被肉眼发现。本规约确立：**原型从真码生成，产物是编译结果，不是手绘稿**。

## 三类原型

| 类型 | 例子 | 源（入仓、可 diff、过质量门） | 产物 | 批准后怎么「接线」 |
|---|---|---|---|---|
| **页面类** | 变更中心/详情、工作区、会话门户 | `frontend/src/components/prototype/<名>-view.tsx`（import 生产 primer 组件 + Tailwind + themes.ts token，fixture 数据） | `pnpm prototype:build` → `frontend/prototype-dist/<名>.html`（自包含、离线双击、三主题可切） | fixture 换真实 hooks → 挪到正式页面位置 → 用批准渲染生成 Playwright 数值断言与基线截图（**接线，非翻译**） |
| **流程类** | 状态机、同步回执链、门禁管线（**没有对应页面**） | 同目录流程视图 tsx：节点/边 JSON（`FlowNode[]`/`FlowEdge[]`，经 `flow-diagram.tsx` 渲染分层 SVG） | 同上（同一编译管线） | 对照节点/边 JSON 源写状态机测试、design.md 引用节点 id（**可追溯即防漂移**，不接 UI） |
| **规则类** | 决策表、契约、验收口径 | 本体就是文本 → `design.md` / `requirements.md` 相应小节 | 无编译产物 | 不适用（文本即源） |

## 工作流（页面类/流程类共用）

1. **写变体**：在 `frontend/src/components/prototype/` 写视图（或一组风格变体目录），
   与生产同方言；粗选风格可用一次性 HTML 草稿，但**用户选定后的确认稿必须是真码变体**。
2. **编译评审**：`pnpm prototype:build` → 双击 `prototype-dist/*.html` 离线查看
   （三主题切换内嵌）→ 用户对着产物批准。
3. **批准即冻结**：批准时的产物+源码一起显式 pathspec 提交；此后源码改动必须重编译，
   `git diff` 为空是对账门（**禁止手改产物 HTML**——产物不可能与源码分家）。
4. **接线**：按上表「批准后怎么接线」执行；结构对不齐处停下来带截图裁决，不许静默降级。

## 铁律

- 原型源码与生产代码同一质量门：tsc / eslint / 禁硬编码色（token 铁律，参照
  FRONTEND_PAGE_STYLE.md §0.5）。
- 视图只读消费生产组件（import 单向）；业务代码零反向依赖原型目录。
- 产物交互为编译内嵌的轻量 vanilla JS（主题切换/列表过滤）；需要完整交互的原型走
  dev 预览路由（后续演进项），不在本管线内补。
- 产物体积 ~150KB/文件（全量 Tailwind CSS 内联），接受；按视图裁剪为后续优化项。

## 当前视图清单

见 `frontend/src/components/prototype/README.md`（五页面视图 + SillySpec 流程状态机）。
