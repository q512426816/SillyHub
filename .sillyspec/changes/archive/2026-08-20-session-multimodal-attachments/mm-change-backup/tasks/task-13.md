---
id: task-13
title: history-attachment-marker-rendering
title_zh: 历史消息附件标记行回显
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P1
depends_on: [task-11]
blocks: [task-14]
requirement_ids: [FR-6]
decision_ids: [D-3]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/runtime-session-helpers.tsx
provides: []
expects_from:
  task-11:
    - contract: AttachmentApi
      fields: [contentUrl]
goal: >
  历史回显——解析 user_input prompt 头部的附件标记行，图片渲染缩略图（点击放大）、文件渲染只读 chip，解析失败按原文本容错。
implementation:
  - runtime-session-helpers.tsx 新增导出标记行解析纯函数，行首锚定正则匹配附件标记行（前缀「附件:」+ UUID + 竖线 kind + 竖线 name），id 必须 UUID 形态、kind 限 image/file，防用户伪标记误报（Grill X-006）
  - 解析产出附件列表（id/kind/name）与剥除标记行后的剩余文本两份，无标记行时原样返回
  - TurnTimeline 用户气泡 prompt 渲染前过该解析，气泡内先渲染附件区再渲染剩余文本
  - 图片缩略图经鉴权 fetch 拉 blob 转 objectURL 渲染（img 标签无法携带 Authorization 头，contentUrl 不能直接当 src），点击新窗放大（window.open 复用同一 objectURL），组件卸载或附件更换时 revokeObjectURL 防泄漏
  - 文件附件渲染只读 chip（文件名），不带删除按钮（历史不可变）
  - 解析失败的标记行按原文本显示在气泡内（容错，不吞不崩）
  - 确认 logsToTurns 的 user_input 提取链路对标记行原样保留（解析职责在渲染层，数据层零改动），无标记行的旧会话 prompt 渲染路径零回归（brownfield）
acceptance:
  - 重进会话后带附件的历史消息渲染为缩略图/文件 chip，不再裸显标记行文本
  - 非 UUID 伪标记或 kind 非法按原文本显示不误解析
  - 图片点击新窗可看大图，多次进出会话无 objectURL 泄漏
  - 无附件历史消息与旧版渲染完全一致
verify:
  - cd frontend && pnpm typecheck && pnpm test
constraints:
  - 标记行格式由 task-06 写入侧定义（「附件:」+ id + 竖线 kind + 竖线 name），两侧格式逐字一致，解析侧不得另行发明格式
  - 宁可不解析不可误解析（X-006），UUID 锚定是硬条件
  - objectURL 生命周期严格管理（挂载创建卸载回收）
  - 回显解析的系统性测试归 task-14（design §8 前端 vitest 历史标记行解析渲染），本卡以零回归加手工验证兜底
related_tests: []
---
