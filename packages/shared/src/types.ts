export interface HealthStatus {
  status: "ok";
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  archived: number;
  project_number: string | null;
  address: string | null;
  customer: string | null;
  status: string;
  project_lead: string | null;
  baubeginn: string | null;
  fertigstellung: string | null;
}

export interface PointStats {
  projectId: string;
  total: number;
  byStatus: Record<string, number>;
  overdue: number;
}

export interface Plan {
  id: string;
  project_id: string;
  name: string;
  file_path: string | null;
  file_hash: string | null;
  page_count: number | null;
  bauabschnitt: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  folder_id: string | null;
}

export interface PlanFolder {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface Point {
  id: string;
  plan_id: string;
  page_number: number;
  x: number;
  y: number;
  point_type: string;
  category_id: string | null;
  custom_fields: string | null;
  status: string;
  title: string;
  description: string | null;
  bauabschnitt: string | null;
  priority: string | null;
  assigned_to: string | null;
  due_date: string | null;
  gewerk: string | null;
  raum_bereich: string | null;
  ticket_number: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  version: number;
  deleted: number;
}

export interface Category {
  id: string;
  project_id: string | null;
  name: string;
  color: string;
  glyph: string;
  short_code: string | null;
  field_schema_json: string;
  created_by: string | null;
  created_at: string;
  archived: number;
}

export interface PointHistoryEntry {
  id: string;
  point_id: string;
  changed_by: string | null;
  changed_at: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
}

export interface PointComment {
  id: string;
  point_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  point_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
}
