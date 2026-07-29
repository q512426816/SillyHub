
## ql-20260729-004-5845 | 2026-07-29 14:31:35 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log/__tests__/normalize.test.ts

结果：需求：补 normalize.test.ts 的 task-08 模型错误可见性测试覆盖(model-error-visibility 归档遗留测试债)。根因：归档 verify 探针发现 normalize.test.ts(原 ~50 测)零覆盖 task-08 新增逻辑(buildErrorLogItem/isAssistantApiErrorText/classifyLog :352 修正/normalizeLogs 结构化错误项/brownfield 兜底/R-02/零回归)。方案：normalize.test.ts 追加 1 个 describe 块,含 buildErrorLogItem 8 类 type 参数化+type非法→unknown+message缺失→运行失败+retryable严格===true+code/hint/raw缺失→null+null非对象→null,isAssistantApiErrorText 识别/不误判,classifyLog [ASSISTANT]+API Error→error,normalizeLogs errorDetail 追加结构化 error 项+[ASSISTANT] API Error 行 hasStructuredError 时 hidden,brownfield 兜底,成功路径零回归。结果：normalize.test.ts 60 tests 全过(含 8 类参数化);node_modules 半坏 vitest shim 丢失 pnpm install --force 修复;frontend.md 变更索引追加 ql-ID。已 git add(normalize.test.ts+frontend.md)未 commit。