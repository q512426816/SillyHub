---
id: task-03
title: 'Pin worker dispatch to workspace binding machine with roots precheck'
title_zh: 'mcp_tools 选机唯一钉定 + 两段式 provider 预检 + A3 越界 400 接线（depends_on: task-01,02）'
author: 'WhaleFall'
created_at: 2026-08-28 15:48:26
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-003@v2]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
goal: >
  在 _dispatch_worker_core 中将分身派发选机从「owner 自有在线机器优先」改为
  「目标工作区代表绑定机器唯一钉定」（FR-01/D-001@v1），并把预检升级为两段式
  provider 解析（FR-02/D-002@v1），钉定后建行前接入 allowed_roots 预检、仅可判定
  越界才 400（FR-04/D-003@v2）——修复会话与 worktree 副本分裂在两台机器的跨机
  派发根因，为 daemon 终检前移一道可诊断的快速失败防线。
implementation:
  - 'ws 取行前移：`ws = await session.get(Workspace, effective_target)`（现 :1096，在 target_provider 计算处）挪到预检段（:1048-1079）之前，先算 `target_provider = (ws.default_agent if ws is not None else None) or "claude"`（保留 ws 为 None 的既有防御），供两段式预检使用。'
  - '预检两段式（A1/FR-02/D-002@v1）：第一段 `resolve_representative_binding(..., provider=target_provider)` 严格解析；无果再 `provider=None` 回退任意在线 binding，回退时打 placement.py:1515 同款 `placement_provider_fallback` warning 日志；两段均无果维持既有 422 中文引导（:1073-1079）不变。'
  - '删 own_rt 抢占分支（A2/FR-01/D-001@v1）：删除 `_get_online_runtime(owner_id, ...)` 优先分支（现 :1098-1118），恒以预检 binding 钉定——`pinned_runtime_id = _runtime_uuid(binding["id"])`、`pinned_skip_owner_check = True`、`lease_provider = binding.get("provider") or target_provider`；钉定复查（prepare_interactive_dispatch）竞态掉线仍走 NoOnlineDaemonError 收敛（既有 Grill C-01 语义零回归）。'
  - 'A3 预检（FR-04/D-003@v2）：钉定后、建 sub_session 行（:1125）之前——`roots = await fetch_daemon_allowed_roots(session, binding["daemon_instance_id"])` 取 instance ∪ 名下全部 runtimes 并集；路径 `check_path = effective_worktree_path or resolve_root_path_for_daemon(ws.root_path)`（容器前缀改写后宿主路径，与 worktree 创建同源）；`path_definitively_outside_roots(check_path, roots)` 为 True → 抛 HTTPException(400) 中文引导（说明该路径与钉定机器 allowed_roots 白名单配置冲突），不建 sub_session/run/lease（对齐治理门 :1026-1046 前置拦截既有模式）；不可判定（全 `~` 根/空并集）放行交 daemon 终检。两个 helper 由 task-02 在 placement.py 提供，本卡以局部 import 声明消费。'
acceptance:
  - 'FR-01：owner 自有机器在线但未绑定目标工作区、第三方机器绑定目标工作区且在线（QM小程序→crrcdt-hubin 场景复刻）→ lease 钉定绑定机器 runtime（pinned_runtime_id == binding 行 id、pinned_skip_owner_check=True），绝不静默回落 owner 机器。'
  - 'FR-02：绑定机器仅有 codex runtime 而 target_provider=claude 时两段式回退仍解析成功且打 fallback warning；严格命中无回退日志；两段均无果维持既有 422 文案。'
  - 'FR-04：绝对根可判定越界 → 400 中文引导且无 sub_session/run/lease 行落库；全 `~` 根或空并集 → 放行进 worktree/lease 段。'
  - '常态回归：owner 机器即代表绑定机器时钉定结果与旧行为一致；:684 跨区代表钉定用例语义不变（断言运行归 task-04）。'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_dispatch.py -q（预期 :736 test_own_runtime_preferred_over_representative 翻红属已知——断言旧行为，语义翻转重写归 task-04）
constraints:
  - 本卡只改 backend/app/modules/agent/mcp_tools.py 生产码；:736 语义翻转重写与 A3/A1 新增用例全部归 task-04，本卡不加测试（故测试路径不进 allowed_paths）。
  - 不改既有 422 文案与触发条件；不动 batch 派发（dispatch_to_daemon/_resolve_dispatch_runtime）、普通 create_session 非钉定分支、host_fs delegate 接口。
  - A3 两个 helper 由 task-02 提供、双源同序确定性由 task-01 提供，本卡不自实现（见 expects_from）。
  - 400 拒绝点必须在建 sub_session/run 行之前（零垃圾行，对齐治理门 :1026-1046 模式）；路径A（effective_worktree_path 透传）同样过预检，其跨机拒绝属「拒绝即信号」预期语义（design 兼容策略）。
related_tests: [backend/app/modules/agent/tests/test_worker_subsession_dispatch.py]
expects_from: ['task-01: 双源同序确定性（ORDER BY 心跳 DESC, daemon_id ASC）', 'task-02: fetch_daemon_allowed_roots + path_definitively_outside_roots']
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
