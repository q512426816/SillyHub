# test-utils 变更索引

> 自动生成。正文历史已迁出，详见 test-utils.md。
> author: qinyi
> created_at: 2026-09-21 12:10:00

- ql-20260921-008-b962 | 第三方结构查询收口 dom-queries.ts + 样式断言审计结论：新建 src/test/dom-queries.ts（antd Modal.confirm/Select/Tree/Spin/Segmented/Badge/Image + echarts 容器 + animate-spin 加载态，17 个导出），codemod 迁移 22 个测试文件约 95 处 `.ant-*`/`.echarts-for-react` 字面量查询——antd/echarts 升级的测试爆炸面收拢到单文件；scan-docs-page 与 pre-session-picker 因并行会话改动暂缓。样式断言逐处审计后**零删除**：全部为有意契约守卫（bg-brand-600 主题语义阶、min-h-[44px] 触摸热区、R-01 单行槽位、原型对齐配色、tabular-nums 用例本体等）。验证：22 文件 513 用例全过、tsc 干净、eslint 0 error（13 warning 全存量）。
- ql-20260921-006-2095 | 覆盖率工具接入（详见根 ci.changelog）：vitest coverage 段落归本卡测试语义管辖，text+html 双报告、不设 thresholds。
