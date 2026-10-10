---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 2026-10-09-attachment-inline-reference

## Wave 1（基础层）
- task-01

## Wave 2（组件层，依赖 Wave 1）
- task-02

## Wave 3（单聊输入区，依赖 Wave 2）
- task-03

## Wave 4（单聊发送置换，依赖 Wave 3）
- task-04

## Wave 5（群聊闭环，依赖 Wave 3 组件与模式）
- task-05

## Wave 6（历史渲染接入，依赖 Wave 2）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 附件引用纯函数库 + 单测 | W1 | P0 | — | FR-02, FR-04, D-002@v1, D-003@v1 | token 构建/唯一化分配/剥离/发送置换/历史解析五个纯函数 |
| task-02 | 镜像高亮层与历史渲染组件 + 单测 | W2 | P0 | task-01 | FR-03, FR-06, D-001@v1, D-005@v1 | InputRefOverlay（标签样式+×角标）与 InlineAttRefText（解析渲染） |
| task-03 | 单聊输入区接入（右击插入/映射/联动）+ 用例 | W3 | P0 | task-01, task-02 | FR-01, FR-02, FR-03, FR-05, D-004@v1, D-006@v1 | session-input-bar 右击 contextmenu、attTokenMap、onAttTokenMapChange 回传、handleRemove 联动剥离、镜像层挂载 |
| task-04 | 单聊发送置换 7 点位接线 + 用例 | W4 | P0 | task-03 | FR-04, D-003@v1 | page 组装 2773/2909 + 定时 830 + 团队触发 3067；dialog 组装 1068/1220 + 定时 307（Grill 盘点清单单聊侧） |
| task-05 | 群聊闭环（输入区接入 + handleSend 置换）+ 用例 | W5 | P0 | task-03 | FR-01..FR-05 | group-chat-panel 右击/映射/镜像层/联动/handleSend 置换（群聊无定时发送） |
| task-06 | 历史渲染接入（单聊正文段 + 群聊气泡）+ 用例 | W6 | P0 | task-02, task-04 | FR-06, D-005@v1 | turn-segment-views 与群聊气泡正文接 InlineAttRefText + 点击开 FilePreviewModal |

## 关键路径
task-01 → task-02 → task-03 → task-04 → task-06（最长链，决定最短交付周期）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 后端 API/存储零变更：不新增/修改任何 API、schema、存储格式（附件上传/删除/发送端点、attachment_ids 参数、头部标记行机制全部不动）。
- 未插入引用时行为与现状完全一致（零回归回退路径）：tokenMap 空、镜像层不渲染、substituteAttRefsForSend 原样返回。
- 发送置换格式恒定 `[附件引用:<uuid>|<name>]`（uuid 36 位 hex，口径对齐 parseAttachmentMarkers）；孤儿 token 原样保留（降级纯文本）。
- 同名唯一化序号不随删除重排；映射 attTokenMap 按附件 id 锚定。
- UI 中文文案；组件兼容 Windows/Linux/macOS；品牌色用 brand-* 语义阶（多主题铁律）。
- 不换富文本编辑器；不做移动端长按（显式边界）。

## 全局验收标准
1. 所有新增单元测试与被触既有测试通过（attachment-refs / input-ref-overlay / attachment-ref-tag / session-input-bar 系 / group-chat-panel 系 / page / dialog 相关）
2. tsc 零错、eslint 零错（存量警告不新增）
3. （brownfield）未插入引用时输入区与历史渲染行为逐字不变
4. 发送链路实测：带引用消息发出后正文含 `[附件引用:uuid|name]` 且 uuid 与随消息附件一致

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-03 | 镜像层组件渲染 + 挂载零回归用例 |
| D-002@v1 | task-01, task-03 | 唯一化分配单测 + 右击插入用例 |
| D-003@v1 | task-01, task-04, task-05 | 置换单测（含孤儿降级）+ 7 点位/群聊接线用例 |
| D-004@v1 | task-03, task-05 | 联动剥离用例 |
| D-005@v1 | task-02, task-06 | 历史解析渲染 + 点击预览用例 |
| D-006@v1 | task-03, task-05 | 右击插入/重复插入用例 |
