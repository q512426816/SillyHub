# 视觉证据（Visual Evidence）— 2026-10-23-session-first-load-ux

## 变更性质

非新页面/新视觉体系，属**加载态补全 + 渲染时机前移**：

1. 轮次骨架屏（`TurnHistorySkeleton`）复用 antd `Skeleton`（`active` 微光动画），
   着色走 `ConfigProvider` 主题 token（blue / ai-native 双主题自适应，无手写色值）；
   容器与旧空态分支同位置、同最小高度（`min-h-[260px]`）、同居中流，不引入新
   布局容器。
2. 分阶段渲染是数据时序变化，不改变轮块任何视觉形态（`TurnRow` / 预览卡 /
   轮间留白全部未动）。

## 设计系统依据（前端样式铁律）

- `.sillyspec/changes/archive/2026-08-20-frontend-ai-native-style/design.md`（双主题）
- `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md` §0.5 主题系统
- 取值单一源 `frontend/src/styles/themes.ts`：本次未新增任何颜色/阴影 token，
  骨架屏全部由 antd token 派生，随 `data-theme` 换肤。

## 对照说明

| 状态 | 改前 | 改后 |
| --- | --- | --- |
| 详情已返回、历史在飞、turns 空 | 静态文案「XX 已就绪」（无动画） | 3 张轮次卡形骨架 + 「正在加载会话历史…」（active 微光） |
| 底窗日志到达、补拉在飞 | 内容不可见（等整链） | 最近轮次立即可见；骨架随 turns 非空自然退场 |
| 历史终态空会话 | 静态空态文案 | 不变（FR-03 显式保证） |
| 旧消费方（dialog / proto） | 静态空态文案 | 不变（prop 缺省 false） |

## 真实运行截图

**未捕获**：本次执行环境无法直连平台本地服务器（112.2.37.34 网段探测
`10.10.128.145` 各端口超时），前端 dev server 也未在本机会话中启动，无法产出
真实页面截图。

**替代佐证**：
- 骨架屏渲染/退场/空态保持由 `turn-timeline-history-loading.test.tsx`（5 用例）
  以 DOM 断言锁定；
- 两段渲染时序由 `session-first-load-staged.test.tsx`（3 用例）以 deferred 时序
  锁定；
- 组件仅调用 antd `Skeleton`，未引入自定义视觉，不存在「凭主题默认值想象现状」
  的风险面。

**用户裁决**：无视觉降级发生（骨架形态为新增加载态，非对既有基准的收敛/缩小）。
