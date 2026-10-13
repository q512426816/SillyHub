# 视觉证据 — 会话门户页头标题块移除（2026-10-13-sessions-portal-header-remove）

## 诉求与目标

用户反馈：智能体会话页面的页头「智能体会话」标题 + 「跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建」副标题占掉一段高度；要求去掉该块、让下方组件（左会话列表 + 右会话面板）占满屏幕。

## 真页渲染对照（截图，本项目 dev server + Playwright）

| 截图 | 路由 | 状态 | 观察 |
|---|---|---|---|
| `00-sessions-before.png` | /sessions | 基线 HEAD `13c7d29c9`（含 PageHeader） | 顶栏下方先是一行 `智能体会话`（h1）+ 一行副标题；分栏卡片顶边 ≈y140 |
| `01-sessions-after.png` | /sessions | 本变更后 | 顶栏下方**直接**是分栏（左列表 + 右空门户态卡片），顶边 ≈y80，卡片底边到视口底（y≈880）；无标题/副标题痕迹 |
| `02-workspace-scope-after.png` | /workspaces/ws-1/sessions | 本变更后 | 同为无标题块；顶部右对齐保留紧凑 Git 状态条「⎇ main ↑2 +3/−1」（功能件保留），其下分栏占满其余高度 |

视口 1440×900（TopBar h-16=64px）。对照结论：标题块退役释放约 60px 高度（≈y140 → ≈y80），且不再存在任何标题占位留白；三张图同一脚本同一固件，差异只来自代码版本与 scope。

## 复跑方式（可复现，不依赖本机 backend/daemon）

1. 起前端：`cd frontend && pnpm dev`（默认 :3000）；
2. 截图：`node .sillyspec/changes/2026-10-13-sessions-portal-header-remove/render-sessions-portal.mjs <out.png> [route]`
   （默认 `/sessions`；Git Bash 下传带前导斜杠的路由需 `MSYS_NO_PATHCONV=1`）；
   脚本对 `**/api/**` 全量 route mock（工作区/机器/会话/群/供应商/git-log status 固件），
   登录态经 localStorage 注入（`multi-agent-platform.session`），无 backend 亦能渲染真实页面；
3. 复现「改前」：先 `git show HEAD:<sessions-portal.tsx 路径> > <同路径>` 临时回退组件文件再截 00，
   截完还原改动文件（本次即此流程，还原后与改动副本 byte-identical 校验通过）。

## DOM 契约（jsdom 断言，与截图互补）

- 副标题文案 `queryByText("跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建")` 为 null；
- `h1` 文案仍为「智能体会话（+ scope 后缀）」且 `toHaveClass("sr-only")`（视觉零占位、读屏/测试可识别）；
- 页容器 `h-[calc(100vh-64px)]` + 分栏 `sessions-portal-panes` 的 `flex-1`/`min-h-0` 类名契约（jsdom 无真实布局，高度链以类名契约锁住；真页效果见截图）。

## 验证面与遗留

- 已跑：`sessions-portal.test.tsx` 64/64 绿、`sessions/__tests__/page.test.tsx` 47/47 绿、`pnpm -C frontend typecheck` 无错。
- 本次无视觉降级（用户明确要求「移除」，非因约束对不齐基准而收敛），故无「用户裁决」段。
- 遗留/人工验收项：本机无可用的真 backend/daemon，截图数据来自 route mock 固件——布局与「标题块在否」的判定不受影响，但建议在真实环境各路由目视一次（尤其 change / quicklog scope，本变更未单独截图，与全局共用同一 JSX 分支）。
- 已知保留项：workspace scope 顶部仍有一行 ≈26px 的紧凑 Git 条（2026-08-26-workspace-git-status CC-08 功能件，本次刻意不删）；若用户要求该 scope 也彻底全屏，属新诉求。
