#!/usr/bin/env node
/*
  Import exported PocketBase JSON into Supabase tables using the service role key.
  Usage:
    - Set environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    - Place exported files in `./exports/{collection}.json` (from export.js)
    - Run: `node import-to-supabase.js`

  Notes:
    - Users: this script will attempt to create users via the admin API if `password` is present.
      If you cannot import passwords, create users with a random password and trigger password reset emails.
    - File blobs: run `upload-files.js` to reupload downloaded files to Supabase storage.
*/

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const exportsDir = path.resolve(__dirname, 'exports');
  if (!fs.existsSync(exportsDir)) {
    console.error('exports directory not found. Run export.js first');
    process.exit(1);
  }

  const files = await fs.readdir(exportsDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const collection = path.basename(file, '.json');
    const data = await fs.readJson(path.join(exportsDir, file));
    console.log('Importing collection', collection, 'records:', data.length);

    if (collection === 'users') {
      for (const rec of data) {
        try {
          const password = rec.password || rec._rawPassword || null;
          if (password) {
            await supabaseAdmin.auth.admin.createUser({
              email: rec.email,
              password: password,
              user_metadata: rec
            });
          } else {
            // create user with random password and mark email as unconfirmed
            const pw = Math.random().toString(36).slice(2);
            await supabaseAdmin.auth.admin.createUser({
              email: rec.email,
              password: pw,
              user_metadata: rec
            });
          }
        } catch (e) {
          console.warn('Could not create user', rec.email, e.message || e);
        }
      }
    } else {
      // Bulk insert into a table named after the collection. Make sure schema exists.
      try {
        // strip PocketBase internal fields not relevant to Supabase
        const rows = data.map((r) => {
          const out = { ...r };
          delete out.collection;
          delete out.expand;
          delete out._transient;
          delete out._raw; // remove raw fields if any
          return out;
        });

        // insert in chunks
        const chunkSize = 100;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const { data: resData, error } = await supabaseAdmin.from(collection).insert(chunk, { returning: 'representation' });
          if (error) {
            console.warn('Insert error for collection', collection, error.message || error);
          }
        }
      } catch (e) {
        console.warn('Failed to import collection', collection, e.message || e);
      }
    }
  }

  console.log('Import finished. Run upload-files.js to reupload files to Supabase storage if needed.');
})();
