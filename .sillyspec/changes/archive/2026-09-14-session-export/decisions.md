---
author: qinyi
created_at: 2026-09-14 13:59:56
---

# Decisions — 2026-09-14-session-export

## D-001@v1 同步流式导出(方案 A)

- **type**: architecture
- **status**: confirmed
- **source**: user
- **question**: 会话记录一键导出的实现方案:同步流式 / 异步任务+文件中心 / 纯前端拼装?
- **answer**: 方案 A 同步流式导出——后端在 daemon 会话域新增导出端点(POST /api/daemon/sessions/export),同步查库组装:对话档直接回 Markdown 文本,完整档后端从 MinIO 取附件流打成 zip 一次性回给浏览器;前端复用 ppm 已有 downloadExcel 下载骨架(带 401 刷新重试,在 lib/daemon/ 新写不改 ppm 文件)。
- **normalized_requirement**: 导出为同步只读能力,无任务表/轮询/服务端暂存;单请求完成下载;附件打包在后端做。
- **impacts**: backend 新增 session_export.py 路由 + service/export.py;前端新 lib/daemon/session-export.ts;不引入异步基建。
- **evidence**: brainstorm Step 4 方案选择轮,用户经 AskUserQuestion 亲选 A。
- **priority**: P0
- 锚点: backend/app/modules/daemon/router/session_export.py:export_sessions
- 模块域: backend,frontend
- 否决理由(被拒方案):B 异步任务+文件中心——链路过设计(任务表+轮询+对象存储+过期清理),当前量级(日志 5000 行回放上限/附件单件 ≤20MB)用不上;C 纯前端——附件本体在 MinIO,前端取流鉴权/跨域硬伤,大对话占浏览器内存,换入口要重写。
- 复潮条件(被拒方案):单会话日志量级远超 2 万行或需导出进度反馈/断点续传/服务端留存产物时,B 可复潮;后端零改动的强约束出现时 C 可复潮。

## D-002@v1 导出格式=Markdown+JSON 双格式,附件按档位区分

- **type**: requirement
- **status**: confirmed
- **source**: user
- **question**: ①导出文件格式;②完整档附件(本体在 MinIO)处理口径?
- **answer**: ①双格式:「对话」档导 Markdown(可直接阅读/贴给别的 AI),「完整」档导 JSON(结构化保真:思考/工具调用/轮次元数据/token 用量);②附件:对话档仅保留附件标记([附件:名|类型]),完整档导 zip(记录文件 + attachments/ 目录放附件原文件,后端从 MinIO 取流)。
- **normalized_requirement**: 两档内容口径固定:chat=user/assistant 文本(群聊带发言人前缀);full=+thinking/tool_call/edit_patch/runs 元数据/token 用量/任务卡/附件本体。
- **impacts**: 响应矩阵(chat 单会话=.md,其余 zip)、full JSON 顶层结构、附件打包与 missing 降级。
- **evidence**: brainstorm Step 3 需求澄清轮,用户经 AskUserQuestion 亲选。
- **priority**: P0
- 锚点: backend/app/modules/daemon/session/service/export.py:_render_chat_markdown
- 模块域: backend,frontend
