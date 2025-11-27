// src/lib/supabaseClient.ts

import { createClient } from "@supabase/supabase-js";

// Public client (used in the browser and client components)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Optional: service role key (server-only)
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Make sure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
  );
}

// This is the standard public client you already use on the frontend
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// This is a server-side “admin” client for RLS-bypassing/cache writes in API routes
// If SUPABASE_SERVICE_ROLE_KEY is not set locally, we gracefully fall back to the public client
export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
      },
    })
  : supabase;
