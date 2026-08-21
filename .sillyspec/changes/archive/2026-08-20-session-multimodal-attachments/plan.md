---
plan_level: full
---

# 实现计划（Plan）：会话附件（图片多模态 + 文件落盘）

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | Claude Agent SDK 实收 ImageBlockParam 块数组（daemon 本地起 query 喂 1×1 png，断言 turn 不报错） | task-10 推翻，改走 prompt 内 base64 转译（极端回退） |
| spike-02 | bigmodel anthropic 端点 + glm-4.5 发 image block 实测行为（400 / 静默丢） | D-9 降级语义校准（若静默丢而非 400，提示文案调整） |

> spike-01 可并入 task-11 首个测试用例执行；spike-02 需真实 key，执行时若无
> 环境则以 D-9 保守语义（未知=不支持）为准放行。

## Wave 1（backend 存储、上传与 inject 校验）

- task-01
- task-02
- task-03
- task-05

## Wave 2（下发协议与清理，依赖 W1）

- task-04
- task-06
- task-07
- task-08

## Wave 3（daemon 消费，依赖 W2）

- task-09
- task-10

## Wave 4（前端，依赖 W2 协议定形）

- task-11
- task-12
- task-13

## Wave 5（验证收尾）

- task-14
- task-15

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 模型+迁移（附件表+multimodal 列） | W1 | P0 | — | FR-1, FR-3, D-5 | 单迁移两表变更 |
| task-02 | MinIO 内容寻址接入 | W1 | P0 | task-01 | FR-1, FR-3 | 复用 modules/storage |
| task-03 | 上传端点 | W1 | P0 | task-02 | FR-1, FR-3, FR-8 | multipart+校验 |
| task-04 | 读取/删除端点 | W2 | P1 | task-03 | FR-6, FR-8 | 流式+immutable；与 task-03 同文件故分波 |
| task-05 | inject 校验+门控 | W1 | P0 | task-01 | FR-2, FR-5, FR-7, FR-9, FR-10 | D-6, D-7, D-9 落地 |
| task-06 | 组装下发+标记行 | W2 | P0 | task-03/05 | FR-2, FR-4, FR-5, FR-6, FR-10 | D-3, D-4 落地 |
| task-07 | daemon 协议扩展 | W2 | P0 | task-06 | FR-2, FR-4 | zod 可选字段 |
| task-08 | 草稿清理 | W2 | P2 | task-01 | FR-8 | cron 委托 |
| task-09 | daemon inject 消费 | W3 | P0 | task-07 | FR-2, FR-4, FR-5 | 下载落盘+降级 |
| task-10 | driver 块数组 | W3 | P0 | task-09 | FR-2, FR-5 | 零回归+spike-01 |
| task-11 | api-types+API 封装 | W4 | P0 | task-04 | FR-1, FR-3, FR-6 | 规则 21 |
| task-12 | 输入栏附件流+表单开关 | W4 | P0 | task-11 | FR-1, FR-3, FR-7, FR-10 | codex/降级门控；供应商表单 multimodal 覆盖 |
| task-13 | 历史回显 | W4 | P1 | task-11 | FR-6 | 标记行解析 |
| task-14 | 三端测试补齐 | W5 | P0 | W1-W4 | 全 FR | 矩阵见 design §8 |
| task-15 | E2E 验收+部署 | W5 | P0 | task-14 | 验收 1-8 | 含降级场景 |

## 关键路径

task-01 → task-02 → task-03 → task-05 → task-06 → task-07 → task-09 → task-10 → task-12 → task-14 → task-15

## 全局验收标准

- [ ] 后端 pytest 全绿（含新增附件套件）；前端 vitest 全量绿；daemon vitest 全绿
- [ ] （brownfield）不带附件的既有会话流程零回归（纯文本路径不动）
- [ ] 验收 1-8（requirements.md）逐项通过
- [ ] tsc/mypy/ruff/eslint 零新增错误

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-1 | task-07, task-10 | 内联 base64 链路（帧闸门下内联）测试 |
| D-2 | task-09 | 文件落盘+路径清单测试 |
| D-3 | task-06, task-13 | 标记行写入与解析测试 |
| D-4 | task-06 | 总量闸门单测（>8MB 切回拉） |
| D-6 | task-05/12 | codex 422 + 前端禁用测试 |
| D-7 | task-05 | 空文本豁免单测 |
| D-9 | task-05/06/12 | 启发式表测试 + 降级路由测试 + 提示条 |
| FR-10 | task-05, task-06, task-12, task-15 | 验收 8 |
| D-8 | task-04 | 生命周期独立（草稿/绑定边界）测试 |
