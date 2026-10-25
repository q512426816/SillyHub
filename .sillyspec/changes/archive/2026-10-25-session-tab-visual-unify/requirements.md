---
author: flow-machine-draft
created_at: 2026-10-25T05:16:46.963Z
---
# 需求规格（Requirements）— 2026-10-25-session-tab-visual-unify

## 功能需求

### FR-01: 对话与进度两视图中 agent 反馈信息块宽度统一为整行宽度-120px

- 对话视图与进度视图中，agent 反馈信息块（text 答复正文、上下文注入折叠卡、上下文压缩摘要折叠卡、轮触发溯源行、agent 文件卡容器、AskUser 问答块、轮失败错误卡）的最大宽度必须统一为「整行宽度 − 120px」（`max-w-[calc(100%-120px)]`），同一信息块禁止在两视图使用不同的限宽值（52rem / 86% 等并存形态禁止）。
- 用户侧气泡（右对齐 56% / 引导段 80%）与系统事件居中装饰行不属于 agent 反馈信息，不在本条统一范围内。

#### 场景：两视图宽度一致

- Given：同一会话的同一轮包含 agent 答复正文与折叠卡类段。
- When：分别切换到对话视图与进度视图查看。
- Then：各 agent 反馈信息块的最大宽度均为父容器宽度减 120px，两视图一致。

### FR-02: AskUser 提问记录两视图统一用对话视图的问答块组件渲染

- AskUser 提问记录在对话视图与进度视图必须使用同一问答块组件（DialogQaBlock 形态：❓ 问题 + → 回答）渲染，进度视图禁止再使用 AskUserToolCard 工具卡片形态；统一后 AskUserToolCard 无引用即删除。

#### 场景：进度视图提问卡换形态

- Given：某轮含 AskUser 提问历史（dialog 已回答）。
- When：切到进度视图查看该轮时间线。
- Then：提问以 dialog-qa-block 问答块渲染（❓ 问题 + → 回答），不再出现「AskUserQuestion」工具卡标签。

### FR-03: 右侧悬浮按钮文案由「变更文件」改为「变更」

- 会话页悬浮停靠组中变更文件入口按钮的可见文案必须为「变更」两字；无障碍 aria-label 保留完整语义描述（「查看会话关联的变更文件」）。

#### 场景：入口按钮文案

- Given：会话已关联至少一个变更（入口可见）。
- When：查看悬浮停靠组的变更入口按钮。
- Then：按钮可见文案为「变更」（不含「文件」二字）。

### FR-04: 受影响的既有测试断言同步更新，本变更相关测试通过

- 因本次改动而失效的既有测试断言必须同步更新为新契约（禁止为躲报错删除测试），且本变更触及的测试文件与 lint 必须全部通过。

#### 场景：回归验证

- Given：上述改动落盘。
- When：运行本变更触及的 vitest 测试文件与 lint。
- Then：全部通过，无跳过、无注释掉断言的假绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「无框形态：容器挂 seg-text-body（w-full + 52rem 阅读限宽），无气泡框样式类」（断言更新为新限宽类）
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx「all 视图 AskUser 提问按时间戳穿插在段线对应位置（merged 排序平移）」（断言更新为问答块形态）
FR-03: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx（入口按钮文案断言「变更」）
FR-04: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx（头注释与口径同步后全绿）
