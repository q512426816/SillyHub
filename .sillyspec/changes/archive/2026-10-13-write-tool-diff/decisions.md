---
author: flow-machine-draft
created_at: 2026-10-13T03:10:57.457Z
---
# 决策记录（Decisions）— 2026-10-13-write-tool-diff

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：无 patch 的覆盖写（非 claude provider）被整文件全绿展示，视觉上像新建文件。缓解：该分支标题保留「写入内容（N 行）」不称「新增文件」，复制按钮给完整原文兜底；claude 会话（主场景）覆盖写必有 patch、不受影响。 放弃的方案：(a) 嗅探 tool_result 文本（"File created successfully" vs "updated"）区分新建/覆盖——依赖各 provider 文案措辞，脆弱，放弃；(b) 同步接线 agent-log 变更运行日志视图——该视图 edit_patch 数据链未通（normalize 链需另动），超出薄跑道范围，留后续变更。
