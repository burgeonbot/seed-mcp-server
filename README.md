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

- `trading_bot_login`
- `trading_bot_list_agents`
- `trading_bot_get_agent`
- `trading_bot_get_agent_code`
- `trading_bot_get_latest_run`
- `trading_bot_get_run_logs`
- `trading_bot_get_agent_latest_logs`
- `trading_bot_update_agent_code`
- `trading_bot_start_agent`
- `trading_bot_stop_run`
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
- `seed_list_frames`
- `seed_get_frame`
- `seed_create_frame`
- `seed_update_frame`
- `seed_delete_frames`
- `seed_list_views`
- `seed_get_view`
- `seed_create_view`
- `seed_update_view`
- `seed_delete_views`
- `seed_list_documents`
- `seed_add_documents`
- `seed_add_mock_data`
- `seed_delete_documents`
- `seed_grant_permission`

## Local Trading Bot Debugging

Build the MCP server:

```bash
cd /Users/damiaferrer/Documents/burgeonbot/seed-mcp-server
npm run build
```

Make sure the backend is running locally. The MCP defaults to:

```bash
SEED_API_BASE=http://localhost:3007
```

Register it with Codex:

```bash
codex mcp add trading-bot -- node /Users/damiaferrer/Documents/burgeonbot/seed-mcp-server/dist/index.js
```

After restarting Codex, ask it to use the Trading Bot MCP. First call `trading_bot_login`; it will prompt
for organization, email, and password, then keep the access token in memory for that MCP process.

Useful prompts:

```text
Use the Trading Bot MCP, login, then list my agents.
```

```text
Use the Trading Bot MCP and analyze agent 10's latest logs and current code. Suggest changes, but do not apply them without confirmation.
```

Mutating tools are available for confirmed changes only:

- `trading_bot_update_agent_code`
- `trading_bot_start_agent`
- `trading_bot_stop_run`

Those tools use the existing backend permissions for the logged-in user.

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

### `seed_create_frame`

Create a frame on top of an existing table. Frames select the fields and relations that a view can render.

```json
{
  "name": "accounts_frame",
  "table": "accounts",
  "label": "Accounts",
  "fields": [
    { "name": "name", "type": "string", "label": "Name" },
    { "name": "accountType", "type": "enum", "label": "Account Type" }
  ],
  "relations": []
}
```

Optional filter/order inputs are JSON strings: `fieldFiltersJson`, `fieldOrderJson`, and `relationFiltersJson`.

For user-scoped frames, use `relationFiltersJson` with Seed's current-user sentinel. The backend treats
`"___current___"` as the logged-in user's email when the dot-walk path ends at a related `users.email`
field. The path uses Seed's generated join table name:

```json
{
  "relationFiltersJson": "{\"[Op.and]\":[{\"users_contacts_user.email\":{\"[Op.like]\":\"___current___\"}}]}"
}
```

Join table names are generated as `<lexicographically larger table>_<lexicographically smaller table>_<relationName>`.
For example, a `contacts.user -> users` relation uses `users_contacts_user.email`, while
`voice_notes.user -> users` uses `voice_notes_users_user.email`.

### `seed_create_view`

Create a view on top of an existing frame.

```json
{
  "name": "accounts_web_view",
  "frame": "accounts_frame",
  "label": "Accounts",
  "layoutJson": "{\"device\":\"web\",\"group\":\"CRM\",\"list\":{\"type\":\"default\"}}"
}
```

Optional role inputs are JSON strings: `viewRolesJson` and `editRolesJson`.

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
