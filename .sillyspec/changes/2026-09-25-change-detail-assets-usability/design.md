---
author: flow-machine-draft
created_at: 2026-09-25T08:10:16.781Z
---
# 设计记录（Design Record）— 2026-09-25-change-detail-assets-usability

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-detail-assets-usability 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
本变更四条修复全在「展示与跳转」层，不新增数据源，延续 D-001@v1（沉淀资产=服务端解析 spec 树镜像）与「git/锚点逻辑单一源在工具」两条既有决策：

1. 范围对账降级态（FR-05）：卡面按 `degraded_reason` 分支渲染——有降级原因时不渲染三态 chip，改显降级原因 + 口径说明；已归档变更补一句「文件面为当前工作区未提交窗口」并由变更详情页传入 archived 标志。根因是 CLI 降级为「实际侧 only 视图（不出三态列）」时行内无 verdict 字段，前端把 undefined 计成 0 仍照画三个 chip（本机跑 `sillyspec scope-audit --json` 实证）。
2. 沉淀资产卡三组入口：FR/决策行改跳知识库页 URL 参数（`?file=&anchor=`）并落到条目卡；测试绑定行给「看测试文件」入口，弹窗内复用 explorer 的 `FilePreview`（读仓库文件，spec 镜像里没有测试文件）；归档留档列出 change-patch.json 的 files 清单，点击看 change.patch 中该文件的切片（后端切片 + 复用 DiffView）。
3. 知识库页补 URL 参数消费（FR-01/02 的落位端）：新增 `?file=`/`?anchor=` 解析 + 前缀归一 + 条目级滚动；`entry-card-list` 的结构化条目卡补 `data-entry-anchor`（原只有手册形态有，FR/决策条目因此无法作为滚动落点）。
4. 路径校验复用 `change/scope_audit.py::normalize_scope_file_path`（拒 `..`/绝对路径/pathspec magic），不新写一份校验。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-detail-assets-usability 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
- 新增端点 `GET /changes/{change_id}/assets/patch-file?path=<变更目录相对路径>` → `ChangePatchFileRead{path, diff, note, truncated}`：读归档目录 `change.patch` 并按 unified diff 的 `diff --git` 块切出该文件；命中返回 diff 文本（超 200k 字符截断并置 truncated），未命中返回 `diff=null` + note，文件不存在/无 patch 亦以 note 说明（展示面 fail-open，不 500）；path 非法 → 422（复用 normalize_scope_file_path）。
- schema：`ChangePatchMeta` 新增 `file_list: list[str]`（change-patch.json 的 files 数组投影，上限 500 条）与 `files_truncated: bool`；既有 `files: int` 保持 CLI totals 的文件计数语义不动（命名冲突故清单字段取名 `file_list`——评审 P3 记录并已按此对齐）。
- 前端：知识库页新增查询参数 `file`（知识库相对文件名，容错 `knowledge/`、`.sillyspec/`、`.sillyspec/knowledge/` 前缀）与 `anchor`（条目 id）；无参数时行为与现状逐字一致。
- 行为变化（DOM 层）：范围对账卡降级分支不再渲染 `scope-audit-chip-*`；结构化条目卡新增 `data-entry-anchor` 属性；沉淀资产卡 FR/决策行 href 由「仅 file」变为「file+anchor」，测试绑定行与归档留档清单新增可点击入口。
- 无：无数据库迁移、无 CLI/daemon 契约变化、无既有端点签名变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-detail-assets-usability 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：知识库「列表」与「详情」是两条独立请求——URL 落位在列表就绪后按文件名选中，滚动落点在详情返回并挂载后执行，用有界重试（最多若干帧）容忍 DOM 未就绪，重试耗尽静默停在文件级（不报错）。范围对账降级原因来自同一次响应，无跨请求竞态。
2. 并发写：本变更四条全为只读展示链路（读 spec 镜像、读仓库文件、读 change.patch），无写路径、无共享可变状态；并发打开同一变更只产生重复只读请求。
3. 切换/生命周期：卡片取数 key 含 workspaceId/changeId，切换即换 key；弹窗关闭即卸载（radix Portal 惰性挂载），切换文件回默认态；URL 参数只在挂载/参数变化时消费一次，不写入 URL（不回写历史）。
4. 作用域：explorer 取数按当前工作区解析成员绑定机器 + 相对工作区根路径，跨工作区不串台；patch 切片只读该变更自己解析出的归档目录（spec_root + change.path），不跨变更；文件清单上限 500 条防超大 patch 撑爆响应。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-detail-assets-usability 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
风险一：`change.patch` 与 `change-patch.json` 由 CLI 产出，体量不可控——切片后设 200k 字符上限并置 truncated，清单设 500 条上限并在 UI 标注截断（不静默截断）。
风险二：知识库 URL 参数是新的外部入口，前缀归一规则写死会让旧链接失效——归一函数覆盖四种写法并用例钉住，未知形态回落文件级。
风险三：切片按 `diff --git` 块解析属 git 自有格式，CLI 侧有同款 `slicePatchForFile`（双端实现）——本层只做只读展示切片、不参与审计判据，且只解析块头不做语义推断，漂移面可控。

死路一：复用范围对账「点行看单文件 diff」弹窗（daemon RPC `sillyspec_file_diff`）看归档留档 —— 该 RPC 的冻结 patch 分支只认 `scope-audit.patch`，本类变更无此件，会退化成实时窗口 diff（正是本次要治的失真），放弃。
死路二：前端拉 change.patch 自行切片 —— D-001@v1 已判前端解析属双端漂移面（且 N+1），放弃。
死路三：降级时整卡隐藏或只留命令兜底 —— 会连「当前工作区未提交窗口」这一有效信息一起丢掉，放弃；改为显式降级说明 + 归档变更口径提示。
死路四：改 CLI 让冻结 patch 分支兼容 change.patch —— 跨仓改动、需 CLI 发版 + daemon 升级才生效，远超本次展示层修复范围，放弃（可作为后续工具侧改进项）。
