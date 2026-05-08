import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DB_NAME = process.env.D1_DATABASE_NAME || "maildb";
const BINDING_NAME = process.env.D1_BINDING_NAME || "DB";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = dirname(here);
const wranglerConfigPath = join(workerDir, "wrangler.toml");

const hasCloudflareAuth = process.env.CLOUDFLARE_API_TOKEN
    || process.env.CF_API_TOKEN
    || process.env.CLOUDFLARE_ACCOUNT_ID;

if (!hasCloudflareAuth) {
    console.log("[cf-build-config] Cloudflare auth env not found; skip generated wrangler.toml.");
    process.exit(0);
}

if (existsSync(wranglerConfigPath)) {
    console.log("[cf-build-config] wrangler.toml already exists; leave it unchanged.");
    process.exit(0);
}

const parseJsonFromOutput = (output) => {
    const trimmed = output.trim();
    const firstArray = trimmed.indexOf("[");
    const firstObject = trimmed.indexOf("{");
    const firstJson = [firstArray, firstObject]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
    if (firstJson === undefined) {
        throw new Error("No JSON payload found in wrangler output.");
    }
    return JSON.parse(trimmed.slice(firstJson));
};

const runWranglerJson = (...args) => {
    const command = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
    const output = execFileSync(command, args, {
        cwd: workerDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
    });
    return parseJsonFromOutput(output);
};

const listResult = runWranglerJson("d1", "list", "--json");
const databases = Array.isArray(listResult) ? listResult : (listResult.result || []);
const database = databases.find((item) => {
    const name = item.name || item.database_name;
    return name === DB_NAME;
});

if (!database) {
    throw new Error(`D1 database '${DB_NAME}' was not found in this Cloudflare account.`);
}

const databaseId = database.uuid || database.id || database.database_id;
if (!databaseId) {
    throw new Error(`D1 database '${DB_NAME}' did not include an id in wrangler output.`);
}

const toml = `keep_vars = true

[[d1_databases]]
binding = "${BINDING_NAME}"
database_name = "${DB_NAME}"
database_id = "${databaseId}"
`;

writeFileSync(wranglerConfigPath, toml, "utf8");
console.log(`[cf-build-config] Generated wrangler.toml with ${BINDING_NAME} -> ${DB_NAME}.`);
