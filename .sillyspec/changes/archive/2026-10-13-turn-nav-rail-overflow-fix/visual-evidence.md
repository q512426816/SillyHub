# 视觉证据 — 会话页轮次导航窄轨溢出修复

## 用户截图症状（2026-10-13，53 轮活跃会话）

- 左侧 44px 窄轨刻度从把手下一直铺到面板底缘，**越过聊天区底边、叠到输入框与底部配置条上**（输入框行、底部「本机默认/默认/未指定」配置行左侧均可见刻度横杠）。
- 53 轮刻度全部渲染无滚动，密集红（失败）/灰（完成）交错，视觉「错乱」。

## 根因（flex 钳制链断裂）

挂载链：`session-panel-page.tsx` desktop 分支外层 `flex min-h-0 flex-1`（行高=面板剩余高度）→ `turn-nav-column`（root，交叉轴 stretch 高度=行高）→ `turn-nav-rail`。

- `turn-nav-rail` 带 `shrink-0` 且高度 basis auto → 高度=内容高度（把手 36px + N×11px），**拒绝收缩**；53 轮 ≈ 619px > 面板高度 → 溢出 root（root 无 overflow 裁切），刻度叠到输入区上。
- nav `flex-1 min-h-0 overflow-y-auto` 因 rail 高度=内容高度而无高度钳制 → **轨内滚动永不生效**，全部刻度一屏铺满。

对照工作先例 `turn-catalog.tsx`（旧刻度轨，同设计注释第 9-10 行「刻度超出面板高度时回落顶对齐 + 轨内 overflow-y-auto 隐藏滚动条」）：其 nav 直接挂在 stretch 行上被钳制，无中间 shrink-0 层，故从未复现本问题。

## 修复（frontend/src/components/sessions/turn-nav-list.tsx）

1. `turn-nav-rail` 去掉 `shrink-0`（保留 `min-h-0`）→ 轨道可收缩到面板高度，nav `flex-1 + overflow-y-auto` 生效，超出轮次**轨内滚动**；少量轮次 flex-basis auto 高度=内容高，形态零变化。
2. nav 补 `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`（与 turn-catalog 同款），轨内滚动不露滚动条。

## 验证方式与遗留

- jsdom 无真实 flex 布局，单测以布局契约 className 断言（rail 无 shrink-0 / nav overflow-y-auto + 滚动条隐藏 / 密集刻度阈值 61 轮 h-1.5），23/23 绿；跳转滚动链路 session-history-scroll 10/10 绿。
- 修复后行为依据 CSS flex 标准（子项默认 shrink:1 + min-h-0 解除钳制 + 父高 stretch 固定）与 turn-catalog 先例对照，机制等价。
- **人工验收建议**：打开 50+ 轮会话确认刻度止于聊天区底缘、超出部分轨内滚动无滚动条；另注意首屏轨道停在顶部、当前轮（最新）刻度可能不在可视区（把手 #N 可见，滚动联动沿用既有「active 变化才滚」语义，未扩范围）。
