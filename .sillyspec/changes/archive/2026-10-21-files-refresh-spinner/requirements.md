---
author: flow-machine-draft
created_at: 2026-10-21T03:18:30.955Z
---
# 需求规格（Requirements）— 2026-10-21-files-refresh-spinner

## 功能需求

### FR-01: 点击刷新按钮后按钮立即转圈且禁用，同步请求返回后恢复可点

- 用户点击「变更文件」卡头的「刷新」按钮（触发 `?sync=1` 定向同步，后端等待预算 15s）后，按钮必须立即进入转圈态（图标旋转）且禁用（不可重复点击），让用户知道点击已生效；同步请求返回（成功或失败）后按钮必须停止转圈并恢复可点。

#### 场景：主路径

- Given 变更文件树已挂载且非加载中
- When 用户点击「刷新」按钮且 sync 请求尚未返回
- Then 按钮禁用且图标转圈；When sync 请求返回后 Then 按钮恢复可点、停止转圈

### FR-02: 挂载与自动轮询的纯读刷新不触发转圈

- 初始挂载取数与 `autoRefreshMs` 自动轮询（均不传 sync，纯读）禁止触发刷新按钮的转圈/禁用态——转圈反馈面仅由用户显式点击（含错误横幅重试）驱动。

#### 场景：主路径

- Given 组件已挂载、自动轮询周期到点触发纯读刷新
- When 纯读刷新请求在飞
- Then 刷新按钮保持可点、无转圈态

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx「点击刷新：同步进行中按钮禁用+转圈，返回后恢复」
FR-02: frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx「纯读刷新（挂载/轮询）不触发转圈态」
