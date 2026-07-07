#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fullAccess, SeedApiError, SeedClient } from "./seed-client.js";
import type { Document, FieldType, Organization, RelationType, TableMetadata } from "./types.js";

const fieldTypeSchema = z.enum(["string", "date", "number", "text", "boolean", "enum", "image"]);
const relationTypeSchema = z.enum(["OneToOne", "OneToMany"]);
const accessTokenTypeSchema = z.enum(["user", "maint"]);
const accessSchema = z.number().int().min(1).max(15);

const fieldSchema = z.object({
  name: z.string().min(1).describe("Machine name for the field."),
  type: fieldTypeSchema.describe("Seed field type."),
  label: z.string().optional().describe("Human-readable field label. Defaults to the field name."),
  allowNull: z.boolean().optional().describe("Whether the field may be empty."),
  enumValues: z.string().optional().describe("JSON string for enum options, used only for enum fields.")
});

const relationSchema = z.object({
  name: z.string().min(1).describe("Machine name for the relationship on the source table."),
  type: relationTypeSchema.describe("Seed relationship type."),
  table: z.string().min(1).describe("Target table name."),
  label: z.string().optional().describe("Human-readable relationship label. Defaults to the relationship name.")
});

const tableSchema = z.object({
  name: z.string().min(1).describe("Machine name for the table."),
  label: z.string().optional().describe("Human-readable table label. Defaults to the table name."),
  description: z.string().optional().describe("Table description."),
  fields: z.array(fieldSchema).min(1).describe("Fields to create on the table."),
  relations: z.array(relationSchema).optional().describe("Relationships to create with the table.")
});

const documentSchema = z.object({
  id: z.string().optional().describe("Existing document id. Used for updates; ignored for adds."),
  fields: z.record(z.unknown()).describe("Field values keyed by table field name."),
  relations: z.record(z.unknown()).optional().describe("Relation payload keyed by relation name.")
});

const mockRowSchema = z.record(z.unknown());

const organizationSchema = z.object({
  name: z.string().min(1).describe("Organization name."),
  description: z.string().optional(),
  state: z.string().optional().describe("Organization state. Defaults to Trial when omitted."),
  trialStartingDate: z.string().optional().describe("Trial start date, usually an ISO date string."),
  orgLogo: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  email: z.string().optional(),
  contact: z.string().optional(),
  other: z.string().optional(),
  finantialCardNumber: z.string().optional(),
  finantialCardExpirationDate: z.string().optional(),
  finantialCardSecurityCode: z.string().optional(),
  finantialCardHolderName: z.string().optional()
});

const client = new SeedClient({
  apiBase: process.env.SEED_API_BASE ?? "http://localhost:3007",
  accessToken: process.env.SEED_ACCESS_TOKEN,
  maintAccessToken: process.env.SEED_MAINT_ACCESS_TOKEN,
  maintPassword: process.env.SEED_MAINT_PASSWORD,
  orgName: process.env.SEED_ORG,
  email: process.env.SEED_EMAIL,
  password: process.env.SEED_PASSWORD
});

const server = new McpServer({
  name: "seed-mcp-server",
  version: "0.1.0"
});

server.tool(
  "seed_get_access_token",
  "Get a Seed API access token by prompting for credentials through the MCP client.",
  {
    type: accessTokenTypeSchema.optional().default("user").describe("Token type to request.")
  },
  async ({ type }) => {
    const accessToken = type === "maint" ? await getPromptedMaintToken() : await getPromptedUserToken();

    return toToolResult({ type, accessToken });
  }
);

server.tool(
  "seed_list_orgs",
  "List registered Seed organizations. Requires SEED_MAINT_ACCESS_TOKEN or SEED_MAINT_PASSWORD.",
  {
    pageNumber: z.number().int().min(0).optional().default(0),
    pageSize: z.number().int().min(1).max(500).optional().default(100),
    filtersJson: z.string().optional().describe("Optional JSON string of backend organization filters.")
  },
  async ({ pageNumber, pageSize, filtersJson }) => {
    const filters = parseOptionalJson(filtersJson, "filtersJson");
    return toToolResult(await client.listOrganizations(pageNumber, pageSize, filters));
  }
);

server.tool(
  "seed_register_org",
  "Register a new Seed organization with backend defaults. This calls the public organization register endpoint.",
  {
    orgName: z.string().min(1)
  },
  async ({ orgName }) => toToolResult({ message: await client.registerOrganization(orgName), orgName })
);

server.tool(
  "seed_create_org",
  "Create a Seed organization with optional organization metadata. Requires the configured Seed user to have create access.",
  organizationSchema.shape,
  async (input) => {
    const organization = toOrganization(input);
    return toToolResult({ message: await client.createOrganization(organization), organization });
  }
);

server.tool(
  "seed_update_org",
  "Update Seed organization metadata by organization name. Requires the configured Seed user to have update access.",
  organizationSchema.shape,
  async (input) => {
    const organization = toOrganization(input);
    return toToolResult({ message: await client.updateOrganization(organization), organization });
  }
);

server.tool(
  "seed_delete_org",
  "Delete a Seed organization by name, including its organization database file when present. Requires delete access.",
  {
    name: z.string().min(1).describe("Organization name to delete.")
  },
  async ({ name }) => toToolResult({ message: await client.deleteOrganization(name), name })
);

server.tool(
  "seed_list_tables",
  "List Seed table metadata from the configured organization.",
  {
    pageNumber: z.number().int().min(0).optional().default(0),
    pageSize: z.number().int().min(1).max(500).optional().default(100)
  },
  async ({ pageNumber, pageSize }) => toToolResult(await client.listTables(pageNumber, pageSize))
);

server.tool(
  "seed_get_table",
  "Get Seed metadata for one table.",
  {
    tableName: z.string().min(1)
  },
  async ({ tableName }) => toToolResult(await client.getTable(tableName))
);

server.tool(
  "seed_create_table",
  "Create a Seed table with fields and optional relationships.",
  tableSchema.shape,
  async (input) => {
    const table = toTableMetadata(input);
    const result = await client.createTable(table);
    return toToolResult({ message: result, table });
  }
);

server.tool(
  "seed_add_relationship",
  "Add or replace a relationship on an existing Seed table.",
  {
    sourceTableName: z.string().min(1).describe("Existing table that will receive the relationship."),
    relationName: z.string().min(1).describe("Relationship key on the source table."),
    relationType: relationTypeSchema.describe("Seed relationship type."),
    targetTableName: z.string().min(1).describe("Existing target table."),
    label: z.string().optional().describe("Human-readable relationship label. Defaults to relationName.")
  },
  async ({ sourceTableName, relationName, relationType, targetTableName, label }) => {
    await client.getTable(targetTableName);
    const updatedTable = await client.addRelationship(sourceTableName, relationName, {
      type: relationType,
      table: targetTableName,
      label: label ?? relationName
    });

    return toToolResult({
      message: `Relationship ${relationName} added to ${sourceTableName}.`,
      table: updatedTable
    });
  }
);

server.tool(
  "seed_list_documents",
  "List documents from a Seed table. Useful for finding record ids before creating related data.",
  {
    tableName: z.string().min(1).describe("Table to read documents from."),
    pageNumber: z.number().int().min(0).optional().default(0),
    pageSize: z.number().int().min(1).max(500).optional().default(100),
    filtersJson: z.string().optional().describe("Optional JSON filters using Seed's Sequelize-style filter shape."),
    orderJson: z.string().optional().describe("Optional JSON order array.")
  },
  async ({ tableName, pageNumber, pageSize, filtersJson, orderJson }) => {
    const filters = parseOptionalJson(filtersJson, "filtersJson");
    const order = parseOptionalArray(orderJson, "orderJson");
    return toToolResult(await client.listDocuments(tableName, pageNumber, pageSize, filters, order));
  }
);

server.tool(
  "seed_add_documents",
  "Add exact Seed document payloads to a table. Use this when rows include relations.",
  {
    tableName: z.string().min(1).describe("Table to insert into."),
    documents: z.array(documentSchema).min(1).describe("Documents with fields and optional relations.")
  },
  async ({ tableName, documents }) => {
    const ids = await client.addDocuments(tableName, documents as Document[]);
    return toToolResult({ message: `${tableName} documents created`, ids });
  }
);

server.tool(
  "seed_add_mock_data",
  "Add simple mock rows to a Seed table. Each row is treated as field values only; use seed_add_documents for relations.",
  {
    tableName: z.string().min(1).describe("Table to insert into."),
    rows: z.array(mockRowSchema).min(1).describe("Mock rows keyed by field name.")
  },
  async ({ tableName, rows }) => {
    const ids = await client.addDocuments(
      tableName,
      rows.map((row) => ({
        fields: row,
        relations: {}
      }))
    );

    return toToolResult({ message: `${tableName} mock rows created`, ids });
  }
);

server.tool(
  "seed_delete_documents",
  "Delete documents from a Seed table by id. Useful for cleaning up mock data.",
  {
    tableName: z.string().min(1).describe("Table to delete from."),
    documentIds: z.array(z.string().min(1)).min(1).describe("Document ids to delete.")
  },
  async ({ tableName, documentIds }) => {
    return toToolResult({ message: await client.deleteDocuments(tableName, documentIds), documentIds });
  }
);

server.tool(
  "seed_grant_permission",
  "Grant a role access to a Seed resource by creating a permissions row and linking it to the role. Access bitmask: create=1, read=2, update=4, delete=8, full CRUD=15.",
  {
    resourceId: z.string().min(1).describe("Resource/table id to grant access to, usually the table name."),
    access: accessSchema.optional().default(fullAccess).describe("Bitmask access value. Defaults to full CRUD (15)."),
    roleName: z.string().min(1).optional().default("admin").describe("Role to receive the permission."),
    name: z.string().optional().describe("Permission display name. Defaults to '<resourceId> Full CRUD'.")
  },
  async ({ resourceId, access, roleName, name }) => {
    return toToolResult(await client.grantPermission(resourceId, access, roleName, name));
  }
);

try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  const message = error instanceof SeedApiError || error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

function toTableMetadata(input: z.infer<typeof tableSchema>): TableMetadata {
  return {
    name: input.name,
    label: input.label ?? input.name,
    description: input.description ?? "",
    fields: Object.fromEntries(
      input.fields.map((field) => [
        field.name,
        {
          type: field.type as FieldType,
          label: field.label ?? field.name,
          allowNull: field.allowNull,
          enumValues: field.enumValues
        }
      ])
    ),
    relations: Object.fromEntries(
      (input.relations ?? []).map((relation) => [
        relation.name,
        {
          type: relation.type as RelationType,
          table: relation.table,
          label: relation.label ?? relation.name
        }
      ])
    )
  };
}

function toOrganization(input: z.infer<typeof organizationSchema>): Organization {
  return {
    name: input.name,
    description: input.description,
    state: input.state,
    trialStartingDate: input.trialStartingDate,
    orgLogo: input.orgLogo,
    phone: input.phone,
    address: input.address,
    website: input.website,
    email: input.email,
    contact: input.contact,
    other: input.other,
    finantialCardNumber: input.finantialCardNumber,
    finantialCardExpirationDate: input.finantialCardExpirationDate,
    finantialCardSecurityCode: input.finantialCardSecurityCode,
    finantialCardHolderName: input.finantialCardHolderName
  };
}

function parseOptionalJson(value: string | undefined, fieldName: string): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new SeedApiError(`${fieldName} must be valid JSON when provided.`);
  }
}

function parseOptionalArray(value: string | undefined, fieldName: string): unknown[] {
  const parsed = parseOptionalJson(value, fieldName);
  if (parsed === undefined) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    throw new SeedApiError(`${fieldName} must be a JSON array when provided.`);
  }
  return parsed;
}

async function getPromptedUserToken(): Promise<string> {
  const result = await server.server.elicitInput({
    mode: "form",
    message: "Enter Seed user credentials to request an access token.",
    requestedSchema: {
      type: "object",
      properties: {
        orgName: {
          type: "string",
          title: "Organization",
          description: "Seed organization name.",
          minLength: 1
        },
        email: {
          type: "string",
          title: "Email",
          description: "Seed user email.",
          format: "email"
        },
        password: {
          type: "string",
          title: "Password",
          description: "Seed user password.",
          minLength: 1
        }
      },
      required: ["orgName", "email", "password"]
    }
  });

  if (result.action !== "accept" || !result.content) {
    throw new SeedApiError("Seed access token request cancelled.");
  }

  const orgName = getPromptString(result.content, "orgName");
  const email = getPromptString(result.content, "email");
  const password = getPromptString(result.content, "password");

  return client.getAccessToken({ orgName, email, password });
}

async function getPromptedMaintToken(): Promise<string> {
  const result = await server.server.elicitInput({
    mode: "form",
    message: "Enter the Seed Maint password to request a Maint access token.",
    requestedSchema: {
      type: "object",
      properties: {
        maintPassword: {
          type: "string",
          title: "Maint Password",
          description: "Seed Maint password.",
          minLength: 1
        }
      },
      required: ["maintPassword"]
    }
  });

  if (result.action !== "accept" || !result.content) {
    throw new SeedApiError("Seed Maint access token request cancelled.");
  }

  return client.getMaintAccessToken(getPromptString(result.content, "maintPassword"));
}

function getPromptString(content: Record<string, string | number | boolean | string[]>, fieldName: string): string {
  const value = content[fieldName];
  if (typeof value !== "string" || !value) {
    throw new SeedApiError(`Prompt response missing ${fieldName}.`);
  }

  return value;
}

function toToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
