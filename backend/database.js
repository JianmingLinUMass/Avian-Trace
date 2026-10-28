import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const databasePath = path.join(
  root,
  "database",
  "ebird.duckdb"
);

if (!existsSync(databasePath)) {
  throw new Error(`Database not found: ${databasePath}`);
}

const instance = await DuckDBInstance.create(databasePath, {
  access_mode: "READ_ONLY",
  threads: "4"
});

const connection = await instance.connect();

export async function query(sql, params = []) {
  const start = performance.now();

  const reader = await connection.runAndReadAll(sql, params);
  const rows = reader.getRowObjectsJson();

  return {
    data: rows,
    queryTimeMs: Number((performance.now() - start).toFixed(2))
  };
}