# Seed MCP Server

MCP server for creating and inspecting Seed tables and relationships through the existing `seed-backend` HTTP API.

## Setup

```bash
npm install
npm run build
```

## Configuration

Set either an access token:

```bash
SEED_API_BASE=http://localhost:3007
SEED_ACCESS_TOKEN=...
```

Or login credentials:

```bash
SEED_API_BASE=http://localhost:3007
SEED_ORG=visual-sql
SEED_EMAIL=admin@admin.com
SEED_PASSWORD=admin
```

For organization listing, set a Maint token or Maint password:

```bash
SEED_MAINT_ACCESS_TOKEN=...
# or
SEED_MAINT_PASSWORD=...
```

## Run

```bash
npm start
```

## Tools

- `seed_get_access_token`
- `seed_list_orgs`
- `seed_register_org`
- `seed_create_org`
- `seed_update_org`
- `seed_delete_org`
- `seed_list_tables`
- `seed_get_table`
- `seed_create_table`
- `seed_add_relationship`
- `seed_list_documents`
- `seed_add_documents`
- `seed_add_mock_data`
- `seed_delete_documents`
- `seed_grant_permission`

### `seed_get_access_token`

Get a Seed API access token for either a regular organization user or Maint. The MCP server prompts for credentials through the client instead of accepting them as tool arguments.

User token:

```json
{ "type": "user" }
```

Maint token:

```json
{ "type": "maint" }
```

### `seed_grant_permission`

Grant a role access to a table/resource by creating a row in `permissions` and linking it to the role.

```json
{
  "resourceId": "accounts",
  "access": 15,
  "roleName": "admin"
}
```

Access bitmask: create `1`, read `2`, update `4`, delete `8`, full CRUD `15`.

### `seed_list_documents`

List documents from a table, usually to inspect data or find ids for relations.

```json
{
  "tableName": "accounts",
  "pageNumber": 0,
  "pageSize": 25
}
```

### `seed_add_documents`

Add exact Seed document payloads. Use this when rows include relations.

```json
{
  "tableName": "contacts",
  "documents": [
    {
      "fields": {
        "firstName": "Avery",
        "lastName": "Stone",
        "email": "avery@example.com"
      },
      "relations": {
        "account": {
          "type": "OneToOne",
          "table": "accounts",
          "id": "1"
        }
      }
    }
  ]
}
```

### `seed_add_mock_data`

Add simple field-only mock rows. Use `seed_add_documents` when you need relations.

```json
{
  "tableName": "accounts",
  "rows": [
    {
      "name": "Horizon Capital",
      "accountType": "Company",
      "vertical": "Dealmakers"
    }
  ]
}
```

### `seed_delete_documents`

Delete documents by id. Useful for cleaning up generated mock data.

```json
{
  "tableName": "accounts",
  "documentIds": ["1", "2"]
}
```
