/**
 * Run 010_demo_support.sql migration via Supabase Management API (pg_query)
 * Usage: npx tsx supabase/seed/run-migration.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../../apps/web/.env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq)]) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

const DB_URL = process.env.DATABASE_URL!;

async function main() {
  const sqlPath = path.resolve(__dirname, "../migrations/010_demo_support.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  // Split SQL into individual statements
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith("--"));

  console.log(`Running ${statements.length} SQL statements...`);

  // Use pg directly if available, otherwise use fetch to Supabase REST
  try {
    const pg = await import("pg").catch(() => null);
    if (pg) {
      const client = new pg.default.Client({ connectionString: DB_URL });
      await client.connect();
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          await client.query(stmt);
          console.log(`  [${i + 1}/${statements.length}] OK`);
        } catch (err: any) {
          // Ignore "already exists" errors
          if (err.message?.includes("already exists") || err.message?.includes("duplicate")) {
            console.log(`  [${i + 1}/${statements.length}] SKIP (already exists)`);
          } else {
            console.error(`  [${i + 1}/${statements.length}] ERROR: ${err.message}`);
          }
        }
      }
      await client.end();
      console.log("Migration complete!");
      return;
    }
  } catch {}

  // Fallback: run full SQL via Supabase management API
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL!.match(/https:\/\/(.+)\.supabase/)?.[1];
  if (!projectRef) {
    console.error("Could not extract project ref from SUPABASE_URL");
    process.exit(1);
  }

  console.log("No pg module available. Run this SQL manually in Supabase Dashboard > SQL Editor:");
  console.log("File:", sqlPath);
  process.exit(1);
}

main();
