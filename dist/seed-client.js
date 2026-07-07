export class SeedApiError extends Error {
    status;
    details;
    constructor(message, status, details) {
        super(message);
        this.status = status;
        this.details = details;
        this.name = "SeedApiError";
    }
}
export const createAccess = 1;
export const readAccess = 2;
export const updateAccess = 4;
export const deleteAccess = 8;
export const fullAccess = createAccess | readAccess | updateAccess | deleteAccess;
export class SeedClient {
    options;
    accessToken;
    maintAccessToken;
    constructor(options) {
        this.options = options;
        this.accessToken = options.accessToken;
        this.maintAccessToken = options.maintAccessToken;
    }
    async listTables(pageNumber = 0, pageSize = 100) {
        return this.post("/api/rel_data/tables", {
            paginationContext: { pageNumber, pageSize }
        });
    }
    async getTable(tableName) {
        return this.post("/api/rel_data/table", { tableName });
    }
    async createTable(table) {
        return this.postText("/api/rel_data/table/add", normalizeTable(table));
    }
    async updateTable(table) {
        return this.postText("/api/rel_data/table/update", normalizeTable(table));
    }
    async addRelationship(sourceTableName, relationName, relation) {
        const table = await this.getTable(sourceTableName);
        const updatedTable = {
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
    async listFrames(pageNumber = 0, pageSize = 100, filters) {
        return this.post("/api/rel_data/frames", {
            paginationContext: { pageNumber, pageSize },
            filters
        });
    }
    async getFrame(frameName) {
        return this.post("/api/rel_data/frame", { frameName });
    }
    async createFrame(frame) {
        return this.postText("/api/rel_data/frame/add", normalizeFrame(frame));
    }
    async updateFrame(frame) {
        return this.postText("/api/rel_data/frame/update", normalizeFrame(frame));
    }
    async deleteFrames(framesIds) {
        return this.postText("/api/rel_data/frames/delete", { framesIds });
    }
    async listViews(pageNumber = 0, pageSize = 100, filters) {
        return this.post("/api/rel_data/views", {
            paginationContext: { pageNumber, pageSize },
            filters
        });
    }
    async getView(viewName) {
        return this.post("/api/rel_data/view", { viewName });
    }
    async createView(view) {
        return this.postText("/api/rel_data/view/add", normalizeView(view));
    }
    async updateView(view) {
        return this.postText("/api/rel_data/view/update", normalizeView(view));
    }
    async deleteViews(viewsIds) {
        return this.postText("/api/rel_data/views/delete", { viewsIds });
    }
    async listDocuments(table, pageNumber = 0, pageSize = 100, filters, order = []) {
        return this.post("/api/rel_data/documents", {
            paginationContext: { pageNumber, pageSize },
            table,
            filters,
            order
        });
    }
    async addDocuments(table, documents) {
        return this.post("/api/rel_data/documents/add", {
            table,
            documents
        });
    }
    async updateDocuments(table, documents) {
        return this.postText("/api/rel_data/documents/update", {
            table,
            documents
        });
    }
    async deleteDocuments(table, documentIds) {
        return this.postText("/api/rel_data/documents/delete", {
            table,
            documentIds
        });
    }
    async grantPermission(resourceId, access = fullAccess, roleName = "admin", name) {
        const role = await this.findRoleByName(roleName);
        const existingPermission = await this.findPermission(resourceId, access);
        const permission = existingPermission ?? await this.createPermission({
            name: name ?? `${resourceId} Full CRUD`,
            resourceId,
            access
        });
        const currentPermissionIds = (role._permissionsRef1 ?? [])
            .map((permissionRef) => permissionRef.id)
            .filter((id) => typeof id === "string" || typeof id === "number")
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
    async listOrganizations(pageNumber = 0, pageSize = 100, filters) {
        const token = await this.ensureMaintToken();
        return this.request("/api/rel_data/organizations", {
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
    async registerOrganization(orgName) {
        return this.requestText("/api/rel_data/organization/register", {
            method: "POST",
            body: JSON.stringify({ orgName }),
            headers: { "Content-Type": "application/json" }
        });
    }
    async createOrganization(organization) {
        return this.postText("/api/rel_data/organization/add", normalizeOrganization(organization));
    }
    async updateOrganization(organization) {
        return this.postText("/api/rel_data/organization/update", normalizeOrganization(organization));
    }
    async deleteOrganization(name) {
        return this.postText("/api/rel_data/organization/delete", { name });
    }
    async findRoleByName(roleName) {
        const page = await this.listDocuments("roles", 0, 10, { name: roleName });
        const role = page.data.find((row) => row.name === roleName);
        if (!role?.id) {
            throw new SeedApiError(`Role ${roleName} not found.`);
        }
        return role;
    }
    async findPermission(resourceId, access) {
        const page = await this.listDocuments("permissions", 0, 100, { resourceId });
        return page.data.find((permission) => permission.resourceId === resourceId && permission.access === access);
    }
    async createPermission(permission) {
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
    async getAccessToken(credentials = {}) {
        const orgName = credentials.orgName ?? this.options.orgName;
        const email = credentials.email ?? this.options.email;
        const password = credentials.password ?? this.options.password;
        if (!orgName || !email || !password) {
            throw new SeedApiError("Seed credentials missing. Provide orgName, email, and password, or set SEED_ORG, SEED_EMAIL, and SEED_PASSWORD.");
        }
        if (this.accessToken &&
            !credentials.orgName &&
            !credentials.email &&
            !credentials.password) {
            return this.accessToken;
        }
        const response = await this.request("/api/rel_data/signin", {
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
    async getMaintAccessToken(password = this.options.maintPassword) {
        if (this.maintAccessToken && password === this.options.maintPassword) {
            return this.maintAccessToken;
        }
        if (!password) {
            throw new SeedApiError("Seed Maint credentials missing. Provide maintPassword, or set SEED_MAINT_ACCESS_TOKEN or SEED_MAINT_PASSWORD.");
        }
        const response = await this.request("/api/rel_data/signin", {
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
    async ensureToken() {
        return this.getAccessToken();
    }
    async ensureMaintToken() {
        return this.getMaintAccessToken();
    }
    async post(path, body) {
        const token = await this.ensureToken();
        return this.request(path, {
            method: "POST",
            body: JSON.stringify(body),
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });
    }
    async postText(path, body) {
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
    async request(path, init) {
        const text = await this.requestText(path, init);
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    async requestText(path, init) {
        const response = await fetch(new URL(path, this.options.apiBase), init);
        const text = await response.text();
        if (!response.ok) {
            throw new SeedApiError(extractSeedErrorMessage(text) ?? `Seed API request failed with status ${response.status}`, response.status, text);
        }
        return text;
    }
}
function normalizeTable(table) {
    return {
        ...table,
        label: table.label ?? table.name,
        description: table.description ?? "",
        fields: table.fields ?? {},
        relations: table.relations ?? {}
    };
}
function normalizeFrame(frame) {
    return {
        ...frame,
        label: frame.label ?? frame.name,
        description: frame.description ?? "",
        fields: frame.fields ?? {},
        relations: frame.relations ?? {}
    };
}
function normalizeView(view) {
    return {
        ...view,
        label: view.label ?? view.name,
        description: view.description ?? ""
    };
}
function normalizeOrganization(organization) {
    return {
        ...organization,
        state: organization.state ?? "Trial"
    };
}
function extractSeedErrorMessage(text) {
    try {
        const parsed = JSON.parse(text);
        const message = parsed?.errors?.[0]?.message;
        return typeof message === "string" ? message : undefined;
    }
    catch {
        return text || undefined;
    }
}
