// DBの行の型。supabase/migrations/ のテーブル定義に合わせる。

export type Role = 'viewer' | 'steward';
export type Domain = 'customer' | 'sales' | 'product' | 'store' | 'hr';
export type Sensitivity = 'public' | 'internal' | 'confidential' | 'personal';
export type ColumnSensitivity = 'public' | 'internal' | 'confidential';
export type DatasetStatus = 'draft' | 'pending_review' | 'published' | 'retired';
export type UpdateFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular' | 'none';
export type DataType = 'integer' | 'decimal' | 'date' | 'boolean' | 'text';

export type Profile = {
  id: string;
  display_name: string;
  role: Role;
};

export type Dataset = {
  id: string;
  name: string;
  description: string | null;
  domain: Domain | null;
  sensitivity: Sensitivity[];
  owner_name: string | null;
  steward_id: string | null;
  usage_notes: string | null;
  row_count: number;
  column_count: number;
  file_format: 'csv';
  encoding: 'utf-8' | 'shift_jis';
  source_file_name: string | null;
  sample_count: number;
  source_system: string | null;
  update_frequency: UpdateFrequency | null;
  status: DatasetStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  first_published_at: string | null;
  retired_by: string | null;
  retired_at: string | null;
};

export type DatasetColumn = {
  id: string;
  dataset_id: string;
  position: number;
  name: string;
  data_type: DataType;
  null_count: number;
  null_rate: number;
  distinct_count: number;
  description: string | null;
  sensitivity: ColumnSensitivity | null;
  is_pii: boolean;
};

export type ColumnSample = {
  column_id: string;
  sample_values: (string | null)[];
};

export type ChangeLog = {
  id: number;
  dataset_id: string;
  column_id: string | null;
  column_name: string | null;
  field: string;
  old_value: unknown;
  new_value: unknown;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
  suggestion_id: string | null;
  suggested_value: unknown;
  ai_decision: 'accepted' | 'modified' | 'rejected' | null;
};

export type AiDecision = 'pending' | 'accepted' | 'modified' | 'rejected' | 'superseded';

/** AIが提案する項目。change_logs.field と同じ名前 */
export type AiField =
  | 'description'
  | 'domain'
  | 'tags'
  | 'sensitivity'
  | 'column.description'
  | 'column.sensitivity'
  | 'column.is_pii';

export type AiSuggestion = {
  id: string;
  run_id: string;
  dataset_id: string;
  column_id: string | null;
  column_name: string | null;
  field: AiField;
  suggested_value: unknown;
  reason: string | null;
  decision: AiDecision;
  final_value: unknown;
  decided_by: string | null;
  decided_at: string | null;
  decided_in_bulk: boolean;
  created_at: string;
};

export type AiSuggestionStat = {
  field: AiField;
  model: string;
  prompt_version: string;
  accepted: number;
  modified: number;
  rejected: number;
  decided_in_bulk: number;
};
