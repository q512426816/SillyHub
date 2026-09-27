# prototype/ —— 原型即实现（prototype-as-code）管线

> 规约总纲见 `.sillyspec/docs/SillyHub/scan/PROTOTYPE.md`（原型分型：页面类/流程类/规则类）。

## 是什么

原型**源码**住在本目录（与生产同方言：import `@/components/primer` 生产组件、Tailwind 类、
themes.ts token，fixture 假数据），`pnpm prototype:build` 把它们编译为
`frontend/prototype-dist/` 下的**自包含独立 HTML**（CSS/JS 内联、零外部引用、离线双击可用、
内嵌三主题切换）。

## 文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `change-center-view.tsx` | 页面类 | 变更中心列表（IssueRow/UnderlineNav/Counter） |
| `change-detail-view.tsx` | 页面类 | 变更详情（checks 横条/Timeline/MetaPanel） |
| `workspace-list-view.tsx` | 页面类 | 工作区列表（Repositories 行式） |
| `workspace-overview-view.tsx` | 页面类 | 工作区概览（StatGrid/守护横幅/两栏） |
| `session-portal-view.tsx` | 页面类 | 会话门户三栏 |
| `sillyspec-flow-view.tsx` | 流程类 | SillySpec 变更流程状态机（双泳道） |
| `flow-diagram.tsx` | 原语 | 节点/边 JSON → 分层 SVG，token 着色 |
| `demo-chrome.tsx` | 产物 chrome | 演示条（主题切换），真实页面无此条 |

## 用法

```bash
cd frontend && pnpm prototype:build   # 产物在 prototype-dist/，双击打开
```

改任何视图后必须重编译再提交（`git diff` 为空 = 产物与源码对账通过；
禁止手改 `prototype-dist/` 下的 HTML）。

## 纪律

- 原型源码与生产代码同一质量门：tsc / eslint / 禁硬编码色（token 铁律）。
- 视图只读消费生产组件（import 单向），不反向影响业务代码。
- 交互为编译产物内嵌的轻量 vanilla JS（主题切换/tab 过滤）；需要完整交互的原型走
  dev 预览（后续演进），不在本管线内补。
