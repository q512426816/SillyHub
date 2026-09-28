# 视觉证据 — 2026-09-28-remove-liveness-overview-card

## 变更性质

纯删除性 UI 变更：工作区详情页右栏移除「Agent 状态总览」卡
（`<AgentLivenessOverviewCard>`）。无新增/改动的视觉面，无样式对齐、
无基准降级问题。

## 布局安全性论证

- 摘除点是右栏（`lg:grid-cols-[minmax(0,1fr)_340px]`）的第一个子元素，
  同列仍有 About 侧栏（`MetaPanel`）承接，两栏网格结构不变，不存在塌列。
- 删除后 `page.test.tsx` 16 用例全绿（含页面挂载、About 侧栏、
  ChangesOverviewCard 断言），`tsc --noEmit` 零错。

## 渲染对照记录（2026-09-28）

计划用 IAB 打开 `http://localhost:3000`（`pnpm dev` + `NEXT_PUBLIC_API_BASE_URL=
http://localhost:8001` 指向 Docker 后端）登录后对详情页截图，与 Docker 旧构建
（localhost:3001，卡仍在）对比。**实际执行：IAB webview 持续无法挂载**
（`browser guest not attached (webview not ready)`，含 visibility.set(true)
预热后共 3 次尝试失败，属宿主环境问题，非页面问题），截图对照未成。

替代证据链（删除性变更下充分）：
1. `grep` 全仓无 `AgentLivenessOverviewCard` / `agent-liveness-overview-card`
   残留引用——卡片不可能再被渲染。
2. 详情页测试 16/16 绿 + tsc 零错——同页其余视觉元素不受影响。
3. 「未知（100）」卡片的由来与删除依据见 design.md 槽1 排查实录
   （库 724/725 行 state NULL、daemon 连远程、local.yaml 无 platform token）。

## 用户裁决留痕

「实在不行就去掉」——用户 2026-09-28 会话原话（排查结论为链路结构性无数据，
非偶发故障，命中「实在不行」），裁决去卡不修链路；依据与备选方案
（隐藏门 / 修链路）的放弃理由见 design.md 槽4。
