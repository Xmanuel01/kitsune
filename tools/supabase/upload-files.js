#!/usr/bin/env node
/*
  Upload files downloaded during PB export into Supabase storage.
  Expects files under ./exports/files/{collection}/{recordId}/{filename}
  Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_SUPABASE_BUCKET in env.
*/

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'public';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const filesDir = path.resolve(__dirname, 'exports', 'files');
  if (!fs.existsSync(filesDir)) {
    console.error('No files directory found at', filesDir);
    process.exit(1);
  }

  const collections = await fs.readdir(filesDir);
  for (const col of collections) {
    const colPath = path.join(filesDir, col);
    const recordIds = await fs.readdir(colPath);
    for (const rid of recordIds) {
      const recPath = path.join(colPath, rid);
      const filenames = await fs.readdir(recPath);
      for (const fname of filenames) {
        const full = path.join(recPath, fname);
        const dest = `${col}/${rid}/${fname}`;
        console.log('Uploading', full, '->', dest);
        try {
          const file = await fs.readFile(full);
          const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(dest, file, { upsert: true });
          if (error) console.warn('Upload error', error.message || error);
        } catch (e) {
          console.warn('Failed uploading file', full, e.message || e);
        }
      }
    }
  }

  console.log('Uploads complete. Files available under bucket:', BUCKET);
})();
