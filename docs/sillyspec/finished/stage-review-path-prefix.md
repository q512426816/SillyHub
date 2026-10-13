# stage review.json 期望路径带阶段前缀，子代理直写易错位

**发现于**：2026-10-10-workspace-ref-intake（brainstorm 阶段，2026-10-10）

## 现象
marker 文件内容是 `review-2026-10-10-131956`，但 Stage Review Gate 期望路径是 `.runtime/stage-reviews/brainstorm-review-2026-10-10-131956/review.json`（带阶段前缀拼接）。独立审查子代理按 marker id 直写 `stage-reviews/review-.../review.json`，gate 报缺失。

## 绕过方案（已验证）
`sillyspec register-stage-review --change <名> --stage <阶段> --from <既有review.json路径>` 一步注册到规范路径（生成新 run-id + 覆盖 marker + 自检）。

## 改进建议
① gate 报错文案已给完整路径（好）；但「撞 gate 报缺 review.json 时 gate 也 echo 完整路径 + 写 marker」的场景里，marker id 与期望路径的拼接规则（阶段前缀）没有明示给 agent，容易第一次写错位。② review 派发 prompt 的注入段建议直接给出完整期望绝对路径（现在有时只给 run-id）。

## 处置记录（2026-10-13）

**建议②已修**（sillyspec 仓工作树）：`renderReviewJsonContract`（prompt 注入的产物契约块）
新增「本次完整绝对路径」行——从 changeDir 反解 specRoot 拼全路径并标注「勿手拼 runId/漏
阶段前缀」（坑实证形态：marker 只有裸 runId，子代理直写漏 `<stage>-` 前缀即错位）。
无 changeDir 时不输出该行（防御）。建议①（gate 报错给完整路径）坑内自证已在。stage-review
族测试 11/11 绿。绕过命令（register --from）继续有效。归档。
