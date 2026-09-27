# UI 视觉证据（Visual Evidence）— 2026-09-27-session-portal-ia-restructure

> 本机无可用 dev 后端（与上一轮 2026-09-26-core-pages-visual-redesign verify 同况），
> 依其先例以代码级验证替代浏览器截图，三主题走查移交部署后平台亲验。

## 代码级验证（本会话实测）

| 项 | 结论 | 证据 |
|---|---|---|
| 三主题 token 链路 | 新增代码全部走 token 类（bg-card/border-border/text-foreground/text-muted-foreground/brand-50/brand-300/brand-700/muted），零硬编码 hex | detailColumn/头部行2/详情开关/DetailMetaRow 源码 grep；`pnpm exec tsc` 0 错 |
| 结构对照 | 头部两层（行1 标题+状态+操作 / 行2 meta）；右列三模式（收起/详情/子代理）；desktop 底部堆叠自 11 层收敛（用量+任务入右栏） | session-panel-page.tsx diff；session-panel-variant.test「根/头部 className 逐字一致」过（header 类零变化锚） |
| 交互保留 | #id 复制/共享徽标/机器/工作区逐字搬移；子代理右栏单槽位语义派生优先；resizer side=right 方向不变；mobile ⋯ 菜单收纳原样 | feature-inventory.md 〇节映射表；1387/1390 会话域测试 |
| 行为零回归 | 深链/轮询/SSE/队列/草稿链路 diff 零触碰；/m/ 与群聊面板零波及（git diff 文件面：仅 SPP+SLP+3 测试） | git diff --stat 佐证 |

## 移交项（部署后人工验收）

1. 三主题（blue/ai-native/dark）逐屏走查：头部两层观感、右列详情面板、左栏筛选 wrap 布局。
2. 右列「详情」开关开合 + localStorage 记忆 + 拖宽（与子代理面板/文件预览共用宽度键）实机点验。
3. TaskExecutionPanel 在右栏窄列（480px 默认）的三页签横向滚动表现（组件自带容器自适应，超出横向滚动不撑破）。
