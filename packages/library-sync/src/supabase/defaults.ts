/**
 * Supabase defaults baked into the build.
 *
 * These are PUBLIC values (the anon/publishable key is designed to live in the
 * client — Row Level Security, not this key, isolates each user's data). End
 * users never configure anything: this config ships inside the app.
 *
 * `process.env.SUPABASE_URL` / `SUPABASE_ANON_KEY` (or the mobile
 * `EXPO_PUBLIC_*` equivalents) still override these for local development.
 */
export const DEFAULT_SUPABASE_URL = "https://bcknonhusblmamdltuxt.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_pFp0CykF2pHSSdfBuP6Opw_Qb-GZBnl";
