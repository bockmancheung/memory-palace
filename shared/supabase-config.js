/* =========================================================
   SUPABASE CONFIG
   Paste your own project's values below. Find them in the
   Supabase dashboard: Project Settings -> API.
     - "Project URL"        -> url
     - "anon" / "public" key -> anonKey   (NOT the service_role key)

   The anon key is safe to publish in client-side code like this
   -- it's the public key. Access to real data is controlled by
   the Row Level Security policies in shared/schema.sql, not by
   keeping this key secret.

   Until you fill these in, the site keeps working normally --
   it just stays in "guest" (local-storage-only) mode and the
   sign-in button explains that cloud sync isn't set up yet.
   ========================================================= */
window.SUPABASE_CONFIG = {
  url: 'https://vvzsqytucujepomgfzdg.supabase.co',
  anonKey: 'sb_publishable_60XKVZF0OIHdf9mActRbhg_oPMuZ44v'
};
