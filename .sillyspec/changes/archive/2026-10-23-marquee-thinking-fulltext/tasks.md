---
author: flow-machine-draft
created_at: 2026-10-23T07:31:00.990Z
---
# 任务注册表（Tasks）— 2026-10-23-marquee-thinking-fulltext

- [x] task-01: thinking 条目改用 normalizeText，保留全文不截断（FR-01）
- [x] task-02: running ticker 用 rAF 一次滚到当前末尾、不循环；流式增长继续跟随，速度随落后距离自适应（FR-02）
- [x] task-03: 完成态与其他类型条目行为不变（FR-03）
- [x] task-04: 新增全文与时长测试，全部用例通过；lint / typecheck 通过（FR-04）
- [x] task-05: 原型加入长思考文本并核验全文流动（FR-05）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 修改 | frontend/src/app/proto/session-live-marquee/page.tsx |
| 新增 | .sillyspec/changes/2026-10-23-marquee-thinking-fulltext/visual-evidence.md |
