# Requirements：会话附件

## FR-1 图片上传与预览
输入栏选图（png/jpeg/webp/gif）→ 即传 backend → 缩略图 chip 预览（可删）。
限制：单张 ≤5MB、每消息 ≤5 张；超限前端预检拒绝 + backend 权威 4xx。

## FR-2 图片多模态注入
发送后模型直接看到图片内容：backend 读 MinIO 组 base64 → SESSION_INJECT
attachments → daemon mapUserTurnInputToSdk 转 ImageBlockParam。
帧保护：payload 内联 base64 总量 >8MB → 全部附件改 daemon 回拉（D-4）。

## FR-3 文件上传
任意类型文件（单份 ≤20MB、每消息 ≤5 份）上传 MinIO + chip 预览可删。

## FR-4 文件落盘供 agent 消费
daemon 经 GET /session-attachments/{id}/content（hub-client 既有凭证通道）
下载到 `{cwd}/attachments/{name}`（同名加序号），prompt 追加路径清单；
下载失败单文件降级标注，turn 不中断。

## FR-5 PDF 多模态直读
PDF 走 DocumentBlockParam base64（同 FR-2 链路，media_type=application/pdf）。

## FR-6 历史回显
inject 时 user_input 日志 content 头部插标记行 `[附件:{id}|{kind}|{name}]`；
前端解析标记：图片拉 /content 显缩略图（点击放大），文件显只读 chip；
解析失败按原文本显示（容错）。

## FR-7 引擎门控（codex）
前端附件入口禁用 + backend 携附件 inject 到非 claude 会话 → 422
（HTTP_422_SESSION_ATTACHMENTS_UNSUPPORTED）+ driver 静默忽略。

## FR-8 草稿生命周期
选文件即传（session_id=null 草稿行）；发送时回填 session_id（提交时持久化，
对齐参考实现）；草稿可删（已绑定消息的不可删）；48h 未发送草稿行定期清理。

## FR-9 空文本豁免
attachment_ids 非空时允许空 prompt（看图说话，D-7）；纯文本仍要求非空。

## FR-10 多模态能力门控与降级（用户补充）
非多模态模型（如 GLM-4.5 文本版）不能直收图片——向其发 ImageBlock 会 400 或被
中转站静默丢弃。要求：①供应商级 multimodal 三态标记（auto 模型名启发式/手动
覆盖，未知别名=不支持，保守侧）；②发送时按会话实际生效 provider 判定，不支持
则图片/PDF 自动降级为文件落盘模式（turn 不失败）；③前端附件区明示降级提示。

## 验收标准

1. 发送含截图的消息（多模态模型）→ 模型回复能描述图中内容
2. 发送 .log 文件 → agent 用 Read 读到并引用其中内容
3. 发送 PDF（多模态模型）→ 模型直接总结 PDF 内容
4. 重进会话 → 图片缩略图 / 文件 chip 正常回显
5. 超限（>5MB 图 / >5 张 / >20MB 文件）→ 明确错误提示，不发脏数据
6. codex 会话 → 无附件入口；构造请求 → 422
7. 纯附件无文字消息 → 正常发送与回复
8. 非多模态 provider（multimodal=false 或 auto 未命中）发图 → turn 不失败，
   图片落盘 + prompt 注明降级；前端显示降级提示条
