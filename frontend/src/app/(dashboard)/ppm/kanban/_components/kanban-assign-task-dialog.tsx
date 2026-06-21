"use client";

/**
 * KanbanAssignTaskDialog — 对齐源 `AssignTaskDialog.vue`。
 *
 * 显示当前任务标题 + 远程搜索人员(searchKanbanUsers)→ 选择 → store.assignTask。
 *
 * 注:源用 el-select remote-method;本仓用 AntD Select + showSearch + 服务端
 * searchKanbanUsers,语义一致。人员来源用 kanban 专用 search 端点(返回
 * KanbanUserColumn[],含 dept_name),而非 PpmUserSelect(后者走 project-member
 * 全量,看板 search 端点更贴合"当前可见人员")。
 */
import { useEffect, useRef, useState } from "react";
import { Modal, Select, Spin, message } from "antd";

import { ApiError } from "@/lib/api";
import { searchKanbanUsers } from "@/lib/ppm/kanban";
import { useKanbanStore } from "@/stores/kanban";
import type { KanbanTaskCard, KanbanUserColumn } from "@/lib/ppm/types";

export function KanbanAssignTaskDialog({
  open,
  task,
  onClose,
  onSuccess,
}: {
  open: boolean;
  task: KanbanTaskCard | null;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const assignTask = useKanbanStore((s) => s.assignTask);
  const [results, setResults] = useState<KanbanUserColumn[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开时重置 + 预加载当前人员列表(对齐源 watch visible + handleSearchUsers(''))
  useEffect(() => {
    if (open) {
      setAssigneeId(undefined);
      void runSearch("");
    } else {
      setResults([]);
      setAssigneeId(undefined);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, task?.id]);

  const runSearch = async (kw: string) => {
    setSearching(true);
    try {
      const list = await searchKanbanUsers(kw.trim());
      setResults(list ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const onSearch = (kw: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(kw), 300);
  };

  const handleSubmit = async () => {
    if (!task) return;
    if (!assigneeId) {
      void message.warning("请选择分配对象");
      return;
    }
    setSubmitting(true);
    try {
      await assignTask({ task_id: task.id, assignee_id: assigneeId });
      void message.success("任务分配成功");
      onSuccess?.();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        void message.error(err.message || "分配任务失败");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="分配任务"
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: !assigneeId }}
      destroyOnHidden
      width={440}
    >
      <div className="mb-3 rounded bg-muted/40 px-3 py-2">
        <div className="text-[11px] text-muted-foreground">任务标题</div>
        <div className="mt-1 text-sm font-medium text-foreground">
          {task?.title ?? "—"}
        </div>
      </div>

      <div className="mb-1 text-xs text-muted-foreground">分配给</div>
      <Select
        showSearch
        allowClear
        style={{ width: "100%" }}
        placeholder="请搜索人员"
        value={assigneeId}
        onChange={(v) => setAssigneeId((v as string | undefined) ?? undefined)}
        onSearch={onSearch}
        filterOption={false}
        notFoundContent={searching ? <Spin size="small" /> : "无数据"}
        options={results.map((u) => ({
          value: u.user_id,
          label: u.username
            ? `${u.username}${u.dept_name ? ` · ${u.dept_name}` : ""}`
            : u.user_id,
        }))}
      />
    </Modal>
  );
}

export default KanbanAssignTaskDialog;
