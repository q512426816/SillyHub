---
id: task-02
title: 'Wave 2 入队：auto_resume.py 守卫+模板 + recovery 接线 + 守卫矩阵测试'
title_zh: 'Wave 2 入队：auto_resume.py 守卫+模板 + recovery 接线 + 守卫矩阵测试'
author: 'qinyi'
created_at: 2026-09-10 09:30:00
priority: P0
depends_on: ['task-01']
blocks: ['task-03']
requirement_ids: ['FR-01','FR-03','FR-03a','FR-03b','FR-04','NFR-03']
decision_ids: ['D-001@v1','D-003@v1','D-007@v1','D-011@v1','D-012@v1','D-013@v1']
allowed_paths:
  - backend/app/modules/daemon/session/service/auto_resume.py
  - backend/app/modules/daemon/session/service/recovery.py
  - backend/app/modules/daemon/tests/test_session_recovery.py
target_files:
  - NEW:backend/app/modules/daemon/session/service/auto_resume.py
  - backend/app/modules/daemon/session/service/recovery.py
  - backend/app/modules/daemon/tests/test_session_recovery.py
goal: >
  新文件 auto_resume.py：RESUME_PROMPT_TEMPLATE 模板常量（design §2.1 逐字，导出供测试锁定）+ wrap_resume_prompt() + _maybe_enqueue_auto_resume()——全程 begin_nested() SAVEPOINT；G1 范围/G2 开关/G3 错误码/G4 最新轮(id tiebreak)/G5 最后一条 user_input 且长度不等于 5000 截断上限/G6 附件宽松前缀(复用 session_attachment attachment_marker_line)/G7 链上限 2(沿 metadata_.auto_resume_of 回溯)/G8 幂等(origin 全等)/G9 无被取消 pending dialog/满员(<SESSION_QUEUE_MAX_PENDING)；INSERT position=MIN(pending)-1 队首。recovery.py 在 converge 之后写 reconnecting 之前接线；DB 失败 rollback to savepoint 后主链照常 commit（NFR-03）。
implementation: >
  新文件 auto_resume.py：RESUME_PROMPT_TEMPLATE 模板常量（design §2.1 逐字，导出供测试锁定）+ wrap_resume_prompt() + _maybe_enqueue_auto_resume()——全程 begin_nested() SAVEPOINT；G1 范围/G2 开关/G3 错误码/G4 最新轮(id tiebreak)/G5 最后一条 user_input 且长度不等于 5000 截断上限/G6 附件宽松前缀(复用 session_attachment attachment_marker_line)/G7 链上限 2(沿 metadata_.auto_resume_of 回溯)/G8 幂等(origin 全等)/G9 无被取消 pending dialog/满员(<SESSION_QUEUE_MAX_PENDING)；INSERT position=MIN(pending)-1 队首。recovery.py 在 converge 之后写 reconnecting 之前接线；DB 失败 rollback to savepoint 后主链照常 commit（NFR-03）。
acceptance: >
  design §6 守卫矩阵归本任务的 12 行逐行有测试（G1-G9+满员+SAVEPOINT+position；含 SAVEPOINT 注入 INSERT 失败不炸 recover、recover 网络重入不重复入队、截断长度=5000 不触发、pending dialog 轮不触发；G10 归 task-03）；既有 test_session_recovery 用例零回归；ruff/mypy 0。
constraints: >
  见 design.md 对应决策与 NFR；禁止越 allowed_paths 改文件；先例引用以行号锚定；既有测试零回归（NFR-01）。
verify: '验收标准见 acceptance 字段'
base_commit: '76c15a7884ce9cbba09b429733e37b7382bb5377'
head_commit: 'ba57735d3ae4d568b08c8ae4f103d75bc8dfffb0'
---


## 验收标准

design §6 守卫矩阵归本任务的 12 行逐行有测试（G1-G9+满员+SAVEPOINT+position；含 SAVEPOINT 注入 INSERT 失败不炸 recover、recover 网络重入不重复入队、截断长度=5000 不触发、pending dialog 轮不触发；G10 归 task-03）；既有 test_session_recovery 用例零回归；ruff/mypy 0。
