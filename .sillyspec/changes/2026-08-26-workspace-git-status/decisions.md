---
author: qinyi
created_at: 2026-08-26 21:45:29
change: 2026-08-26-workspace-git-status
---

# 决策台账 — 2026-08-26-workspace-git-status

## D-001@v1 : 远程提交新鲜度采用自动 fetch 语义（带超时与降级）

- type: requirement
- status: confirmed
- source: brainstorm step 3 用户 AskUserQuestion 拍板（选项：手动刷新 fetch / 自动 fetch / 永不 fetch）
- question: 「服务器上是否有更新的提交」的数据怎么来？
- answer: 自动 fetch——每次打开页面自动后台 fetch 一次，超时保护与凭证失败降级提示。
- normalized_requirement: 打开页面触发一次 git fetch（15s 超时）；fetch 失败不阻断其余字段并显式降级（fetch.error 代号 + 前端黄条"显示上次同步数据"）；无 remote 配置不执行 fetch（no_remote）。
- impacts: daemon git_status 命令序、GitLogStatusResponse.fetch 字段、前端降级形态、R-01/R-03。
- evidence: 用户 AskUserQuestion 回答「自动 fetch」；git fetch 网络操作风险（凭证/超时）。
- priority: P0
- 锚点: sillyhub-daemon/src/host-fs-handler.ts
- 模块域: sillyhub-daemon, backend, frontend

## D-002@v1 : 数据链路走方案 A——git_log 模块扩展独立轻量 status 端点

- type: architecture
- status: confirmed
- source: brainstorm step 4 用户 AskUserQuestion 拍板
- question: 状态徽标数据链路挂在哪里？
- answer: 复用 git_log 模块与 host-fs 平名通道，daemon 加单方法 git_status、backend 加 GET /git-log/status、前端共享组件。
- normalized_requirement: 不新建模块、不并入 commits 响应；status 为独立轻查询独立缓存；会话页不拉提交列表。
- impacts: 文件清单（§6 全部行）、复用四私有方法与错误映射。
- evidence: status（每次进页面的轻查询）与 commits（按需分页重查询）缓存生命周期不同；会话页只需 status。
- priority: P0
- 锚点: backend/app/modules/git_log/router.py
- 模块域: backend, sillyhub-daemon, frontend
- 否决理由（被否方案）: B 并入 commits 响应——翻页/过滤重复算 status，会话页被迫拉列表；C 独立模块——同域只读查询拆两处，维护翻倍。
- 复潮条件（被否方案）: B 在 status 与列表恒同查询时域可复潮；C 在 git_log 模块超过 ~10 端点需要二次拆分时可复潮。

## D-003@v1 : 状态条双形态共享组件 + 两页共享 react-query 缓存

- type: frontend-architecture
- status: confirmed
- source: brainstorm step 5 设计确认（用户确认）
- question: 两页展示形态与 fetch 去重？
- answer: git-status-bar 单组件 variant=full|compact；useGitLogStatus staleTime 60s，两页同 queryKey 只触发一次远程 fetch。
- normalized_requirement: 不做自动轮询（无 refetchInterval）；compact 态 Tooltip 展开细节；组件自治取数不侵入会话列表逻辑。
- impacts: git-status-bar.tsx、lib/git-log.ts hooks、两页挂载点。
- evidence: 两页同时可见时重复 fetch 浪费远程配额；react-query staleTime 是仓库既有 freshness-first 模式（query-client.ts 15s 全局默认，本 hook 显式 60s）。
- priority: P1
- 锚点: frontend/src/components/git-log/git-status-bar.tsx
- 模块域: frontend
