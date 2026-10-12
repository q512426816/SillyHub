---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-pi-oldhost-fallback-pin

## 功能需求

### FR-01: 测试钉子：pi(mcp=true) mission_worker 成功轮立即零代报（防双写语义不变），+90s 探测 artifacts 仍空且 mission 活跃 → 兜底代报恰一次（旧版 pi 宿主收敛面），载体对齐既有 claude 延迟兜底用例

- 测试必须存在 pi 载体用例：mission_worker 成功轮立即路径零代报（workerDone 零调用）、fake 计时推进 90s 且 getMissionStatus 返回 artifacts 空且 active=true 后 workerDone 恰一次（summary=全文、sessionId=分身会话）；既有门控矩阵与 codex/claude 用例语义不变。

#### 场景：旧版 pi 宿主收敛面钉住

- Given mission_worker + pi + 成功轮全文非空 + 探测返回 artifacts 空且 mission 活跃
- When 立即检查与 +90s 计时推进
- Then 立即零代报、90s 后兜底代报恰一次

### FR-02: daemon.ts 立即代报门注释与测试文件头注补披露：旧版 pi 宿主（运行时门控跳过注入）经 +90s 延迟探测兜底收敛，静态 caps 表不感知宿主版本属有意设计

- daemon.ts 立即代报门控注释与测试文件头注必须写明：pi 静态 caps.mcp=true 描述机制支持（SPIKE-00 pi>=1.0），宿主旧版由 pi-rpc-driver 运行时门控跳过注入、该形态经 provider 无关的 +90s 延迟探测兜底收敛（90s 延迟属设计内），两道门依据不一致不构成产出丢失。

#### 场景：披露落盘

- When 审阅 daemon.ts 兜底代报段注释与测试头注
- Then 上述披露文本可见且与实现行为一致

### FR-03: 生产代码零逻辑改动（注释与测试面变更）

- 本变更禁止改动任何生产逻辑：daemon.ts 仅允许注释行增改，providers/caps/驱动门控/延迟探测逻辑零变化；交付面仅 daemon.ts 注释 + 测试文件。

#### 场景：零逻辑改动核验

- When 对比基线 diff
- Then 生产代码仅注释行差异，测试仅新增用例与头注

### FR-04: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts 全文件

- 本变更只必须运行该测试文件全文件，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行该测试文件
- Then 新增 pi 钉子与既有用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「pi(mcp=true，旧版宿主注入跳过形态) 成功轮：立即零代报；+90s 探测无 artifacts → 兜底代报（旧版 pi 宿主经延迟探测收敛，2026-10-12-pi-oldhost-fallback-pin）」
FR-02: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「pi(mcp=true，旧版宿主注入跳过形态) 成功轮：立即零代报；+90s 探测无 artifacts → 兜底代报（旧版 pi 宿主经延迟探测收敛，2026-10-12-pi-oldhost-fallback-pin）」
FR-03: 不适用：零逻辑改动承诺由 change.patch 冻结面 diff 直接核验，无独立测试面
FR-04: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts（全文件回归）
