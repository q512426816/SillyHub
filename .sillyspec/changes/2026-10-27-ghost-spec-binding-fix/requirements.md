---
author: flow-machine-draft
created_at: 2026-10-27T00:51:08.037Z
---
# 需求规格（Requirements）— 2026-10-27-ghost-spec-binding-fix

## 功能需求

### FR-01: bind_session_to_change 在 changes 表无该 change_key 行且名字不匹配 YYYY-MM-DD- 日期前缀格式时，跳过建 placeholder 与 link（log.warning 记录），返回 None

- 绑定入口查库未命中该 change_key 且名字不带日期前缀时，必须跳过建 placeholder 行与 link 行，禁止产生任何落库副作用，仅以 log.warning 记录拒绝事实并返回 None。（依据：CLI 对新变更名强制日期前缀——缺前缀的 `flow start` 必被 exit 2 拒绝，变更从未真实存在；此类命令建出的占位行永远无文件接管，即会话弹窗幽灵条目根因，2026-10-27 会话 9d190177 实证。）

#### 场景：无前缀新名被拒

- Given 工作区 changes 表中不存在 change_key=`task-wakeup-precision-fix`（无日期前缀）的行
- When 调用 `bind_session_to_change(db, ws_id, "task-wakeup-precision-fix", session_id)`
- Then 返回 None、changes 表行数不变、change_session_links 无新增行，且产生 log.warning（`change.spec_binding_rejected_invalid_name`）

### FR-02: 名字带日期前缀但行不存在时维持现状建 placeholder（真实 flow start 场景零回退）

- 名字带日期前缀且查库未命中时，必须维持现状建 placeholder 行（defaults 与 `_ensure_change_row` 对齐：status=draft / location=active / path=changes/<名> / title=名）并建 link、返回新行 id——真实 `flow start` 成功后命令解析先于镜像同步到达的窗口行为不变。

#### 场景：带前缀新名照常占位

- Given changes 表不存在 change_key=`2026-10-27-real-change` 的行
- When 调用 `bind_session_to_change(db, ws_id, "2026-10-27-real-change", session_id)`
- Then 返回新行 id；新行 status=draft、location=active、path=`changes/2026-10-27-real-change`、title=key；link 恰一条指向该会话

### FR-03: 库中已存在同 key 行（含历史旧格式名）时正常建 link，行为不变

- 查库命中已有 Change 行（无论名字是否带日期前缀——历史旧格式名变更合法存在）时，必须跳过格式校验直接走既有 link 幂等绑定路径，行为与现状完全一致，禁止因名字格式拒绑。

#### 场景：旧格式名已有行正常绑定

- Given changes 表已存在 change_key=`legacy-undated-name`（无日期前缀、真实历史变更）的行
- When 调用 `bind_session_to_change(db, ws_id, "legacy-undated-name", session_id)`
- Then 返回该行 id 且不建第二行；link 恰一条指向该会话（无 placeholder、无 warning 拒绝）

### FR-04: list_changes_for_session 过滤幽灵占位行：status=draft 且 location=active 且无 change_documents 且 created_at 距今超过 30 分钟的行不出现在返回结果

- 会话关联变更列表必须过滤同时满足四条件的幽灵占位行——status=draft、location=active、名下无任何 change_documents 行、created_at 距今超过 30 分钟——使其不出现在返回结果中。（依据：此类行即失败命令占位残留；真实变更 `flow start` 后数秒内经镜像同步获得四件套文档，长时间无文档的 draft 行必为幽灵。）

#### 场景：超龄无文档 draft 行被滤

- Given 会话链接了 change_key=`task-wakeup-precision-fix` 的行（status=draft、location=active、无文档、created_at=41 分钟前）
- When 调用 `list_changes_for_session(ws_id, session_id)`
- Then 返回列表不含该 change_key

### FR-05: 刚创建（30 分钟内）的 draft 无文档行不过滤（镜像同步延迟窗口不受影响）

- 满足幽灵四条件但 created_at 距今不超过 30 分钟的行，必须原样返回——真实变更 `flow start` 后命令解析先于镜像文档同步到达的延迟窗口内不消失，禁止提前过滤。

#### 场景：新鲜占位行保留

- Given 会话链接了 status=draft、location=active、无文档、created_at=5 分钟前的行
- When 调用 `list_changes_for_session(ws_id, session_id)`
- Then 返回列表包含该行

### FR-06: 有文档的 draft 行、归档行、status 非 draft 的行均不过滤（零误伤）

- 幽灵过滤必须以四条件**同时满足**为前提：有 change_documents 的 draft 行（正常在建变更）、location=archive 的行（已归档终态）、status 非 draft 的行（active/archived 等真实生命周期态）一律必须原样返回，禁止被过滤。

#### 场景：三条件缺一均保留

- Given 会话链接三行：draft+active+无文档+超龄之外的变体——① draft+active+有文档+超龄；② draft+archive+无文档+超龄；③ status=active+无文档+超龄
- When 调用 `list_changes_for_session(ws_id, session_id)`
- Then 返回列表同时包含①②③三行

### FR-07: backend 相关单元测试新增并通过（binding 校验 + 会话列表过滤两组）

- 两组相关测试（binding 拒绝/放行边界 + 会话列表过滤边界）必须全部新增落地且运行通过，只跑与本改动相关的测试文件，禁止全量测试。

#### 场景：相关测试绿

- When 在 backend 目录运行 `python -m pytest app/modules/change/tests/test_spec_binding.py app/modules/change/tests/test_session_changes_endpoint.py`
- Then 全部用例通过（含新增用例），无失败无错误

### FR-08: 弹窗未打开时列表低频轮询（30 秒）保底新鲜度——新变更创建/失效变更归档后无需刷新页面即可回显正确值（D-001@v1）

- `useSessionChanges` 在悬浮下拉与详情弹窗均未打开时，必须以 30 秒间隔持续轮询会话关联变更列表（此前为完全不轮询）——CLI 侧新建变更（flow start）或变更收口失效（flow done 归档）后，会话页入口徽标数与列表最迟 30 秒内自动回显正确值，禁止要求用户刷新页面。

#### 场景：关闭态数据自动保鲜

- Given 会话页已挂载变更入口、弹窗未打开（popoverOpen=false 且 dialogChangeId=null）
- When 后端列表数据发生变化（新增或归档一条变更）且时间推进 30 秒
- Then useQuery 以 30_000 毫秒间隔自动 refetch，界面回显最新列表（不再依赖页面刷新）

### FR-09: 打开下拉或详情弹窗时立即 refetch——打开瞬间所见即最新，禁止先用超过 staleTime 的缓存旧值（D-001@v1）

- 用户点击展开悬浮下拉或打开详情弹窗的时刻，必须立即触发一次列表 refetch（此后维持既有 15 秒轮询），禁止在 staleTime 窗口内直接渲染缓存旧值——打开瞬间即最新数据，不必等待下一个轮询周期。

#### 场景：打开瞬间拉新

- Given 列表缓存为 10 秒内旧值（staleTime 窗口内）
- When 用户点击展开下拉（popoverOpen false→true）
- Then 立即发起一次 refetch，随后打开态保持 15 秒轮询不变

### FR-10: 前端相关测试新增并通过（轮询策略 + 打开即拉新）

- 前端弹窗组件相关测试必须覆盖轮询策略分支（关闭 30s / 打开 15s）与打开瞬间 refetch 行为，且只跑与本改动相关的测试文件，禁止全量测试。

#### 场景：前端相关测试绿

- When 在 frontend 目录运行相关 vitest 用例（session-change-files-hover.test.tsx）
- Then 全部用例通过（含新增用例），无失败无错误

### FR-11: extract_spec_bindings 的 sillyspec 命令定位收紧为段首（或紧随 exec）——引号字符串内的示例命令文本不再产出绑定（D-002@v1）

- `extract_spec_bindings` 在命令段中定位 `sillyspec run` / `sillyspec flow <start|done|amend-draft>` token 序列时，必须要求 `sillyspec` token 位于段首或紧随 `exec`（包装前缀剥除后的合法形态）；出现在段中间（如 `--input` 引号长文本内引用的「sillyspec flow start --change xxx」示例字样所在段，段首是中文描述 token）的序列禁止产出绑定。（依据：2026-10-27 会话 5f088f10 实证——`iter_command_segments` 分段不感知引号，引号内文本被切成独立段，段中序列被误解析出幽灵绑定 `task-wakeup-precision-fix` 并建出第二条占位行。）

#### 场景：--input 引号内嵌示例命令不产生绑定

- Given 命令为多行 bash：`cd /repo && sillyspec flow start --change 2026-10-27-real --input "标题\n\n动机：agent 执行 sillyspec flow start --change task-wakeup-precision-fix（缺日期前缀）被拒绝\n\n成功标准：\n - 行为句"`
- When 调用 `extract_spec_bindings(命令)`
- Then 产出恰好一条绑定且 change_key=`2026-10-27-real`；不产出 `task-wakeup-precision-fix` 绑定

#### 场景：包装残留 exec 仍命中

- Given 命令段为 `pnpm exec sillyspec flow start --change 2026-10-27-x`
- When 调用 `extract_spec_bindings`
- Then 产出绑定 change_key=`2026-10-27-x`（exec 中缀容忍保留，零回退）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_spec_binding.py「test_bind_change_rejects_undated_new_key_no_placeholder」
FR-02: backend/app/modules/change/tests/test_spec_binding.py「test_bind_change_creates_placeholder_with_ensure_defaults」
FR-03: backend/app/modules/change/tests/test_spec_binding.py「test_bind_change_binds_existing_undated_row_without_placeholder」
FR-04: backend/app/modules/change/tests/test_session_changes_endpoint.py「test_ghost_placeholder_filtered_after_ttl」
FR-05: backend/app/modules/change/tests/test_session_changes_endpoint.py「test_fresh_placeholder_not_filtered」
FR-06: backend/app/modules/change/tests/test_session_changes_endpoint.py「test_documented_archived_non_draft_rows_not_filtered」
FR-07: backend/app/modules/change/tests/test_spec_binding.py + test_session_changes_endpoint.py「两组相关测试全绿」
FR-08: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「useSessionChanges 关闭态 30s 轮询」
FR-09: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「打开下拉立即 refetch」
FR-10: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「相关用例全绿」
FR-11: backend/app/modules/change/tests/test_spec_binding.py「test_extract_spec_bindings_quoted_text_not_binding」
