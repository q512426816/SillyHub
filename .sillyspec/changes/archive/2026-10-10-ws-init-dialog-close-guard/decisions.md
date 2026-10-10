---
author: flow-machine-draft
created_at: 2026-10-10T00:16:38.367Z
---
# 决策记录（Decisions）— 2026-10-10-ws-init-dialog-close-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：deadline 顺延一拍（2s）在高频切页场景产生最长 2s 的判死延迟——相对 5min 超时窗可忽略，且换来的是后台零假失败。另一个取舍：回前台后重挂满窗而非续接剩余时长，最坏情况前台多等 5min——初始化轮询通常先于超时命中 init_synced_at，实际影响罕见。试过但放弃：onCancel 内按 phase 拦截（放弃理由：ESC/遮罩事件仍会触发 antd 内部状态翻转，且 X 按钮仍渲染给用户可点击的假出口，交互层禁用更干净）；deadline 用 visibilitychange 事件重算剩余时长（放弃理由：需要额外事件监听器与剩余时长簿记，复杂度超过 2s 顺延的收益）。
