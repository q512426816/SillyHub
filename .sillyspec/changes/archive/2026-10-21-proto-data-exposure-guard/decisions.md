# 决策记录 — 2026-10-21-proto-data-exposure-guard

## D-001: 真实数据移出 public/（移出方案）并移除 public URL fetch 兜底

- **裁决：用户裁决**（2026-10-21 01:06，用户审阅只读风险报告后指示「修复」——报告明列
  「真实数据文件移出 public/（或脱敏）」与预览页读取路径随迁、fetch 兜底成为死码的处置面）
- 内容：
  1. `frontend/public/__proto__/session-export.json`（3.3MB 真实会话导出）移至
     `frontend/.proto-staging/`（gitignore 覆盖，不进 git/构建/静态服务面）——否决
     「脱敏后留 public/」（脱敏成本高且预览依赖真实文本形态）与「留 public/ 仅靠纪律
     不提交」（纪律非机制）。
  2. `view.tsx` 移除对 `/__proto/session-export.json` 的运行时 fetch 兜底：数据不在
     可 fetch 面后该路径恒 404，属死码移除；SSR 读盘成为唯一取数路径，文件缺失时
     保持既有「加载真实会话…」占位（fail-soft 语义零变化，非视觉降级——渲染对照
     证据见 visual-evidence.md）。
  3. `/proto/*` 路由 NODE_ENV 门禁本次不做：数据移出 public 后生产构建无真实数据可
     泄（最多空占位壳）；该门禁属进行中变更 2026-10-20-session-page-dsh-alignment
     已登记的 D-010 故障面，留其定稿处置（防跨变更越权改其交付语义）。

## D-002: proto/** 四文件改动以工作树状态随迁、不纳入本变更冻结面

- **裁决：agent 决策**（多 agent 共享仓归属判断；依据 AGENTS.md 规则 8/9）
- 四文件（staged-session-export.ts / view.tsx / types.ts / proto-fixtures.ts）整文件属
  进行中变更 2026-10-20-session-page-dsh-alignment 的未提交交付物；若本变更提交它们，
  会把该变更 ~1500 行 UI 交付偷进本变更 patch 冻结面、并推高其后续 flow start 基线致
  其自身 patch 缺失交付。故本变更只改其内行（路径常量/兜底/注释），冻结面缺口经
  `--accept-dirty-gap` 显式留痕（32 文件，含并行会话在途面）。
