---
id: task-05
title: 'R-04: collapse stale prose params in session-redesign module css'
title_zh: 'R-04 收口——session-redesign.module.css 旧参数并存'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P2
depends_on: []
blocks: []
requirement_ids: []
decision_ids: [D-018@v1]
allowed_paths:
  - frontend/src/app/proto/session-redesign/session-redesign.module.css
target_files:
  - frontend/src/app/proto/session-redesign/session-redesign.module.css
goal: >
  消除 R-04 的「两处参数并存」：`frontend/src/app/proto/session-redesign/session-redesign.module.css` 仍保留
  D-021 之前的 14.5px / 0.55em，目前仅靠 `frontend/src/app/globals.css` 的 `!important` 压住才不生效——
  任何一处 CSS 顺序变动都会静默回流成旧字阶。
implementation:
  - '读 frontend/src/app/proto/session-redesign/session-redesign.module.css:16（--v2-reply-size: 14.5px）、:30-36（.v2 :global(.seg-text-body)）、:38-40（.v2 :global(.seg-text-body) p { margin-block: 0.55em }），确认它们是 D-021 之前的 v2 skin 遗留'
  - '二选一（优先①，改动面最小）：①删除 .v2 作用域下 .seg-text-body 的字号/段距规则，仅留一行注释「正文 15px/1.8/0.65em 由 globals.css:815-855 的 .seg-text-body 元素级规则唯一承担（D-021）」；②若该文件仍需自带参数，则把值改为 15px / 0.65em（不得再用 !important），并保证与 globals.css 同源可核对'
  - '本次只动 proto 皮肤文件，不改 globals.css（线 A 已锁数值，改它属回归）'
acceptance:
  - '`grep -n "14.5px" frontend/src/app/proto/session-redesign/session-redesign.module.css` 无命中'
  - '`grep -n "0.55em" frontend/src/app/proto/session-redesign/session-redesign.module.css` 无命中'
  - 重跑导出后 `prototype-session-final.html` 的正文块计数仍为 138，且导出脚本机械校验通过（未达标即非 0 退出且不落盘）
  - 三主题下 dev 路由目视无字阶变化（proto 皮肤仅影响 /proto/*，生产零影响）
verify:
  - cd frontend && Select-String -Path src/app/proto/session-redesign/session-redesign.module.css -Pattern "14.5px|0.55em" -SimpleMatch; if ($?) { throw "stale params remain" }
  - cd frontend && node scripts/export-hydrated.mjs --with-js --verify
constraints:
  - 不改 globals.css，不改任何生产组件
  - 导出产物禁止手改；必须重跑脚本生成
  - 删除规则时保留指向 globals.css 的注释，避免下一个人再补回来
related_tests: []
---
