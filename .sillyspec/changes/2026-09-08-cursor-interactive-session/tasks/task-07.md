---
id: task-07
title: 'Add cursor to backend caps mirror, alignment-guard EXPECTED_PROVIDERS and InteractiveProviderLiteral'
title_zh: 'backend 镜像（provider_caps.py + test_provider_caps_alignment.py EXPECTED_PROVIDERS + schema.py InteractiveProviderLiteral）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - backend/app/modules/daemon/schema.py
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  backend 侧 cursor 镜像三处同步：PROVIDER_CAPS 加 cursor 八键、守护测试
  EXPECTED_PROVIDERS 加 cursor、InteractiveProviderLiteral 加成员，保三端
  对齐并消除显式 provider 建会话 422（FR-01/FR-04 / D-004@v1）。
implementation:
  - provider_caps.py：PROVIDER_CAPS 加 cursor 字典，八键与 daemon 单源逐键一致——resume=True、model_select=True，mcp/multimodal/thinking/subagent/permission_dialog/edit_patch 六键 False；条目上方注释照 pi 段格式锚定取值依据（改值先改 daemon 单源）
  - test_provider_caps_alignment.py L52：EXPECTED_PROVIDERS 由「claude,codex,pi」加 cursor（同 commit 必改——漏改则三端表加 cursor 后 test_provider_sets_identical 必失败，D-004@v1；pi 接入 commit 7c4dd4efd 同款先例）
  - schema.py L112：InteractiveProviderLiteral 加 cursor 成员（请求侧校验——SessionCreateRequest.provider L199 消费该 Literal，显式 provider=cursor 建会话不再 422；runtime_id 入口本就可绕过）
acceptance:
  - PROVIDER_CAPS cursor 八键与 daemon providers.ts 逐键一致；get_provider_caps(cursor) 返回表内条目副本，未知 provider 仍全 False 8 键
  - 守护测试四用例全绿（键集/provider 集/逐键相等/未知全 false），EXPECTED_PROVIDERS 含 cursor
  - 显式 provider=cursor 建会话请求通过 Literal 校验；claude/codex/pi 既有请求零回归
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py -q --no-cov
constraints:
  - 不改任何表结构/migration（provider 值 cursor 由存量字段承载）；Literal 只加成员不破坏既有请求（请求侧校验放宽）
  - 八键取值只随 task-05 daemon 单源同步（Wave 0 验证 B 不通过时 resume 翻 false 的复议同样三端同步），镜像不自创取值
  - 守护测试全绿以同批 task-08 frontend 镜像落地为前提——caps 同步动作是 4 处非 3 处（daemon 单源 + backend 镜像 + frontend 镜像 + EXPECTED_PROVIDERS，D-004@v1）
expects_from:
  task-05:
    - contract: ProviderCapsCursorValues
      needs: [resume, mcp, multimodal, thinking, subagent, permission_dialog, edit_patch, model_select]
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
