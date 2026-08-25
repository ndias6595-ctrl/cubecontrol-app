import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL } from "@tonehub/library-sync/supabase";

export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

/**
 * Minimal `.env` loader. Reads `apps/desktop/.env` (plain KEY=VALUE lines),
 * then falls back to `process.env`. This keeps configuration to "edit one
 * file" instead of setting shell environment variables.
 */
function readDotEnv(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return values;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function supabaseConfig(): SupabaseConfig | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "..", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  let dotenv: Record<string, string> = {};
  for (const file of candidates) {
    dotenv = readDotEnv(file);
    if (Object.keys(dotenv).length > 0) break;
  }

  const url = process.env.SUPABASE_URL ?? dotenv.SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? dotenv.SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;
  if (!url || !anonKey || anonKey.startsWith("PASTE_")) return null;
  return { url, anonKey };
}
