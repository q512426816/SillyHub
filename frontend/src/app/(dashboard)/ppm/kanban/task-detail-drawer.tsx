"use client";

/**
 * TaskDetailDrawer — 看板任务详情抽屉 (task-01 / FR-01 / D-011)。
 *
 * 点击看板卡片打开,四区块:
 *  - 详情:标题(可内联编辑,blur 触发 updateKanbanTask)+ 状态标签。
 *  - 附件:用 PpmFileUrls 只读渲染 task.file_urls。
 *  - 子任务:listKanbanSubtasks + toggleKanbanSubtask(勾选)。
 *  - 评论:listKanbanComments + addKanbanComment(底部输入框)。
 *
 * 不做文件上传(D-007/010)、不做 silly 工作流(D-002)、
 * 不做子任务新建/删除(FR-01 仅要求勾选)。
 */
import { useCallback, useEffect, useState } from "react";

import { Button, Checkbox, Drawer, Input, Tag } from "antd";
import { PpmFileUrls } from "@/components/ppm-file-urls";
import { ApiError } from "@/lib/api";
import {
  addKanbanComment,
  listKanbanComments,
  listKanbanSubtasks,
  toggleKanbanSubtask,
  updateKanbanTask,
} from "@/lib/ppm/kanban";
import type {
  KanbanComment,
  KanbanSubtask,
  KanbanTaskCard,
} from "@/lib/ppm/types";
import { fmtDay, useToast } from "../shared";

interface TaskDetailDrawerProps {
  /** 选中的任务卡片(null=关闭)。 */
  task: KanbanTaskCard | null;
  onClose: () => void;
  /** 任务更新后回调(供父级刷新本地 state)。 */
  onTaskUpdated?: (task: KanbanTaskCard) => void;
}

function statusTagOf(status: string | null): { text: string; color: string } {
  // PlanTask.status 实际枚举(中文):未开始 / 进行中 / 已完成
  // (对齐 backend PlanTask.model default + task/service.execute_plan 写入值)
  switch (status) {
    case "未开始":
      return { text: "未开始", color: "default" };
    case "进行中":
      return { text: "进行中", color: "processing" };
    case "已完成":
      return { text: "已完成", color: "success" };
    default:
      return { text: status ?? "未知", color: "default" };
  }
}

export function TaskDetailDrawer({
  task,
  onClose,
  onTaskUpdated,
}: TaskDetailDrawerProps) {
  const { showToast } = useToast();
  const [titleDraft, setTitleDraft] = useState("");
  const [titleDirty, setTitleDirty] = useState(false);

  const [comments, setComments] = useState<KanbanComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [subtasks, setSubtasks] = useState<KanbanSubtask[]>([]);
  const [fileUrls, setFileUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const taskId = task?.id ?? null;

  // 打开/切换任务时重置 + 拉取关联数据
  // showToast 依赖稳定的 setToast,空依赖数组即可(对齐同文件其他 handler 风格)。
  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [cs, ss] = await Promise.all([
        listKanbanComments(id),
        listKanbanSubtasks(id),
      ]);
      setComments(cs);
      setSubtasks(ss);
    } catch (err) {
      setComments([]);
      setSubtasks([]);
      showToast(
        false,
        err instanceof ApiError ? err.message : "评论/子任务加载失败",
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!task) return;
    setTitleDraft(task.title ?? "");
    setTitleDirty(false);
    setFileUrls(task.file_urls ?? []);
    void loadDetail(task.id);
  }, [task, loadDetail]);

  const persistTitle = async () => {
    if (!task || !titleDirty) return;
    const next = titleDraft.trim();
    if (!next) {
      showToast(false, "标题不能为空");
      setTitleDraft(task.title ?? "");
      setTitleDirty(false);
      return;
    }
    try {
      const updated = await updateKanbanTask({
        task_id: task.id,
        content: next,
      });
      setTitleDirty(false);
      onTaskUpdated?.(updated);
      showToast(true, "已保存标题");
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "保存失败");
    }
  };

  const onToggleSubtask = async (subtaskId: string) => {
    if (!taskId) return;
    // 乐观更新
    const prev = subtasks;
    setSubtasks((cur) =>
      cur.map((s) =>
        s.id === subtaskId ? { ...s, done: !s.done } : s,
      ),
    );
    try {
      const updated = await toggleKanbanSubtask(taskId, subtaskId);
      setSubtasks((cur) =>
        cur.map((s) => (s.id === subtaskId ? updated : s)),
      );
    } catch (err) {
      setSubtasks(prev);
      showToast(false, err instanceof ApiError ? err.message : "勾选失败");
    }
  };

  const onAddComment = async () => {
    if (!taskId) return;
    const content = commentDraft.trim();
    if (!content) {
      showToast(false, "评论内容不能为空");
      return;
    }
    try {
      const created = await addKanbanComment(taskId, { content });
      setComments((cur) => [...cur, created]);
      setCommentDraft("");
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "评论失败");
    }
  };

  const statusTag = statusTagOf(task?.status ?? null);

  return (
    <Drawer
      title="任务详情"
      placement="right"
      width={400}
      open={task !== null}
      onClose={onClose}
      destroyOnClose
    >
      {task ? (
        <div className="space-y-5">
          {/* 详情 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">状态</span>
              <Tag color={statusTag.color}>{statusTag.text}</Tag>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">标题</div>
              <Input.TextArea
                value={titleDraft}
                autoSize={{ minRows: 1, maxRows: 4 }}
                onChange={(e) => {
                  setTitleDraft(e.target.value);
                  setTitleDirty(true);
                }}
                onBlur={() => void persistTitle()}
                placeholder="任务内容"
              />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>负责人:{task.user_name ?? "—"}</span>
              <span>项目:{task.project_name ?? "—"}</span>
              <span>截止:{task.deadline ? fmtDay(task.deadline) : "—"}</span>
              <span>预估:{task.estimate_hours ?? "—"}h</span>
            </div>
          </section>

          {/* 附件 */}
          <section className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">附件</div>
            <PpmFileUrls value={fileUrls} onChange={setFileUrls} disabled />
          </section>

          {/* 子任务 */}
          <section className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">子任务</div>
            {loading && subtasks.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">加载中…</div>
            ) : subtasks.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">暂无子任务</div>
            ) : (
              <ul className="space-y-1">
                {subtasks.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox
                        checked={s.done}
                        onChange={() => void onToggleSubtask(s.id)}
                      />
                      <span className={s.done ? "text-muted-foreground line-through" : ""}>
                        {s.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 评论 */}
          <section className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">评论</div>
            {comments.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">暂无评论</div>
            ) : (
              <ul className="space-y-2">
                {comments.map((c) => (
                  <li
                    key={c.id}
                    className="rounded border border-border bg-muted/20 px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{c.user_name ?? c.user_id}</span>
                      <span>{fmtDay(c.created_at)}</span>
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap text-xs">
                      {c.content}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-1.5 pt-1">
              <Input.TextArea
                value={commentDraft}
                autoSize={{ minRows: 1, maxRows: 3 }}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="写评论…"
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void onAddComment();
                  }
                }}
              />
              <Button type="primary" size="small" onClick={() => void onAddComment()}>
                发送
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

export default TaskDetailDrawer;
