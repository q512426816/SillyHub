---
author: qinyi
created_at: 2026-09-02 21:26:25
---

# 任务清单（Tasks）

> Wave 划分由 plan 阶段定稿；此处为任务级分解与验收口径。

## T1 backend 数据层
- T1.1 model.py：Machine.sillyspec_status JSON 列（注释含变更名与 None=清除语义）
- T1.2 迁移 add_machine_sillyspec_status（可逆）
- T1.3 schema.py：心跳载荷模型 + 机器视图嵌套读取模型
- 验收：迁移 up/down 通过；null 载荷置 NULL 用例绿

## T2 backend 接口层
- T2.1 心跳处理落库（服务层）
- T2.2 机器视图端点透出嵌套 sillyspec_status
- 验收：心跳含新字段落库正确；既有心跳消费回归用例绿

## T3 daemon 采集与上报
- T3.1 config.ts 采集间隔配置（默认 60s）+ 超时常量（复用 SILLYSPEC_TIMEOUT_MS 先例）
- T3.2 sillyspec 运行期管理器扩展：spawn 采集 + 三态降级矩阵 + 32KB 预算截断/计数降级
- T3.3 心跳组装追加 sillyspec_status
- 验收：三态矩阵全覆盖用例绿（成功/null/瞬态保留快照）

## T4 前端类型与数据
- T4.1 pnpm gen:types（预检 node_modules）→ api-types.ts + openapi.json
- T4.2 lib/daemon.ts 机器数据读取扩展
- 验收：tsc 0 错误

## T5 前端卡片
- T5.1 changes-overview-card.tsx 组件（健康条/变更行/管线/ghost 折叠/冲突区/过滤/占位与过期态）
- T5.2 /workspaces/[id]/page.tsx 挂载（SectionCard 网格，引导跳变更中心）
- T5.3 组件测试（真实 envelope fixture 含 readable/command 字段）
- 验收：组件用例绿；双主题视觉对齐原型 v2

## T6 集成验收
- 本地起三端：卡片数据与同刻 CLI 直连一致；null 占位与数据过期标记实测

---

<!-- 外来条目保留（非本变更内容，原文件残留的 quick 任务行，勿删）：
- [ ] ql-20260902-022-1ac4 群聊运行徽标实时性+URL 深链+头部工具栏（合并收口）
-->
