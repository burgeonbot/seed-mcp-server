import type { Document, Organization, Page, Permission, RelationValue, Role, TableMetadata } from "./types.js";

interface SeedClientOptions {
  apiBase: string;
  accessToken?: string;
  maintAccessToken?: string;
  maintPassword?: string;
  orgName?: string;
  email?: string;
  password?: string;
}

interface UserCredentials {
  orgName?: string;
  email?: string;
  password?: string;
}

export class SeedApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "SeedApiError";
  }
}

export const createAccess = 1;
export const readAccess = 2;
export const updateAccess = 4;
export const deleteAccess = 8;
export const fullAccess = createAccess | readAccess | updateAccess | deleteAccess;

export class SeedClient {
  private accessToken?: string;
  private maintAccessToken?: string;

  constructor(private readonly options: SeedClientOptions) {
    this.accessToken = options.accessToken;
    this.maintAccessToken = options.maintAccessToken;
  }

  async listTables(pageNumber = 0, pageSize = 100): Promise<Page<TableMetadata>> {
    return this.post<Page<TableMetadata>>("/api/rel_data/tables", {
      paginationContext: { pageNumber, pageSize }
    });
  }

  async getTable(tableName: string): Promise<TableMetadata> {
    return this.post<TableMetadata>("/api/rel_data/table", { tableName });
  }

  async createTable(table: TableMetadata): Promise<string> {
    return this.postText("/api/rel_data/table/add", normalizeTable(table));
  }

  async updateTable(table: TableMetadata): Promise<string> {
    return this.postText("/api/rel_data/table/update", normalizeTable(table));
  }

  async addRelationship(
    sourceTableName: string,
    relationName: string,
    relation: RelationValue
  ): Promise<TableMetadata> {
    const table = await this.getTable(sourceTableName);
    const updatedTable: TableMetadata = {
      ...table,
      fields: table.fields ?? {},
      relations: {
        ...(table.relations ?? {}),
        [relationName]: relation
      }
    };

    await this.updateTable(updatedTable);
    return updatedTable;
  }

  async listDocuments<T>(
    table: string,
    pageNumber = 0,
    pageSize = 100,
    filters?: unknown,
    order: unknown[] = []
  ): Promise<Page<T>> {
    return this.post<Page<T>>("/api/rel_data/documents", {
      paginationContext: { pageNumber, pageSize },
      table,
      filters,
      order
    });
  }

  async addDocuments(table: string, documents: Document[]): Promise<string | string[]> {
    return this.post<string | string[]>("/api/rel_data/documents/add", {
      table,
      documents
    });
  }

  async updateDocuments(table: string, documents: Document[]): Promise<string> {
    return this.postText("/api/rel_data/documents/update", {
      table,
      documents
    });
  }

  async deleteDocuments(table: string, documentIds: string[]): Promise<string> {
    return this.postText("/api/rel_data/documents/delete", {
      table,
      documentIds
    });
  }

  async grantPermission(resourceId: string, access = fullAccess, roleName = "admin", name?: string): Promise<{
    role: Role;
    permission: Permission;
    created: boolean;
    message: string;
  }> {
    const role = await this.findRoleByName(roleName);
    const existingPermission = await this.findPermission(resourceId, access);

    const permission = existingPermission ?? await this.createPermission({
      name: name ?? `${resourceId} Full CRUD`,
      resourceId,
      access
    });

    const currentPermissionIds = (role._permissionsRef1 ?? [])
      .map((permissionRef) => permissionRef.id)
      .filter((id): id is string => typeof id === "string" || typeof id === "number")
      .map(String);

    const permissionIds = Array.from(new Set([...currentPermissionIds, String(permission.id)]));

    if (!permission.id) {
      throw new SeedApiError(`Permission ${permission.name} was created but no id was returned.`);
    }

    await this.updateDocuments("roles", [
      {
        id: String(role.id),
        fields: {
          name: role.name,
          description: role.description,
          color: role.color
        },
        relations: {
          permissionsRef1: {
            type: "OneToMany",
            table: "permissions",
            id: permissionIds
          }
        }
      }
    ]);

    return {
      role,
      permission,
      created: !existingPermission,
      message: `${roleName} granted access ${access} on ${resourceId}.`
    };
  }

  async listOrganizations(pageNumber = 0, pageSize = 100, filters?: unknown): Promise<Page<Organization>> {
    const token = await this.ensureMaintToken();
    return this.request<Page<Organization>>("/api/rel_data/organizations", {
      method: "POST",
      body: JSON.stringify({
        paginationContext: { pageNumber, pageSize },
        filters
      }),
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  }

  async registerOrganization(orgName: string): Promise<string> {
    return this.requestText("/api/rel_data/organization/register", {
      method: "POST",
      body: JSON.stringify({ orgName }),
      headers: { "Content-Type": "application/json" }
    });
  }

  async createOrganization(organization: Organization): Promise<string> {
    return this.postText("/api/rel_data/organization/add", normalizeOrganization(organization));
  }

  async updateOrganization(organization: Organization): Promise<string> {
    return this.postText("/api/rel_data/organization/update", normalizeOrganization(organization));
  }

  async deleteOrganization(name: string): Promise<string> {
    return this.postText("/api/rel_data/organization/delete", { name });
  }

  private async findRoleByName(roleName: string): Promise<Role> {
    const page = await this.listDocuments<Role>("roles", 0, 10, { name: roleName });
    const role = page.data.find((row) => row.name === roleName);
    if (!role?.id) {
      throw new SeedApiError(`Role ${roleName} not found.`);
    }
    return role;
  }

  private async findPermission(resourceId: string, access: number): Promise<Permission | undefined> {
    const page = await this.listDocuments<Permission>("permissions", 0, 100, { resourceId });
    return page.data.find((permission) => permission.resourceId === resourceId && permission.access === access);
  }

  private async createPermission(permission: Omit<Permission, "id">): Promise<Permission> {
    const id = await this.addDocuments("permissions", [
      {
        fields: permission,
        relations: {}
      }
    ]);

    return {
      ...permission,
      id: Array.isArray(id) ? id[0] : id
    };
  }

  async getAccessToken(credentials: UserCredentials = {}): Promise<string> {
    const orgName = credentials.orgName ?? this.options.orgName;
    const email = credentials.email ?? this.options.email;
    const password = credentials.password ?? this.options.password;

    if (!orgName || !email || !password) {
      throw new SeedApiError(
        "Seed credentials missing. Provide orgName, email, and password, or set SEED_ORG, SEED_EMAIL, and SEED_PASSWORD."
      );
    }

    if (
      this.accessToken &&
      !credentials.orgName &&
      !credentials.email &&
      !credentials.password
    ) {
      return this.accessToken;
    }

    const response = await this.request<{ accessToken?: string }>("/api/rel_data/signin", {
      method: "POST",
      body: JSON.stringify({ orgName, email, password }),
      headers: { "Content-Type": "application/json" }
    });

    if (!response.accessToken) {
      throw new SeedApiError("Seed signin response did not include an access token.");
    }

    if (!credentials.orgName && !credentials.email && !credentials.password) {
      this.accessToken = response.accessToken;
    }

    return response.accessToken;
  }

  async getMaintAccessToken(password = this.options.maintPassword): Promise<string> {
    if (this.maintAccessToken && password === this.options.maintPassword) {
      return this.maintAccessToken;
    }

    if (!password) {
      throw new SeedApiError(
        "Seed Maint credentials missing. Provide maintPassword, or set SEED_MAINT_ACCESS_TOKEN or SEED_MAINT_PASSWORD."
      );
    }

    const response = await this.request<{ accessToken?: string }>("/api/rel_data/signin", {
      method: "POST",
      body: JSON.stringify({ email: "Maint", password }),
      headers: { "Content-Type": "application/json" }
    });

    if (!response.accessToken) {
      throw new SeedApiError("Seed Maint signin response did not include an access token.");
    }

    if (password === this.options.maintPassword) {
      this.maintAccessToken = response.accessToken;
    }

    return response.accessToken;
  }

  private async ensureToken(): Promise<string> {
    return this.getAccessToken();
  }

  private async ensureMaintToken(): Promise<string> {
    return this.getMaintAccessToken();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const token = await this.ensureToken();
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  }

  private async postText(path: string, body: unknown): Promise<string> {
    const token = await this.ensureToken();
    return this.requestText(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const text = await this.requestText(path, init);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private async requestText(path: string, init: RequestInit): Promise<string> {
    const response = await fetch(new URL(path, this.options.apiBase), init);
    const text = await response.text();

    if (!response.ok) {
      throw new SeedApiError(
        extractSeedErrorMessage(text) ?? `Seed API request failed with status ${response.status}`,
        response.status,
        text
      );
    }

    return text;
  }
}

function normalizeTable(table: TableMetadata): TableMetadata {
  return {
    ...table,
    label: table.label ?? table.name,
    description: table.description ?? "",
    fields: table.fields ?? {},
    relations: table.relations ?? {}
  };
}

function normalizeOrganization(organization: Organization): Organization {
  return {
    ...organization,
    state: organization.state ?? "Trial"
  };
}

function extractSeedErrorMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.errors?.[0]?.message;
    return typeof message === "string" ? message : undefined;
  } catch {
    return text || undefined;
  }
}
