---
id: task-09
title: 真实仓库全链路实测（搜索耗时 / 10MB download / 三降级态触发）+ design.md R-03/R-04 回填
title_zh: 全链路实测与风险数据回填
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P1
depends_on: [task-08]
blocks: []
requirement_ids: [FR-01, FR-03, FR-04, FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - ".sillyspec/changes/2026-08-18-workspace-file-browser/design.md"
  - "backend/app/modules/explorer/router.py"
provides: {}
expects_from: {}
goal: 在真实环境（本机 daemon + 本仓库工作区，约数千文件）跑通全链路实测——量化 R-03 搜索耗时与 R-04 10MB download 表现、真实触发三降级态并留存证据，实测数值与结论以备注形式回填 design.md §10 R-03/R-04 行，完成 plan 全局验收中的实测项。
implementation:
  - 环境准备——本机 backend（Docker 或 uvicorn 均可）+ 新版 daemon 在线，workspace 绑定指向本仓库 root，浏览器登录后从「文件」标签进入页面操作
  - 搜索耗时实测（R-03）——对全树搜索至少 3 个关键词（如 page、test、config）分别记录耗时与命中数，覆盖一次命中超 100 触发 truncated 的场景，记录 Windows 宿主机数值
  - 10MB download 全链路（R-04）——workspace root 内临时放一个 ≥10MB 测试文件，前端走下载按钮全链路下载，校验落盘文件与源文件 sha256 一致，记录耗时与是否出现 WS 断连/超时，测后删除测试文件
  - 三降级态真实触发——①未绑定（用无绑定账号或将绑定行 daemon_id 置 NULL）预期 404 引导卡；②daemon 离线（停掉 daemon 进程）预期 502 离线卡；③版本过低（临时屏蔽 explorer handler 注册或 mock method_not_found）预期 422 升级卡；各留浏览器截图或 curl 日志证据
  - 回填 design.md §10——在 R-03 与 R-04 行的应对策略列后追加「实测 2026-08-18」备注（数值、结论、是否维持定级），不改风险定级与其它章节
acceptance:
  - 搜索耗时至少 3 组数值记录在案（关键词、耗时、命中数、是否 truncated）
  - 10MB 文件 download 成功且 sha256 与源文件一致、耗时已记录；若失败如实记录现象（WS 1009 断连/超时）并在备注中给出结论
  - 三降级态各自有触发方式说明与截图或日志证据，判定口径与 task-08 一致
  - design.md R-03/R-04 行已附实测备注且其余章节零改动
verify:
  - curl 带真实 JWT 直打四端点（tree/file/download/search）各至少一次确认响应形态与错误码
  - 回填后重读 design.md §10 确认 R-03/R-04 行含实测数值备注
  - git status 确认零源码变更（本 task 仅 design.md 落盘改动）
constraints:
  - 实测 task 不做源码修改——router.py 仅作实测请求入口（只读参照），发现缺陷另开 quick 修复，不在本 task 内改
  - design.md 只在 §10 R-03/R-04 行追加实测备注，不改风险定级、应对策略与其它章节
  - 三降级判定口径与 task-08 及 backend 映射一致——404 未绑定（含 daemon_id NULL）、502 离线、422 版本过低
  - 10MB 测试文件放 workspace root 内临时位置，测后清理不提交仓库；实测证据以文本数值回填 design 备注
related_tests: []
---
