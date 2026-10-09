---
author: flow-machine-draft
created_at: 2026-10-09T07:21:15.089Z
---
# 需求规格（Requirements）— 2026-10-09-close-trace-single-set-platform

## 功能需求

### FR-01: 前端 change-patch.json 文件预览渲染结构化清单面，scopeAudit 子对象在场时叠加对账快照视图，缺席时降级说明

- 必须：structured-views.tsx 的 knownJsonView 对 basename=change-patch.json 且 files 为数组的 JSON 分发到专用视图 ChangePatchView：摘要条（变更名/patch 状态徽章/文件数/±行数/baseline/head/sha256/冻结时间）+ 交付文件表（≤500 行）；scopeAudit 子对象含 rows 数组与 totals 时复用 ScopeAuditView 渲染对账快照，缺席时显示降级说明文案。
- 禁止：移除或改动 scope-audit.json 既有结构化分支与后端 assets.py 的 scope-audit.json 回退链（存量归档仍为旧形态）。

#### 场景：主路径
- Given 新形态归档（change-patch.json 含 scopeAudit 子对象），When 前端预览该文件，Then 渲染结构化清单摘要 + 交付文件表 + 对账快照视图，非纯 JSON 折叠树。
- Given 旧形态 thin 冻结件（change-patch.json 无 scopeAudit 子对象），When 预览，Then 清单面照常 + 降级说明文案。

### FR-02: 旧形态归档（四件套/heavy 双件）预览不回归

- 必须：scope-audit.json 结构化分支（rows 数组 + totals 特征判定）原样保留；后端 assets.py/_read_patch_meta 的 scope-audit.json 回退路径与 _read_patch_file_diff 的 scope-audit.patch 回退路径零改动（本次仅 schema.py docstring 注释更新）。

#### 场景：主路径
- Given 存量 heavy 双件归档（仅 scope-audit.json/.patch），When 前端预览 scope-audit.json，Then 既有 ScopeAuditView 照常渲染。

### FR-03: tsc --noEmit 通过；change 模块相关测试无新增失败（预存环境错误除外）

- 必须：frontend tsc --noEmit 退出码 0；backend change 模块测试错误数不高于基线（预存 28 个环境 ERROR 与本次改动无关，stash 对照已验证基线同象）。

#### 场景：主路径
- Given 前端改动完成，When 跑 npx tsc --noEmit，Then exit 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/files/__tests__/structured-views.test.tsx「change-patch.json（含 scopeAudit）→ 清单摘要 + 交付文件表 + 对账快照复用」「change-patch.json（旧形态无 scopeAudit）→ 清单面照常 + 降级说明；结构漂移 → null」（评审 P2 清偿：仓内实有组件测试面，初版作答有误）
FR-02: frontend/src/components/files/__tests__/structured-views.test.tsx「scope-audit.json → 裁决表格（徽章/路径/统计齐全）」（既有用例不改动即过=旧分支零回归）+ 代码 diff 审阅（knownJsonView 仅新增分支）
FR-03: frontend `npx tsc --noEmit`（exit 0 实测）+ vitest structured-views 21/21 + backend pytest change 模块（28 预存 ERROR 与基线同象，零新增）
