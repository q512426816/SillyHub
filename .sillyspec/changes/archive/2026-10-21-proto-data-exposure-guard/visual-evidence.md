# 视觉证据 — 2026-10-21-proto-data-exposure-guard（2026-10-21 07:50 采集）

## 渲染对照（修复后 SSR 实渲染，非降级）

- 证据图：`visual-after-fix.png`（Playwright 全页截图，1440×900 viewport，dev server
  http://127.0.0.1:3000/proto/session-redesign，数据经迁移后路径 `.proto-staging/` SSR 读盘）
- DOM 级断言（curl 同路由，2026-10-21 07:47）：
  - 页面 6,852,023 字节；「加载真实会话…」占位 **0 命中**（真实数据已渲染，非占位态）
  - 真实会话标题「消防设施台账4轮」在场；会话 id `400ca9d3…` 2 命中；真实用户提问原文
    「没有看到框线」在场——迁移后取数路径完整还原迁移前渲染结果
- 暴露通道关闭断言：`GET /__proto/session-export.json` → **404**（迁移前 200 直下 3.3MB）
- 类型面：`pnpm typecheck`（tsc --noEmit）零错

## 「降级」措辞澄清（非视觉降级）

requirements/design 中的「占位/降级」指**容错路径语义**（staging 文件缺失/损坏时
`loadStagedSessionExport` 返回 null → 页面显示既有「加载真实会话…」占位，不白屏不崩）
——该 fail-soft 行为迁移前后逐字节一致，非本次引入的视觉降级。被移除的 public URL
运行时 fetch 兜底在迁移前即不可达（与 SSR 读同一份文件，文件在则 SSR 必中），
详见 design.md 接口契约节。

## 用户裁决留痕

用户于 2026-10-21 01:06 审阅只读风险报告（含「数据移出 public/（或脱敏）」方案与
fetch 兜底移除说明）后指示「修复」——即采纳移出方案；裁决上下文见 decisions.md D-001。
