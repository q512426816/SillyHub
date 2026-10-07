---
author: flow-machine-draft
created_at: 2026-10-07T15:32:45.446Z
---
# 决策记录（Decisions）— 2026-10-07-ci-sweep-jsonl-mock

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：桶文件未来再加导出时本 mock 再度漏补（结构性重复成本）——已有注释约定承担提示职责，暂不引入 importOriginal 部分 mock（会放弃「断言降级目标桩」的精确控制，且与既有 10 桩风格不一致）。放弃方案：改用 vi.mock(importOriginal) 展开真实导出——放弃，枚举桩正是该套件断言 DS 降级路径的手段，混入真实组件会引入无关渲染依赖。
