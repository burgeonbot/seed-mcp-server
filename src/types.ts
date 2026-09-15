export type FieldType = "string" | "date" | "number" | "text" | "boolean" | "enum" | "image";

export type RelationType = "OneToOne" | "OneToMany";

export interface FieldValue {
  type: FieldType;
  label?: string;
  allowNull?: boolean;
  enumValues?: string;
}

export interface RelationValue {
  type: RelationType;
  table: string;
  label?: string;
}

export interface TableMetadata {
  name: string;
  label?: string;
  description?: string;
  fields: Record<string, FieldValue>;
  relations?: Record<string, RelationValue>;
  businessRules?: Record<string, string>;
}

export interface FrameMetadata {
  name: string;
  table: string;
  label?: string;
  description?: string;
  fields: Record<string, FieldValue>;
  relations?: Record<string, RelationValue>;
  fieldFilters?: unknown;
  fieldOrder?: unknown;
  relationFilters?: unknown;
}

export interface ViewLayout {
  device: "web" | "mobile";
  group: string;
  list?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ViewMetadata {
  name: string;
  frame: string;
  label?: string;
  description?: string;
  layout: ViewLayout;
  viewRoles?: Role[];
  editRoles?: Role[];
}

export interface Organization {
  name: string;
  description?: string;
  state?: string;
  trialStartingDate?: string;
  orgLogo?: string;
  phone?: string;
  address?: string;
  website?: string;
  email?: string;
  contact?: string;
  other?: string;
  finantialCardNumber?: string;
  finantialCardExpirationDate?: string;
  finantialCardSecurityCode?: string;
  finantialCardHolderName?: string;
}

export interface Document {
  id?: string;
  fields: Record<string, unknown>;
  relations?: Record<string, unknown>;
}

export interface Permission {
  id?: string;
  name: string;
  resourceId: string;
  access: number;
}

export interface Role {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  _permissionsRef1?: Permission[];
}

export interface Page<T> {
  paginationContext: {
    totalCount: number;
    pageSize: number;
    pageNumber: number;
  };
  data: T[];
}

export interface TradingBotAgent {
  id?: string | number;
  name?: string;
  code?: string;
  status?: string;
  currentRunId?: string | number;
  latestRunId?: string | number;
  lastRunId?: string | number;
  [key: string]: unknown;
}

export interface TradingBotRun {
  id?: string | number;
  agentId?: string | number;
  status?: string;
  mode?: string;
  startedAt?: string;
  stoppedAt?: string;
  completedAt?: string;
  [key: string]: unknown;
}
