---
author: qinyi
created_at: 2026-10-13 12:56:40
---

# 决策记录 — 2026-10-13-change-files-refresh-sync

## D-001@v1 : daemon 上行同步执行「串行两条 CLI」（platform sync --change + platform sync-docs --change）
- type: architecture
- status: confirmed（brainstorm step3 用户拍板）
- source: user（AskUserQuestion：命令语义错位澄清轮，选 A）
- question: 用户点名的 sync-docs 只写平台 DB documents 列、不写文件树接口读取的镜像目录——daemon 实际执行哪条命令才能让刷新有意义？
- answer: 串行两条：先 `sillyspec platform sync --change X`（spec 树增量 → apply_ops 落平台镜像目录 + 进度六表，文件树变新鲜）再 `sillyspec platform sync-docs --change X`（四件套全文 upsert 进 DB documents 列）。字面与目标双覆盖；无差异时两条均秒级短路。
- normalized_requirement: GET /changes/{id}/files 刷新触发 daemon 定向（仅此变更）上行同步，同步完成后返回文件树。
- impacts: daemon RPC handler 命令编排（两条串行 + 各自结果结构化）；四件套 DB 全文列与镜像目录双通道都保证新鲜。
- evidence: sillyspec CLI 源码 index.js:4420（sync-docs 分支 → syncDocuments 只推 documents）；sync.js:40（syncDocuments 仅手动命令触发）；backend platform_sync/router.py:233（spec-sync 端点 → apply_ops 落镜像）；change/service.py:616（list_files 只扫镜像目录）。
- priority: P0
- 模块域: backend, sillyhub-daemon

## D-002@v1 : 触发机制采用「GET 内同步 RPC」（send_rpc 阻塞等 daemon 跑完再返回）
- type: architecture
- status: confirmed（brainstorm step4 用户拍板）
- source: user（AskUserQuestion：触发机制选型轮，选 A）
- question: 刷新文件树时怎样触发 daemon 上行同步（同步阻塞 / 异步二次刷新 / 显式端点）？
- answer: GET files 端点内经 DaemonWsHub.send_rpc(daemon_id, 'sillyspec_sync_change', {change, workspace_id}, timeout=15) 同步等 daemon 串行跑完两条 CLI 后再 list_files 返回。刷新一次即最新数据；改动面 backend+daemon 两端，前端零改动。
- normalized_requirement: 同步 RPC 阻塞预算 15s；超时/离线等失败静默降级（见 D-003）。
- impacts: backend change/router.py list_change_files 前置同步步骤；daemon 新注册 RPC method。
- evidence: ws_hub.py:529 send_rpc（同步 RPC + DaemonRpcTimeout/DaemonRuntimeOffline 异常体系现成）；daemon.ts:6950 registerRpcHandler 注册范式。
- priority: P0
- 模块域: backend, sillyhub-daemon

## D-003@v1 : 降级铁律——四路失败一律静默返回现有镜像数据，GET 永不因同步失败报错
- type: reliability
- status: confirmed（brainstorm step5 设计确认轮定稿）
- source: user（AskUserQuestion：分段设计确认轮「确认，继续」）
- question: daemon 未绑定/离线/RPC 超时/远端错误时 GET files 行为？
- answer: MemberBindingNotFound（未绑定等效离线）、DaemonRuntimeOffline、DaemonRpcTimeout、DaemonRpcRemoteError（含老 daemon 未注册新 method 的 method not found）四路全部 log.info 后放行降级，直接返回现有镜像数据；同步失败绝不 500。RPC 超时后 daemon CLI 仍在后台跑完，下次刷新即见新数据。
- normalized_requirement: GET files 可用性优先于数据新鲜度。
- impacts: backend _sync_change_via_daemon 全路径 try/except 收口；前后端无版本耦合（老 daemon 自动降级）。
- evidence: send_rpc 异常体系（ws_hub.py:541-544）；墓碑收敛端点同款 504 映射对照（machines.py:399-407，本变更改静默降级不走 504——GET 读接口语义）。
- priority: P0
- 模块域: backend

## D-004@v1 : daemon 侧防抖——15s TTL + in-flight 去重（模块级内存 Map）
- type: architecture
- status: confirmed（brainstorm step5 设计确认轮定稿）
- source: user（AskUserQuestion：分段设计确认轮「确认，继续」）
- question: 前端频繁刷新（TanStack Query refetch / 窗口聚焦）如何避免打爆 CLI？
- answer: daemon handler 内模块级 Map<workspaceId:change, 时间戳>：15s 内已同步过返回 {skipped:'debounced'} 秒回；同 key 在跑返回 {skipped:'in_flight'}。单机内存态不落盘——daemon 重启清零属可接受（首次刷新重新同步一次）。
- normalized_requirement: 防抖 TTL=15s，覆盖自动 refetch 窗口；in-flight 并发去重。
- impacts: daemon sillyspec_sync_change handler 防抖段；backend 无感知（skipped 也是正常 result）。
- evidence: daemon.ts:1850 单-flight 去重键先例（pullSpecBundle）；SILLYSPEC_COMMAND_TIMEOUT_MS=120s 同文件常量区。
- priority: P1
- 模块域: sillyhub-daemon

## D-005@v1 : 改动面边界——同步前置在 router 层，service.list_files 零改动，前端零改动
- type: scope
- status: confirmed（brainstorm step5 设计确认轮定稿）
- source: user（AskUserQuestion：分段设计确认轮「确认，继续」）
- question: 同步触发逻辑放哪一层？影响范围边界？
- answer: 前置步骤放 change/router.py 的 list_change_files handler 内（新私有函数 _sync_change_via_daemon）；service.list_files 保持纯读语义不动（quickfix 会话端点等其它调用方不受影响）；files/content、files/raw 本期不挂同步（用户仅点名列表刷新）；前端零改动。
- normalized_requirement: 最小改动面；纯读服务方法语义不污染。
- impacts: 单文件改动（change/router.py）+ daemon 两文件（daemon.ts 注册 + sillyspec-manager 或内联执行器）；测试面收敛。
- evidence: change/router.py:360 list_change_files；service.py:606 list_files 多调用方（read_file 链路共用）。
- priority: P1
- 模块域: backend, sillyhub-daemon

## D-006@v1 : 落选方案 B（fire-and-forget + 前端二次刷新）— rejected
- type: architecture
- status: rejected
- question: 刷新触发机制选型（step4 方案轮）。
- answer: GET 立即返回现有数据 + sync_triggered 标记，daemon 异步跑 CLI，前端延时自动二次拉取。
- 否决理由: 接口零延迟但需改前端刷新逻辑（何时再拉、拉几次的启发式），改动面三端且体验不确定——用户可能要点两次刷新才看到新数据，与「刷新即最新」诉求相悖。
- 复潮条件: 若未来 15s 阻塞预算实测不可接受（大变更同步常态化超 15s），可重新评估异步标记 + 前端二次拉取形态。
- evidence: brainstorm step4 方案对比（A/B/C 三方案，用户选 A）。

## D-007@v1 : 落选方案 C（新增显式 POST 同步端点 + 前端按钮联动）— rejected
- type: architecture
- status: rejected
- question: 刷新触发机制选型（step4 方案轮）。
- answer: 新增 POST 同步端点，前端刷新按钮先 POST 等同步完成再 GET 文件树。
- 否决理由: GET 保持纯读语义最干净，但三端改动最大；页面自动刷新（非按钮触发）场景覆盖不到；用户诉求是「这个刷新没意义」——期望刷新动作本身带同步，而非新增独立动作。
- 复潮条件: 若同步副作用被证明污染 GET 缓存语义（CDN/网关层缓存 GET），可重新评估显式端点。
- evidence: brainstorm step4 方案对比（用户选 A）。
