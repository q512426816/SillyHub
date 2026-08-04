"use client";

/**
 * change 2026-07-25-daemon-borrow-for-business task-13 / FR-06 / D-001@v1 / D-009@v1
 *
 * 业务人员「借用方案」查看区（FR-06）。
 *
 * 业务人员（business_member）借用工作空间共享 daemon 跑智能体产出的方案，由后端
 * （task-10 close_interactive_run/complete_lease 回调）落文件中心：
 *   owner_type="workspace"、owner_id=ws_id、uploaded_by=业务人员。
 *
 * 本组件复用平台通用 ``FileViewer``（``@/components/file-viewer``）按文件 id 列表
 * 渲染预览/下载，不重写 MIME 判定/图片网格/下载链。设计依据 D-001（方案落文件中心
 * 为主）+ D-009（预览安全契约）。
 *
 * 触发（FR-04）按 D-002 复用现有 agent 触发 UI（前端无感），本组件只负责"看产出"，
 * 不引入新的触发或"选 daemon"交互。
 *
 * 数据来源：fileIds 由容器层 ``BorrowedSolutionFilesPanel`` 调
 * ``GET /api/file/list?owner_type=workspace`` 拉取后透传（后端 list 端点已就绪，
 * 借用 daemon 产出落 File 表 owner_type=workspace、owner_id=ws_id）。
 */

import { FileViewer } from "@/components/file-viewer";

export interface BorrowedSolutionFilesProps {
  /** 借用方案文件 id 列表（owner_type=workspace、uploaded_by=业务人员）。 */
  fileIds?: string[];
  /** 空态文案，默认「暂无借用方案」。 */
  emptyText?: string;
  /** 可选标题，默认「借用方案」。 */
  title?: string;
}

export function BorrowedSolutionFiles({
  fileIds,
  emptyText = "暂无借用方案。借用守护进程跑智能体后，产出的方案会出现在这里。",
  title = "借用方案",
}: BorrowedSolutionFilesProps): JSX.Element {
  const ids = Array.isArray(fileIds) ? fileIds : [];
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
        <span className="text-[11px] text-muted-foreground">
          业务人员借用共享守护进程产出
        </span>
      </div>
      {ids.length === 0 ? (
        <p
          className="rounded border border-dashed bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground"
          data-testid="borrowed-solution-empty"
        >
          {emptyText}
        </p>
      ) : (
        <div data-testid="borrowed-solution-files">
          <FileViewer fileIds={ids} />
        </div>
      )}
    </section>
  );
}
