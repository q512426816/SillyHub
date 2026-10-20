---
author: flow-machine-draft
created_at: 2026-10-20T05:34:08.285Z
---
# 任务注册表（Tasks）— 2026-10-20-preset-engine-endpoint

- [x] task-01: llmProviderPresets.ts 类型加 codex 覆盖 + 智谱/OpenCode 两条声明实测端点；presets 测试加常量断言——验证：vitest presets 套件绿
- [x] task-02: llm-provider-form.tsx applyPreset 按引擎分派 + 勾选 codex↔claude 联动（切端点/模型/清 env/互斥取消/notice）；form 测试加 3 联动用例——验证：vitest form 套件绿
- [x] task-03: frontend 全量测试 + lint ——验证：pnpm test/lint 全绿（既有用例零改动）
- [x] task-04: 部署腾讯云生产（main 打包 + scp + load-and-up，health 核对）并浏览器侧抽查新建表单联动（或以组件测试作为交付验证留档）
