"use client";

/**
 * 问题清单 Drawer 分发器 — 按 mode 渲染对应 6 态表单。
 *
 * mode 对照源 6 个 .vue:
 *  - create / edit   → ProblemCreateForm   (ListForm.vue)
 *  - start           → ProblemStartForm    (ListStartForm.vue,status=3)
 *  - audit           → ProblemAuditForm    (ListAuditForm.vue,status=2)
 *  - done            → ProblemDoneForm     (ListDoneForm.vue,status=3)
 *  - close           → ProblemCloseForm    (ListCloseForm.vue,status=6)
 *  - detail          → ProblemDetailForm   (ListDetailForm.vue,任意)
 */
import { useEffect, useState } from "react";
import { Drawer } from "antd";

import {
  PROBLEM_STATUS_TEXT,
} from "@/components/ppm-status-actions";
import { listProblemLogs } from "@/lib/ppm";
import type { ProblemList, ProblemProcessLog } from "@/lib/ppm";
import {
  ProblemAuditForm,
  ProblemCloseForm,
  ProblemCreateForm,
  ProblemDetailForm,
  ProblemDoneForm,
  ProblemStartForm,
} from "./_forms";

export type ProblemDrawerMode =
  | "create"
  | "edit"
  | "start"
  | "audit"
  | "done"
  | "close"
  | "detail";

export interface ProblemDrawerProps {
  open: boolean;
  mode: ProblemDrawerMode;
  problem?: ProblemList;
  onClose: () => void;
  onSaved: () => void;
}

const TITLE: Record<ProblemDrawerMode, string> = {
  create: "新建问题",
  edit: "编辑问题",
  start: "开始处置",
  audit: "审核",
  done: "完成处置",
  close: "验证并关闭",
  detail: "问题详情",
};

export function ProblemDrawer({
  open,
  mode,
  problem,
  onClose,
  onSaved,
}: ProblemDrawerProps) {
  // detail 模式额外加载流程履历
  const [logs, setLogs] = useState<ProblemProcessLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (!open || mode !== "detail" || !problem) return;
    let cancelled = false;
    setLoadingLogs(true);
    listProblemLogs(problem.id)
      .then((data) => {
        if (!cancelled) setLogs(data);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLogs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, problem]);

  return (
    <Drawer
      open={open}
      title={
        <span>
          {TITLE[mode]}
          {problem && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 12,
                color: "rgba(0,0,0,0.45)",
              }}
            >
              {PROBLEM_STATUS_TEXT[problem.status] ?? problem.status}
            </span>
          )}
        </span>
      }
      width={680}
      onClose={onClose}
      destroyOnClose
      maskClosable={false}
    >
      {mode === "create" && (
        <ProblemCreateForm
          onSuccess={onSaved}
          onCancel={onClose}
        />
      )}
      {mode === "edit" && problem && (
        <ProblemCreateForm
          problem={problem}
          onSuccess={onSaved}
          onCancel={onClose}
        />
      )}
      {mode === "start" && problem && (
        <ProblemStartForm
          problem={problem}
          onSuccess={onSaved}
          onCancel={onClose}
        />
      )}
      {mode === "audit" && problem && (
        <ProblemAuditForm
          problem={problem}
          onSuccess={onSaved}
          onCancel={onClose}
        />
      )}
      {mode === "done" && problem && (
        <ProblemDoneForm
          problem={problem}
          onSuccess={onSaved}
          onCancel={onClose}
        />
      )}
      {mode === "close" && problem && (
        <ProblemCloseForm
          problem={problem}
          onSuccess={onSaved}
          onCancel={onClose}
        />
      )}
      {mode === "detail" && problem && (
        <ProblemDetailForm
          problem={problem}
          logs={logs}
          loadingLogs={loadingLogs}
          onCancel={onClose}
        />
      )}
    </Drawer>
  );
}
