---
author: flow-machine-draft
created_at: 2026-10-09T20:10:00.000Z
---
# 需求规格（Requirements）— 2026-10-09-graph-text-backslash

## 功能需求

### FR-01: GRAPH_TEXT_BLACKLIST_RE 字符集补反斜杠（\）

- `sillyhub-daemon/src/runtime-handler.ts` 的 GRAPH_TEXT_BLACKLIST_RE 必须在既有字符集外补 `\`，注释同步说明动机（结尾反斜杠转义拼串闭合引号、吞并后续旗标进锚点参数的参数粘连形态）。

#### 场景：反斜杠锚点被拒

- Given anchor/anchor2/search 含反斜杠（尾缀/中缀/开头任一形态）
- When 消毒判定
- Then validation_rejected 且不 spawn（sillyspecCmd 零调用）

### FR-02: 先红后绿用例钉住

- 测试新增反斜杠样本矩阵用例（三参数位 × 三形态），旧黑名单下该用例必须失败（样本到达命令串），新黑名单下全绿；既有 knowledge.graph 消毒矩阵用例保持绿。

#### 场景：加固可回归检测

- Given 未来有人误删黑名单中的 \
- When 跑 ②b 用例
- Then 红（反斜杠样本放行到达 spawn 断言失败）

### FR-03: 既有面零回归

- 既有 daemon 相关测试全绿（本文件 26 用例含新增），daemon tsc --noEmit 0 error；正常节点 id 字符集（/ # : @ - _ . 中文）零冲突——实测样本用例 ③ 继续放行。

#### 场景：正常 id 不受影响

- Given 实测样本 decision:decisions/x.md#D-1@v1、src/foo.js 等
- When 消毒判定
- Then 放行拼串（用例 ③ 钉住）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/knowledge-governance-handler.test.ts「②b 反斜杠样本全拒（2026-10-09 审查加固：结尾 \ 转义闭合引号吞旗标，先红后绿钉住）」
FR-02: test/sillyhub-daemon/tests/knowledge-governance-handler.test.ts「②b（旧黑名单形态下反斜杠样本放行即红——先红实证由字符集 diff 可推）」
FR-03: test/sillyhub-daemon/tests/knowledge-governance-handler.test.ts「①/②/③ 既有用例 + ③ 正常节点 id 样本全放行；26 测绿 + tsc 0（已实测）」
