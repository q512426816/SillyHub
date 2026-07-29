---
author: qinyi
created_at: 2026-07-29T10:19:10
---
# 任务清单（Tasks）— 模型调用失败可见性完整修复

> 只列任务名，细节（Wave 分组 / 依赖 / 验收点）在 plan 阶段展开。依据 design.md Phase 1-5 + 文件变更清单。

- [ ] task-01: 定义三端同构 ModelError 协议 + 类型枚举（daemon `model-error/types.ts` / backend `model_error.py` / frontend 类型经 `pnpm gen:types` 同步）
- [ ] task-02: daemon `model-error/classifier.ts` 实现（claude 错误归类：is_error / resultText / api_retry / assistant stdout → ModelError）+ 单测覆盖 8 类
- [ ] task-03: daemon stream-json adapter 接入 classifier（result is_error=true 时产出 ModelError，stream-json.ts:902+）
- [ ] task-04: daemon `notifyRunResult` payload 增 `error` 字段（hub-client.ts:530+）+ daemon.ts payload 映射（:1354-1397）+ session-manager turn 收尾携带
- [ ] task-05: backend AgentRun 加 `error_detail` 列（agent/model.py:26）+ alembic migration（全局 `backend/migrations/versions/`，down 接当前真实 head）
- [ ] task-06: backend InteractiveRunResultRequest 加 `error`（router.py:1084）+ `close_interactive_run`（run_sync/service.py:735 真实现 + service.py:508 facade + router.py:1118）接收写入 error_detail
- [ ] task-07: backend 新增 `GET /sessions/{id}/runs` 返回 error_detail + SSE（router.py:1880）推 error 事件 + `pnpm gen:types` 同步 OpenAPI
- [ ] task-08: frontend `pnpm gen:types` + normalize.ts 识别 error_detail 生成 error 类日志项（修正 :352 把 [ASSISTANT] API Error 误判 assistant）
- [ ] task-09: frontend `RunErrorItem` 组件（type → 图标 / 颜色 / 文案 / hint / actions）+ 单测
- [ ] task-10: frontend 会话页（agent/runtime 页）集成 RunErrorItem + run failed 状态标红 + actions（重发 inject / 切换供应商 / 查看详情 raw）
- [ ] task-11: 回归测试（agent-log-display-fix NOISE 折叠不误吞错误项 + 成功路径不回归）+ e2e 复现（GLM 额度耗尽 → 看到错误项）
- [ ] task-12: local.yaml modules 块加 daemon + agent 子模块 test 条目（防 verify fallback 全量；test 命令按实际测试目录）
