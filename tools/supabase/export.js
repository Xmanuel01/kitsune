#!/usr/bin/env node
/*
  Export Supabase tables to JSON files.

  Usage:
    - Install deps in this folder (or at project root):
        npm install @supabase/supabase-js fs-extra dotenv
    - Create a `.env` file in this folder (or project root) with:
        SUPABASE_URL=...
        SUPABASE_SERVICE_ROLE_KEY=...
    - Run:
        node export.js

  Output folder: `./exports` (one JSON file per table)
*/

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

// -----------------------------------------------------------------------------
// ENV + client
// -----------------------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) must be set in .env'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// -----------------------------------------------------------------------------
// Tables to export
// -----------------------------------------------------------------------------
let tables = [];

// Optional override via env: SUPABASE_EXPORT_TABLES=users,bookmarks,...
if (process.env.SUPABASE_EXPORT_TABLES) {
  tables = process.env.SUPABASE_EXPORT_TABLES.split(',').map((t) =>
    t.trim()
  );
} else {
  // Default set matching the old PocketBase collections
  tables = ['users', 'bookmarks', 'comments', 'watched', 'episode_sources'];
}

console.log('Tables to export:', tables.join(', '));

// -----------------------------------------------------------------------------
// Helper: fetch all rows from a table with paging
// -----------------------------------------------------------------------------
async function fetchAllRows(tableName, pageSize = 1000) {
  let from = 0;
  const all = [];

  // Simple pagination loop
  // Uses range() which maps to LIMIT/OFFSET under the hood
  // Stops when a page comes back smaller than pageSize.
  // You can add .order('id') if all tables have an `id` column.
  // Supabase requires at least one ordering if you rely on consistent paging,
  // but for small datasets this is usually fine.
  // To be safe, try to order by "id" if it exists.
  let orderColumn = 'id';

  while (true) {
    const query = supabase
      .from(tableName)
      .select('*')
      .range(from, from + pageSize - 1);

    const { data, error } = await query;

    if (error) {
      throw new Error(
        `Error selecting from ${tableName} (from=${from}): ${error.message}`
      );
    }

    if (!data || data.length === 0) break;

    all.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
(async () => {
  try {
    const outDir = path.resolve(__dirname, 'exports');
    await fs.ensureDir(outDir);

    for (const table of tables) {
      console.log(`Exporting table "${table}"...`);
      try {
        const rows = await fetchAllRows(table);
        const outPath = path.join(outDir, `${table}.json`);

        await fs.writeJson(outPath, rows, { spaces: 2 });

        console.log(
          `  ✓ Wrote ${rows.length} rows to ${path.relative(
            process.cwd(),
            outPath
          )}`
        );
      } catch (err) {
        console.warn(
          `  ⚠️  Failed exporting table "${table}":`,
          err.message || err
        );
      }
    }

    console.log('\nExport complete. See tools/supabase/exports');
    process.exit(0);
  } catch (err) {
    console.error('Export failed:', err);
    process.exit(1);
  }
})();
