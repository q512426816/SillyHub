---
author: flow-machine-draft
created_at: 2026-10-27T00:43:43.805Z
---
# 需求规格（Requirements）— 2026-10-27-scheduled-send-attachments

## 功能需求

### FR-01: 会话面板 dialog 与 page 两模式创建定时消息时，输入框已上传附件的 id 随请求体 attachment_ids 携带

- 输入框存在已上传附件时，创建定时消息请求体必须携带这些附件的 id（`attachment_ids` 字段，取 `pendingAttachments` 的 id 列表）；输入框无附件时禁止改变既有请求形态（不携带空数组占位字段）。

#### 场景：带附件创建定时消息

- Given：用户在会话输入框写好文本并上传了 2 个附件（上传成功持有服务端 id），点 ⏰ 打开定时发送弹窗并确认时间
- When：点击「创建定时消息」
- Then：POST /sessions/{id}/scheduled 请求体同时含 prompt、dispatch_at 与 `attachment_ids: [id1, id2]`，创建成功后到点派发走后端既有 inject 附件管线，agent 收到附件

#### 场景：无附件创建定时消息（零回归）

- Given：输入框只有文本、无附件
- When：创建定时消息
- Then：请求体形态与现状一致（仅 prompt + dispatch_at），既有测试不回归

### FR-02: 定时消息创建成功后，输入框附件 chips 与附件元数据镜像同步清空（与文本草稿清空同口径）

- 定时消息创建成功后，输入区必须清空本次已随消息携带的附件 chips、内部附件元数据镜像（attachmentMetaRef 对应条目）并调用输入栏清空句柄，与文本草稿清空同口径；创建失败（422/409/网络）时输入文本与附件必须原地保留可改后重试。

#### 场景：创建成功清附件

- Given：输入框有文本 + 2 个待发附件，定时创建请求成功返回
- When：成功分支收敛
- Then：附件 chips 全部消失、attachmentMetaRef 中对应 id 条目被删除、清空句柄被调用；若用户期间手动删了 1 个附件，仅清剩余 1 个（按 id 精确过滤，不误伤）

#### 场景：创建失败保留现场

- Given：定时创建请求失败（如时间过近 422）
- When：失败分支收敛
- Then：弹窗保持打开，输入文本与附件 chips 原地保留，可修改后重试

### FR-03: 定时发送弹窗在携带附件时展示附件预览列表，让用户可见附件将随消息发送

- 定时发送弹窗在本次将携带附件时，必须展示附件预览列表（类型图标 + 文件名，与「将发送的内容」同区块呈现）；无附件时禁止渲染该区块（不占位、不出现空列表框）。

#### 场景：弹窗附件预览

- Given：输入框挂有 2 个待发附件，打开定时发送弹窗
- When：弹窗渲染
- Then：「将发送的内容」区块下方出现附件预览行（每行图标+文件名），用户可见附件将随定时消息发送

#### 场景：无附件弹窗不占位

- Given：输入框无附件，打开定时发送弹窗
- When：弹窗渲染
- Then：不出现附件预览区块，弹窗视觉与现状一致

### FR-04: 带附件时允许空文本创建定时消息（对齐普通发送 D-7 看图说话口径），空文本且无附件仍禁用确认

- 输入框挂有附件时，空文本（含全空白）必须允许创建定时消息（后端 create_scheduled_message 校验一已支持附件豁免）；空文本且无附件时确认按钮必须保持禁用并显示既有空态提示。

#### 场景：附件豁免空文本

- Given：输入框无文本但有 1 个图片附件，打开定时发送弹窗
- When：查看确认按钮并点击创建
- Then：确认按钮可用，请求体 prompt 为空串 + attachment_ids 携带，创建成功（看图说话定时口径）

#### 场景：空文本无附件仍禁用

- Given：输入框为空且无附件
- When：打开定时发送弹窗
- Then：确认按钮禁用 + 空态提示文案出现（现状行为不变）

### FR-05: 更新/新增前端测试覆盖定时创建携带附件断言，相关测试与 lint 通过

- 本变更必须新增组件测试覆盖 FR-01..FR-04 的可判定行为（请求体携带 attachment_ids、成功后清附件、弹窗预览、附件豁免空文本），且触及模块相关测试与 lint 必须全绿后方可收口。

#### 场景：测试与 lint 全绿

- Given：代码改动完成
- When：跑触及组件的相关测试文件与 lint
- Then：全部通过，无既有用例回归

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「定时创建请求携带附件 id」
FR-02: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「定时创建成功后清空附件 chips 与元数据镜像」
FR-03: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「定时弹窗展示附件预览列表」
FR-04: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「带附件空文本可创建定时消息」
FR-05: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx（全文件）+ pnpm lint 触及文件
