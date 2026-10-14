/**
 * 发布记录数据层（2026-10-14-deploy-release-notes task-04 / FR-03）。
 *
 * 平台级聚合视图：GET /api/deploy-records 列表 + /api/deploy-records/{record_id}
 * 详情。record_id 形如 "<workspace_id>/<file_stem>" 含斜杠——详情请求整段
 * encodeURIComponent（后端路由 {record_id:path} 形态对应接收）。
 * 类型一律从 api-types.ts 导入（gen:types 生成，禁手写同名接口）。
 */
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import {
  deployRecordDetailQueryKey,
  deployRecordsListQueryKey,
} from "@/lib/query-keys";
import type { components } from "@/lib/api-types";

export type DeployRecordSummary = components["schemas"]["DeployRecordSummary"];
export type DeployRecordDetail = components["schemas"]["DeployRecordDetail"];

/** 记录列表（deployed_at 倒序由后端排好，前端原样消费）。 */
export async function listDeployRecords(): Promise<DeployRecordSummary[]> {
  return apiFetch<DeployRecordSummary[]>("/api/deploy-records");
}

/** 单条记录详情（record_id 含斜杠，整段编码防被当路径层级拆开）。 */
export async function getDeployRecord(recordId: string): Promise<DeployRecordDetail> {
  return apiFetch<DeployRecordDetail>(
    `/api/deploy-records/${encodeURIComponent(recordId)}`,
  );
}

export function useDeployRecordsList() {
  return useQuery({
    queryKey: deployRecordsListQueryKey(),
    queryFn: listDeployRecords,
  });
}

export function useDeployRecordDetail(recordId: string | null) {
  return useQuery({
    queryKey: deployRecordDetailQueryKey(recordId),
    queryFn: () => getDeployRecord(recordId as string),
    enabled: recordId !== null,
  });
}
