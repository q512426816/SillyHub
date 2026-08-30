---
id: task-02
title: 'Add allowed_roots precheck helpers to placement'
title_zh: 'placement.py allowed_roots 预检 helper（fetch_daemon_allowed_roots + path_definitively_outside_roots）'
author: 'WhaleFall'
created_at: 2026-08-28 15:48:26
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/tests/test_placement_member_binding.py
provides:
  - fetch_daemon_allowed_roots
  - path_definitively_outside_roots
goal: >
  为 backend allowed_roots 白名单预检（FR-04 / D-003@v2，仅可判定越界才拒）在
  placement.py 尾部新增两个模块级 helper：fetch_daemon_allowed_roots
  （DaemonInstance.allowed_roots ∪ 该 instance 名下全部 daemon_runtimes.allowed_roots
  并集）+ 纯函数 path_definitively_outside_roots（路径归一 + 边界敏感前缀包含判定），
  供 task-03 mcp_tools 预检接线消费。
implementation:
  - 'placement.py 尾部（RunPlacementService 类定义之后，模块级区域）新增 async 函数 fetch_daemon_allowed_roots(session, daemon_instance_id)（签名对齐 design §接口定义）：查 daemon_instances.allowed_roots（model.py:76，JSON list、NOT NULL）∪ 该 instance 名下全部 daemon_runtimes.allowed_roots（model.py:171，JSON、nullable=True——NULL 行容忍跳过），去重返回 list[str]；instance 行缺失 → 返回空并集（空并集放行，权威裁决归 daemon 终检）；对齐 daemon _effectiveAllowedRoots 的同机全量语义（本地 config≈instance 注册值 ∪ PolicyCache 全部 runtime 根）'
  - '同区新增纯函数 path_definitively_outside_roots(path, roots)：`~` 前缀根跳过判定（backend 无法展开）；归一 os.sep / os.path.normpath、Windows 形态大小写不敏感；边界敏感前缀包含（resolved == root or resolved.startswith(root + sep)）；仅当 roots 中存在至少一条绝对路径根（非 ~ 前缀）且 path 不在任何绝对根内才返回 True——全部根为 ~ 或无绝对根 → False（不可判定放行，交 daemon 终检权威裁决）'
  - '两函数 docstring 对齐 placement.py 尾部 helper 风格（中文、引用 change/FR/D 编号，参照 :1538-1543 注释范式）；SQL 走 text() + :did 占位符范式（对齐 queries.py 同款）'
  - 'test_placement_member_binding.py（既有 test_placement*.py，纳入本卡 allowed_paths）追加最小单测：纯函数用例（/ws/root 命中 /ws 放行、/ws-other/x 拒、全 ~ 放行、空 roots 放行、Windows 盘符/反斜杠/大小写形态）+ fetch_daemon_allowed_roots 并集用例（复用既有 _create_daemon_instance/_create_runtime 夹具，allowed_roots 直接行内赋值；覆盖多 runtime 全收、NULL 列行跳过、instance 缺失返回 []）；测试命名须含 allowed_roots 或 precheck 关键字以命中 verify 的 -k 过滤'
acceptance:
  - 'path_definitively_outside_roots("/ws/root", ["/ws"]) → False（边界敏感前缀包含，命中放行）；("/ws-other/x", ["/ws"]) → True（可判定越界拒，/ws-other 不误判在 /ws 内）'
  - 'roots 全为 `~` 前缀根 → False；空并集 → False（不可判定放行，daemon 终检权威裁决，D-003@v2）'
  - 'fetch_daemon_allowed_roots 返回 instance.allowed_roots ∪ 名下全部 runtimes.allowed_roots 并集（多 runtime 全收、runtime.allowed_roots 为 NULL 的行跳过不崩；instance 行缺失返回 []）'
  - 'Windows 形态（盘符/反斜杠/大小写不敏感）与 Linux 形态归一判定一致（NFR-01 跨平台）'
  - 'path_definitively_outside_roots 纯函数无 IO、无 session 依赖，独立可测；新增最小单测全部通过'
verify:
  - cd backend && uv run pytest app/modules/agent/tests -k "allowed_roots or precheck" -q
constraints:
  - '不改 mcp_tools 预检接线（归 task-03）——本卡只提供 helper，不在 dispatch 链路调用'
  - '不动既有 placement 行为：RunPlacementService 全部方法零改动，仅文件尾追加模块级函数'
  - '不新增表结构/迁移/对外 DTO——allowed_roots 均为既有 JSON 列（daemon_instances/daemon_runtimes），本变更是消费方式变更'
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
