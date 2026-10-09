---
author: flow-machine-draft
created_at: 2026-10-09T02:41:20.771Z
---
# 需求规格（Requirements）— 2026-10-09-pending-attachment-preview

## 功能需求

### FR-01: 单聊输入栏（session-input-bar）待发附件 chip 点击文件名区打开 FilePreviewModal 在线预览（复用已发送附件的 fetchAttachmentBlob + officeSource 链路）

- 单聊会话输入栏的待发送附件 chip 必须支持点击预览：点击 chip 的文件名区域（图标+名称+大小）打开统一预览窗 FilePreviewModal，在线查看已上传但未发送的图片/文件内容；预览目标必须复用已发送附件同款链路（fetchAttachmentBlob 拉取 + officeSource: session_attachment 高保真标识）。

#### 场景：上传后未发送点击预览

- Given 用户在会话输入栏上传了一张图片（或一个文件），chip 已出现在输入框上方且消息未发送
- When 用户点击 chip 的文件名区域
- Then 打开 FilePreviewModal 在线预览该附件内容（非新窗跳转）

### FR-02: 群聊面板（group-chat-panel）待发附件 chip 同样支持点击预览

- 群聊面板输入区的待发送附件 chip 必须支持与单聊一致的点击预览行为：点击文件名区域打开 FilePreviewModal 在线预览。

#### 场景：群聊待发附件点击预览

- Given 用户在群聊输入区上传了附件，chip 已出现且消息未发送
- When 用户点击 chip 的文件名区域
- Then 打开 FilePreviewModal 在线预览该附件内容

### FR-03: 预览与移除互不干扰：点击 X 删除附件不触发预览，点击预览不影响删除

- 预览入口与移除入口必须相互独立：chip 内 X 按钮只删除附件（不打开预览）；文件名区域只开预览（不删除）；两者必须为独立按钮元素，禁止嵌套按钮。

#### 场景：点 X 删除不开预览

- Given 待发附件 chip 存在
- When 用户点击 chip 上的 X 按钮
- Then 该附件被移除（本地 chip 消失 + 服务端草稿删除），预览窗不打开

### FR-04: 既有上传/移除/发送行为零回归，相关测试全绿

- 本变更必须不改变既有附件上传（选文件即传/批量上限/粘贴）、移除、发送（附件 ids 组装/发送后清空）与输入栏其余交互（联想、定时发送、＋菜单）的任何行为；相关既有测试必须保持全绿。

#### 场景：零回归验证

- Given 本变更代码合入
- When 运行 session-input-bar 系与 group-chat-panel 系既有测试
- Then 全部通过，无既有用例被修改或删除

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「点击文件名区打开 FilePreviewModal 在线预览」
FR-02: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx「待发附件 chip 点击在线预览（2026-10-09-pending-attachment-preview）：FilePreviewModal 打开」
FR-03: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「点 X 删除附件不触发预览」
FR-04: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「一次选 12 个文件：toast 告知忽略多余的 2 个，只上传前 10 个」+ group-chat-panel.test.tsx 既有附件用例（移除/发送/纯附件可发）
