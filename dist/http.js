#!/usr/bin/env node
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { SeedApiError, SeedClient } from "./seed-client.js";
const currentUserAgentsFrameName = "CurrentUserAgentsFrame";
const currentUserAgentRunsFrameName = "CurrentUserAgentRunsFrame";
function createTradingBotMcpServer(accessToken) {
    const client = new SeedClient({
        apiBase: process.env.SEED_API_BASE ?? "http://localhost:3007",
        accessToken
    });
    const server = new McpServer({
        name: "forgeiq-trading-bot",
        version: "0.1.0"
    });
    server.tool("trading_bot_list_agents", "List Trading Bot agents visible to the authenticated ForgeIQ user.", {
        pageNumber: z.number().int().min(0).optional().default(0),
        pageSize: z.number().int().min(1).max(100).optional().default(50),
        filtersJson: z.string().optional().describe("Optional JSON filters for the agents table."),
        orderJson: z.string().optional().describe("Optional JSON order array for the agents table.")
    }, async ({ pageNumber, pageSize, filtersJson, orderJson }) => {
        requireAccessToken(accessToken);
        const filters = parseOptionalJson(filtersJson, "filtersJson");
        const order = parseOptionalArray(orderJson, "orderJson");
        const page = await client.listFrameDocuments(currentUserAgentsFrameName, pageNumber, pageSize, filters, order);
        return toToolResult({
            paginationContext: page.paginationContext,
            agents: page.data.map(summarizeAgent)
        });
    });
    server.tool("trading_bot_get_agent", "Get one Trading Bot agent visible to the authenticated ForgeIQ user. Code is omitted unless includeCode is true.", {
        agentId: z.string().min(1),
        includeCode: z.boolean().optional().default(false)
    }, async ({ agentId, includeCode }) => {
        requireAccessToken(accessToken);
        const agent = await getVisibleAgent(client, agentId);
        return toToolResult(includeCode ? agent : summarizeAgent(agent));
    });
    server.tool("trading_bot_get_agent_code", "Get the currently saved JavaScript code for one Trading Bot agent visible to the authenticated ForgeIQ user.", {
        agentId: z.string().min(1)
    }, async ({ agentId }) => {
        requireAccessToken(accessToken);
        const agent = await getVisibleAgent(client, agentId);
        return toToolResult({
            agent: summarizeAgent(agent),
            code: typeof agent.code === "string" ? agent.code : ""
        });
    });
    server.tool("trading_bot_get_latest_run", "Get the current/latest run document for one Trading Bot agent visible to the authenticated ForgeIQ user.", {
        agentId: z.string().min(1)
    }, async ({ agentId }) => {
        requireAccessToken(accessToken);
        const agent = await getVisibleAgent(client, agentId);
        const runId = getLatestRunId(agent);
        if (!runId) {
            return toToolResult({ agent: summarizeAgent(agent), run: null, message: "Agent does not have a current/latest run id." });
        }
        const run = await getVisibleRun(client, runId);
        return toToolResult({ agent: summarizeAgent(agent), run: summarizeRun(run) });
    });
    server.tool("trading_bot_get_run_logs", "Get logs for a Trading Bot run visible to the authenticated ForgeIQ user. Use tailLines/maxChars to keep analysis scalable.", {
        runId: z.string().min(1),
        tailLines: z.number().int().min(1).max(5000).optional().default(500),
        maxChars: z.number().int().min(1000).max(500000).optional().default(120000)
    }, async ({ runId, tailLines, maxChars }) => {
        requireAccessToken(accessToken);
        await getVisibleRun(client, runId);
        const response = await client.getAgentRunLogs(runId);
        const logText = typeof response.logs === "string" ? response.logs : "";
        const lines = logText.split(/\r?\n/);
        const tail = lines.slice(Math.max(0, lines.length - tailLines)).join("\n");
        const text = trimTextTail(tail, maxChars);
        return toToolResult({
            runId: response.runId,
            totalLogLines: lines.length,
            returnedLogLines: Math.min(lines.length, tailLines),
            truncatedToMaxChars: text.truncated,
            logsText: text.value
        });
    });
    server.tool("trading_bot_get_agent_latest_logs", "Get the current/latest run logs for a Trading Bot agent visible to the authenticated ForgeIQ user.", {
        agentId: z.string().min(1),
        tailLines: z.number().int().min(1).max(5000).optional().default(500),
        maxChars: z.number().int().min(1000).max(500000).optional().default(120000)
    }, async ({ agentId, tailLines, maxChars }) => {
        requireAccessToken(accessToken);
        const agent = await getVisibleAgent(client, agentId);
        const runId = getLatestRunId(agent);
        if (!runId) {
            return toToolResult({ agent: summarizeAgent(agent), logs: [], message: "Agent does not have a current/latest run id." });
        }
        const response = await client.getAgentRunLogs(runId);
        const logText = typeof response.logs === "string" ? response.logs : "";
        const lines = logText.split(/\r?\n/);
        const tail = lines.slice(Math.max(0, lines.length - tailLines)).join("\n");
        const text = trimTextTail(tail, maxChars);
        return toToolResult({
            agent: summarizeAgent(agent),
            runId: response.runId,
            totalLogLines: lines.length,
            returnedLogLines: Math.min(lines.length, tailLines),
            truncatedToMaxChars: text.truncated,
            logsText: text.value
        });
    });
    server.tool("trading_bot_update_agent_code", "Update a Trading Bot agent's saved code. Use only after the user confirms the exact target agent and code change.", {
        agentId: z.string().min(1),
        code: z.string().min(1)
    }, async ({ agentId, code }) => {
        requireAccessToken(accessToken);
        await getVisibleAgent(client, agentId);
        const message = await client.updateAgentCode(agentId, code);
        return toToolResult({ agentId, message });
    });
    server.tool("trading_bot_start_agent", "Start or deploy a Trading Bot agent. Use only after the user confirms the target agent and mode.", {
        agentId: z.string().min(1),
        mode: z.enum(["run", "deploy"]).optional().default("run")
    }, async ({ agentId, mode }) => {
        requireAccessToken(accessToken);
        await getVisibleAgent(client, agentId);
        const run = await client.startAgent(agentId, mode);
        return toToolResult({ agentId, mode, runId: run.runId });
    });
    server.tool("trading_bot_stop_run", "Stop a running Trading Bot run. Use only after the user confirms the run id.", {
        runId: z.string().min(1)
    }, async ({ runId }) => {
        requireAccessToken(accessToken);
        await getVisibleRun(client, runId);
        const run = await client.stopAgentRun(runId);
        return toToolResult({ runId: run.runId });
    });
    return server;
}
const httpServer = createServer(async (req, res) => {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
    }
    if (!isMcpPath(req.url)) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
        return;
    }
    if (req.method !== "POST") {
        writeJsonRpcError(res, 405, -32000, "Method not allowed.");
        return;
    }
    const accessToken = getBearerToken(req);
    const server = createTradingBotMcpServer(accessToken);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
    });
    try {
        const parsedBody = await readJsonBody(req);
        await server.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
    }
    catch (error) {
        const message = error instanceof SeedApiError || error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
            writeJsonRpcError(res, 500, -32603, message || "Internal server error.");
        }
    }
    finally {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
    }
});
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3010");
httpServer.listen(port, host, () => {
    console.error(`ForgeIQ Trading Bot MCP listening on http://${host}:${port}/mcp`);
});
function isMcpPath(url) {
    const path = new URL(url ?? "/", "http://localhost").pathname;
    return path === "/mcp" || path === "/mcp/";
}
function getBearerToken(req) {
    const authorization = req.headers.authorization;
    if (authorization?.toLowerCase().startsWith("bearer ")) {
        return authorization.slice("bearer ".length).trim();
    }
    const seedToken = req.headers["x-seed-access-token"];
    return Array.isArray(seedToken) ? seedToken[0] : seedToken;
}
function requireAccessToken(accessToken) {
    if (!accessToken) {
        throw new SeedApiError("ForgeIQ access token missing. Call /mcp with Authorization: Bearer <ForgeIQ access token>.");
    }
}
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    if (!bodyText.trim()) {
        return undefined;
    }
    return JSON.parse(bodyText);
}
function writeJsonRpcError(res, status, code, message) {
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code, message },
        id: null
    }));
}
function setCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", process.env.MCP_CORS_ORIGIN ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Seed-Access-Token, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}
function parseOptionalJson(value, fieldName) {
    if (value === undefined) {
        return undefined;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        throw new SeedApiError(`${fieldName} must be valid JSON when provided.`);
    }
}
function parseOptionalArray(value, fieldName) {
    const parsed = parseOptionalJson(value, fieldName);
    if (parsed === undefined) {
        return [];
    }
    if (!Array.isArray(parsed)) {
        throw new SeedApiError(`${fieldName} must be a JSON array when provided.`);
    }
    return parsed;
}
function summarizeAgent(agent) {
    return {
        id: valueAsString(agent.id),
        name: agent.name,
        status: agent.status,
        runtime: agent.runtime,
        language: agent.language,
        currentRunId: valueAsString(agent.currentRunId),
        latestRunId: valueAsString(agent.latestRunId),
        lastRunId: valueAsString(agent.lastRunId),
        hasCode: typeof agent.code === "string" && agent.code.length > 0
    };
}
function summarizeRun(run) {
    return {
        id: valueAsString(run.id),
        agentId: valueAsString(run.agentId),
        status: run.status,
        mode: run.mode,
        startedAt: run.startedAt,
        stoppedAt: run.stoppedAt,
        completedAt: run.completedAt
    };
}
async function getVisibleAgent(client, agentId) {
    const page = await client.listFrameDocuments(currentUserAgentsFrameName, 0, 1, { id: agentId });
    const agent = page.data[0];
    if (!agent) {
        throw new SeedApiError(`Agent ${agentId} is not visible to the authenticated ForgeIQ user.`);
    }
    return agent;
}
async function getVisibleRun(client, runId) {
    const page = await client.listFrameDocuments(currentUserAgentRunsFrameName, 0, 1, { id: runId });
    const run = page.data[0];
    if (!run) {
        throw new SeedApiError(`Run ${runId} is not visible to the authenticated ForgeIQ user.`);
    }
    return run;
}
function getLatestRunId(agent) {
    return valueAsString(agent.currentRunId ?? agent.latestRunId ?? agent.lastRunId);
}
function valueAsString(value) {
    if (typeof value === "string" && value.length > 0) {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return undefined;
}
function trimTextTail(value, maxChars) {
    if (value.length <= maxChars) {
        return { value, truncated: false };
    }
    return {
        value: value.slice(value.length - maxChars),
        truncated: true
    };
}
function toToolResult(value) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, null, 2)
            }
        ]
    };
}
