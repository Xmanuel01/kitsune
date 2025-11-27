PocketBase -> Supabase Migration tools

Overview

This folder contains helper scripts to export PocketBase collections and import them into Supabase.
They are intended to be run locally by the developer and require admin credentials for PocketBase and a Supabase service role key.

Prerequisites
- Node 18+ (or compatible)
- In this folder run `npm install` to install migration tool deps

Environment
Create a `.env` file in this folder (or export env vars) with the following values:

# PocketBase
PB_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=secret

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_BUCKET=public

Usage
1) Export PocketBase collections:

   cd tools/pb-migration
   npm install
   npm run export

   This creates `tools/pb-migration/exports/{collection}.json` and downloads files to `exports/files`.

2) (Optional) Reupload downloaded files to Supabase storage:

   npm run upload-files

3) Import JSON into Supabase tables:

   npm run import

Notes and caveats
- Users' passwords: If passwords are not available or are hashed in a non-compatible way, the script will create users with a random password and you'll need to send a password reset email or prompt users to reauthenticate.
- Database schema: Ensure your Supabase DB schema has tables that match the PocketBase collections (fields/types). The import script does a straightforward insert; complex relations may require manual mapping.
- Backups: Keep a backup of your PocketBase `pb_data` directory before running migration.
- This is a helper toolkit — review scripts and test on a staging environment before migrating production data.

If you want, I can:
- Generate a mapping file for collections -> SQL `CREATE TABLE` statements based on the exported JSON.
- Run a dry-run import that prints the SQL statements instead of executing.

