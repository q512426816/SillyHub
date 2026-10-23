---
author: flow-machine-draft
created_at: 2026-10-23T06:26:59.965Z
---
# 需求规格（Requirements）— 2026-10-23-rename-ghost-pit-doc

## 功能需求

### FR-01: docs/sillyspec/finished/ 新增坑11 文档，含现象/根因/修复/现场清理/验证要点五段，与坑9/坑10 体例一致并互链

- 必须新增 `docs/sillyspec/finished/坑11-rename-弃名不落台账平台幽灵永挂.md`，含「发现于」标注、现象、根因、修复（指向 sillyspec 仓变更 2026-10-23-rename-platform-tombstone）、现场清理、验证要点五段；必须在文中互链坑9/坑10 文档并标明本坑为坑9 幽灵家族第三变种；文档体例（引用块标注/段落结构）必须与坑9、坑10 一致。

#### 场景：主路径

- Given docs/sillyspec/finished/ 已有坑9、坑10 两篇体例模板
- When 本变更交付坑11 文档
- Then 文件存在于上述路径，五段齐备、互链坑9/坑10、体例一致，事实与 2026-10-23 事故排查记录（会话结论）一致

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯文档变更，无测试面；验收靠体例一致性核对与事实比对（坑9/坑10 先例同口径）
