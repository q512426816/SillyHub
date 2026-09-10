---
id: task-09
title: 'importer——workspace 扫描 + 去重 + cmd 归一化'
title_zh: 'importer——workspace 扫描 + 去重 + cmd 归一化'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004]
expects_from:
  task-01:
    - contract: McpServerCreate
      needs: [name, server_config, source, dedup_key]
    - contract: McpWorkspaceCandidate
      needs: [name, server_config, workspace_id, dedup_verdict]
  task-02:
    - contract: McpRegistryService
      needs: [create_server]
provides:
  - contract: McpWorkspaceScanCandidate
    fields: [name, workspace_id, verdict, renamed_name]
allowed_paths:
  - NEW:backend/app/modules/mcp_registry/importer.py
  - backend/app/modules/mcp_registry/tests/
target_files:
  - NEW:backend/app/modules/mcp_registry/importer.py
  - NEW:backend/app/modules/mcp_registry/tests/test_importer_workspace.py
goal: >
  扩展 importer.py 实现 workspace .mcp.json 扫描导入——scan 只读出候选含去重判定、apply 才落库的两阶段；同名同配置 skip、异配置改名加 workspace 短名后缀；dedup_key 用 ws 前缀 workspace 维度锚点；cmd /c 剥离归一化用于配置比对。
implementation:
  - scan_workspaces(session, workspace_id, user)——遍历或指定 workspace，复用 daemon_rpc._read_mcp_config_raw（:460-513）逐个读 specDir 下 .mcp.json 明文，容错空集语义与之一致；文件 IO 走 asyncio.to_thread 且逐 workspace 串行（R-04）
  - 候选附去重判定——按 dedup_key 查既有行三态——new（无行）、skip_candidate（有行且配置相等）、rename_candidate（有行且配置相异，新名为原名加连字符加 workspace 短名，短名取 workspace 名 slug 或 id 前 6 位）
  - 配置相等判定——cmd 归一化后 command 与 args 逐项相等且 env 键集合一致；cmd 归一化即 command 为 cmd 且 args 首元素为 /c 时剥离该前缀；secret 值不参与比对（registry 侧为密文不可逆）
  - dedup_key 形态为 ws:<workspace_id>:<name>（design 数据模型节去重锚）；非法 name 先归一化而 dedup_key 保留原名可追溯（R-07）
  - apply_workspace_import(session, candidates, scope, user)——选中候选经 service.create_server 落库，source 固定 imported_workspace；重复 apply 因 dedup_key 命中 skip 不重复入库（幂等）
  - 新增 test_importer_workspace.py 覆盖三态判定、cmd /c 剥离等价、dedup_key 幂等、scan 无落库副作用
acceptance:
  - scan 阶段零写库（无新行无审计行），apply 阶段才写 mcp_servers
  - 同名同配置 skip、同名异配置改名（原名加 workspace 短名）两分支单测可证；cmd /c 包装的等价配置判为相同走 skip
  - 导入行 dedup_key 与来源 workspace 和原名一一对应，重复 apply 不产生重复行
verify:
  - cd backend && uv run pytest app/modules/mcp_registry/tests/test_importer_workspace.py -q
  - cd backend && uv run ruff check app/modules/mcp_registry
  - cd backend && uv run mypy app/modules/mcp_registry
constraints:
  - 在 task-08 落地的 importer.py 上扩展，不改变其 JSON 路径行为；不改 daemon_rpc.py（读取经 import 复用，daemon 侧改动归 task-05）
  - 不写不删 workspace 的 .mcp.json 本身（registry 吸收不替代，design 非目标）
  - 仅跑本卡相关测试（CLAUDE.md 规则 0 禁全量）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
