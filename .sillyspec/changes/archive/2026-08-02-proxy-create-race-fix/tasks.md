---
author: qinyi
created_at: 2026-08-02 00:18:30
change: 2026-08-01-proxy-create-race-fix
---

# 任务清单（Tasks）— proxy-create 并发竞态 500 修复

> plan 阶段拆 Wave + 依赖关系细化。以下为 brainstorm 阶段任务骨架。

## Wave 1 — proxy 占坑（核心）

- [ ] **task-01**: 重构 `proxy_create_change` 时序——下发 daemon_change_write 前先占坑 INSERT Change + 全部 ChangeDocument（step3，doc_type 取自 `_build_files`），回执 done 后不再 INSERT docs（step6），回执 failed/超时 DELETE 占坑 Change 行（FK CASCADE 删 docs）回滚（step7）
- [ ] **task-02**: `_build_change_key` 改 unicode 感知正则 + `.lower()`（`re.sub(r"[^\w]+","-",title.lower(),flags=re.UNICODE)`，中文标题保留原字，纯标点兜底 untitled）

## Wave 2 — reparse 状态保护 + 撞键防御

- [ ] **task-03**: `_apply_parsed`（change/service.py:1248）加 `row.owner_id is None` 守卫——保护 proxy/worktree-lease 创建行 current_stage 不被文件推断覆盖
- [ ] **task-04**: `_reparse` created 分支（change/service.py:1064-1067 `_session.add(row)`）外包 try/except IntegrityError → 回滚 add → 重查 existing_by_key → 转 `_apply_parsed`(update)

## Wave 3 — 测试

- [ ] **task-05**: `change_writer/tests/test_proxy.py` 占坑成功 / 双表不撞键（模拟 reparse 并发）/ proxy 返回 docs 存在 / 写 failed+超时回滚 / 中文 change_key + .lower() case + 现有在线/离线/超时回归
- [ ] **task-06**: `change/tests/` `_apply_parsed` owner_id 非空不覆盖 + owner_id=None 覆盖；`_reparse` created 撞键 IntegrityError → 转 update case

## Wave 4 — 验收

- [ ] **task-07**: 真实 daemon-client 工作区 e2e——创建中文标题变更返回 201 不 500 + 详情页 docs 显示 + 失败回滚无孤儿
