"use client";

/**
 * 项目维护页面 /ppm/projects
 *
 * 走 lib/ppm/project.ts 的 listProjects/createProject/updateProject/
 * deleteProject/exportProjects。CRUD + 搜索 + 导出 由 PpmResourceTable 通用组件承担。
 *
 * W1 task-03:项目行新增「成员管理」入口 → 打开抽屉,内嵌按 pm_project_id 过滤的
 * PpmProjectMembersTable(对照源 ProjectMemberListForm)。
 *
 * 依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/tasks/task-03.md
 * 参照源:vue views/ppm/projectmaintenance/index.vue
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PpmProjectMembersTable } from "@/components/ppm-project-members-table";
import { PpmResourceTable, type PpmFieldDef } from "@/components/ppm-resource-table";
import {
  createProject,
  deleteProject,
  exportProjects,
  pageProjects,
  updateProject,
} from "@/lib/ppm/project";
import type {
  ProjectMaintenance,
  ProjectMaintenanceCreate,
  ProjectMaintenancePageReq,
  ProjectMaintenanceUpdate,
} from "@/lib/ppm/types";

// 项目类型 / 状态枚举(参照源 vue 字典 pm_project_type / pm_project_status)
const PROJECT_TYPE_OPTIONS = [
  { label: "研发项目", value: "research", color: "blue" },
  { label: "实施项目", value: "implementation", color: "cyan" },
  { label: "运维项目", value: "maintenance", color: "geekblue" },
];
const PROJECT_STATUS_OPTIONS = [
  { label: "进行中", value: "ongoing", color: "processing" },
  { label: "已完成", value: "completed", color: "success" },
  { label: "已暂停", value: "paused", color: "warning" },
];

type Entity = ProjectMaintenance;
type FieldName = keyof Entity & string;

const fields: PpmFieldDef<Entity>[] = [
  { name: "project_code" as FieldName, label: "项目编号", required: true, readOnlyOnEdit: true, placeholder: "项目唯一编号" },
  { name: "project_name" as FieldName, label: "项目名称", required: true },
  { name: "company_name" as FieldName, label: "公司名称" },
  { name: "create_name" as FieldName, label: "创建人", hideInForm: true },
  {
    name: "project_type" as FieldName,
    label: "项目类型",
    type: "select",
    options: PROJECT_TYPE_OPTIONS,
  },
  {
    name: "project_status" as FieldName,
    label: "项目状态",
    type: "select",
    options: PROJECT_STATUS_OPTIONS,
  },
  {
    name: "project_effective_start_time" as FieldName,
    label: "项目有效期",
    type: "date",
    // P2-5:对照源 projectmaintenance/index.vue effectTimeFormate,
    // 把 start + end 合并为一格展示:start - end。
    hideInForm: false,
    render: (_v: unknown, row: Entity) => {
      const start = (row.project_effective_start_time ?? "").slice(0, 10);
      const end = (row.project_effective_end_time ?? "").slice(0, 10);
      if (!start && !end) {
        return <span className="text-xs text-muted-foreground">—</span>;
      }
      return `${start || "—"} - ${end || "—"}`;
    },
  },
  // 表单需要单独编辑生效起止,用 hideInTable 隐藏的两列承载表单字段。
  {
    name: "project_effective_end_time" as FieldName,
    label: "生效结束时间",
    type: "date",
    hideInTable: true,
  },
  { name: "project_maintenance_end_time" as FieldName, label: "维保结束时间", type: "date" },
];

export default function PpmProjectsPage() {
  const [memberProject, setMemberProject] = useState<ProjectMaintenance | null>(null);

  return (
    <>
      <PpmResourceTable<
        Entity,
        ProjectMaintenanceCreate,
        ProjectMaintenanceUpdate,
        ProjectMaintenancePageReq
      >
        title="项目维护"
        subtitle="项目主数据,被项目成员 / 干系人 / 计划 / 看板引用"
        entityLabel="项目"
        exportFilename="project_maintenance.xlsx"
        fields={fields}
        searchFieldNames={[
          "project_name" as FieldName,
          "project_code" as FieldName,
          "company_name" as FieldName,
        ]}
        getRowLabel={(row) =>
          row.project_name ?? row.project_code ?? row.id
        }
        extraActions={(row) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMemberProject(row)}
          >
            成员管理
          </Button>
        )}
        list={(params) => pageProjects(params)}
        create={(body) => createProject(body)}
        update={(id, body) => updateProject(id, body)}
        remove={(id) => deleteProject(id)}
        exportFn={(params) => exportProjects(params)}
        buildCreateBody={(form) => stripForm(form) as unknown as ProjectMaintenanceCreate}
        buildUpdateBody={(form) => stripForm(form) as unknown as ProjectMaintenanceUpdate}
        buildQuery={(form) => stripQuery(form) as unknown as ProjectMaintenancePageReq}
      />

      {memberProject && (
        <ProjectMembersDrawer
          project={memberProject}
          onClose={() => setMemberProject(null)}
        />
      )}
    </>
  );
}

/**
 * 项目→成员管理 抽屉(对照源 ProjectMemberListForm)。
 * 内嵌 PpmProjectMembersTable,按 pm_project_id 过滤,新增自动绑定当前项目。
 */
function ProjectMembersDrawer({
  project,
  onClose,
}: {
  project: ProjectMaintenance;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[760px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            成员管理 · {project.project_name ?? project.project_code}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <PpmProjectMembersTable projectId={project.id} />
        </div>
      </div>
    </>
  );
}

/** 把表单状态里的空串/未填字段去掉,避免覆盖后端默认值。 */
function stripForm(form: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === "" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function stripQuery(
  form: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v) out[k] = v;
  }
  return out;
}
