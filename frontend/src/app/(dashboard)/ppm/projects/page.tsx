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
import { Drawer } from "antd";

import { Button } from "@/components/ui/button";
import type { StatusKind } from "@/components/ui/status-badge";
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
// D-003/D-004:类型用 antd Tag 分类色(blue/cyan/default灰);状态用 StatusBadge 语义(statusKind)。
// value = 源字典 dictValue(code 1/2/3),与 DB ppm_project_maintenance 存的 code 一致;
// 顺序对应源字典:type 1=研发 / 2=实施 / 3=运维;status 1=进行中 / 2=已完成 / 3=已暂停。
const PROJECT_TYPE_OPTIONS = [
  { label: "研发项目", value: "1", color: "blue" },
  { label: "实施项目", value: "2", color: "cyan" },
  { label: "运维项目", value: "3", color: "default" },
];
const PROJECT_STATUS_OPTIONS: { label: string; value: string; statusKind: StatusKind }[] = [
  { label: "进行中", value: "1", statusKind: "info" },
  { label: "已完成", value: "2", statusKind: "success" },
  { label: "已暂停", value: "3", statusKind: "warning" },
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
        striped
        exportFilename="project_maintenance.xlsx"
        fields={fields}
        searchFieldNames={[
          "project_name" as FieldName,
          "project_code" as FieldName,
          "company_name" as FieldName,
          "project_type" as FieldName,
          "project_status" as FieldName,
        ]}
        getRowLabel={(row) =>
          row.project_name ?? row.project_code ?? row.id
        }
        extraActions={(row) => (
          <Button
            size="sm"
            variant="ghost"
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
    <Drawer
      open
      onClose={onClose}
      title={`成员管理 · ${project.project_name ?? project.project_code}`}
      width={760}
      maskClosable={false}
      destroyOnClose
    >
      <PpmProjectMembersTable projectId={project.id} />
    </Drawer>
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
