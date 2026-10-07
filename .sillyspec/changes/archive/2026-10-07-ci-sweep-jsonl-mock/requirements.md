---
author: flow-machine-draft
created_at: 2026-10-07T15:31:05.409Z
---
# 需求规格（Requirements）— 2026-10-07-ci-sweep-jsonl-mock

## 功能需求

### FR-01: onlyoffice-preview.test.tsx 的 ../previewers mock 补 JsonlPreviewer 桩导出，该文件全绿

- mock 工厂必须包含桶文件（previewers.tsx）当前全部被 RENDERER_MAP 引用的导出——本次必须补 JsonlPreviewer 桩（data-testid="jsonl-previewer"），套件收集不得再炸。

#### 场景：主路径

Given 桶文件含 JsonlPreviewer 导出 / When onlyoffice-preview.test.tsx 收集执行 / Then mock 提供全部导出，套件收集成功且全用例绿。

### FR-02: 顺带审计其余枚举式 previewers mock 无缺导出（file-preview-modal.test.tsx 已含 JsonlPreviewer）

- 全仓枚举式 vi.mock("../previewers") 必须逐一核对——本次审计结论：仅 onlyoffice-preview 与 file-preview-modal 两处，后者已含 JsonlPreviewer，禁止多余改动。

#### 场景：主路径

Given 全仓仅两处枚举式 previewers mock / When 逐一比对桶导出 / Then 除 FR-01 目标外无缺导出。

### FR-03: 本地仅跑相关两文件全绿（全量留 CI），frontend-ci 推送后转绿

- 本地必须只跑两个相关测试文件（20 用例）且全绿，全量必须留给 CI；推送后 frontend-ci 必须 转绿。

#### 场景：主路径

Given mock 补齐 / When 本地跑相关两文件 / Then 全绿；When push / Then frontend-ci success。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/files/__tests__/onlyoffice-preview.test.tsx「OnlyofficePreviewer 路由（DS 启用走 DS；config 失败降级本地渲染器）」全套件
FR-02: 不适用：审计性核对（grep 全仓 vi.mock("../previewers") 仅两处，file-preview-modal.test.tsx 已含 JsonlPreviewer，无代码改动面）
FR-03: frontend/src/components/files/__tests__/file-preview-modal.test.tsx + onlyoffice-preview.test.tsx 两文件 20 用例（本地已实证；frontend-ci 转绿以推送后 Actions 实跑为准）
