# UI 视觉证据 — 2026-10-22-session-composer-slim

## 变更前后对照（会话底部输入区）

| 位置 | 变更前 | 变更后 |
| --- | --- | --- |
| 排队消息 chip 摘要/展开 | 露 `[附件引用:52e6ff9c-…\|0D5C19CA-….png]` 长串 | `看📎 0D5C19CA-….png 谢谢`，头部 `[附件:uuid\|image\|name]` 标记行剥离 |
| 定时消息 chip / 删除确认 / toast | 同上露协议标记 | 同款简写（📎/📄/📁/🧾） |
| 用户气泡复制按钮 | 复制结果含行内协议标记 | 复制结果为简写正文 |
| 配置条「中断自动续跑」 | 常驻 Switch + 标签 + 运行中提示，占行宽 | 配置条无此项；输入框 + 菜单底部「中断自动续跑（已开启/已关闭）」带勾选态，点击切换不关菜单 |
| 配置条运行中提示 | 文案「运行中切换将于本轮结束后生效」常驻 | 移出配置条（各控件 title 保留同义说明） |
| 行尾额度控件 | 长胶囊：`glm-5.3 · max·5小时窗剩 100% · max·周限额剩 57% ⏱10-28 15:54 重置 等4家` | 紧凑图标：`[Gauge] 57%`（当前会话供应商首窗口；低量黄/红），title 带简述，点击弹完整明细 |

## 交互与响应式核验

- 桌面与移动端：额度图标同为「Gauge + 百分比」形态，mobile 仅缩小尺寸；+ 菜单在两种形态下均可达续跑项。
- + 菜单续跑项：`role=menuitemcheckbox`，`aria-checked` 反映当前态；disabled（会话结束/机器离线）时点击不触发请求。
- 额度浮层：点击图标弹出「模型剩余额度」明细，供应商/模型/各窗口剩余/重置时间/刷新说明均保留。
- 配色遵循主题 token：`brand-600` 图标、`text-warning` / `text-error` 低量阈值，未新增硬编码色值。

## 证据来源

- 真码渲染断言（Vitest + Testing Library，均为生产组件真实渲染）：
  - `frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx`「引用标记在摘要与展开正文中简化为文件名」
  - `frontend/src/components/daemon/__tests__/attachment-refs.test.ts`「formatRefsForPlainText（展示层引用简化）」
  - `frontend/src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx`「autoResume 传入 → 菜单渲染勾选项」「disabled → 禁用且点击不触发」
  - `frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`「不再渲染中断自动续跑开关」「desktop/mobile 均不渲染运行提示」
  - `frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`「图标只显会话供应商首窗口百分比」「低剩余变色」「mobile/desktop 同形态」
- 未捕获整页截图的原因：截图需登录态与运行中会话数据（事件流/附件/额度接口），本机 Docker 前端镜像不含本次源码；本次未改动页面布局结构，仅调整既有控件的形态与文案，行为证据由上述真实组件渲染用例承担。

## 用户裁决

- 2026-10-22 spec 断点：用户确认「附件引用只改展示层、发送协议不变」「运行中提示一并移除」「额度图标显示当前会话供应商首窗口百分比」。决策留痕见 `decisions.md` D-001。
