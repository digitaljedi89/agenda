// Public Supabase settings for the browser. Both values are designed to be public;
// row-level security in the database is what keeps each account's events private.
export default async () => Response.json(
  { url: process.env.SUPABASE_URL || null, key: process.env.SUPABASE_ANON_KEY || null },
  { headers: { 'cache-control': 'no-store' } }
);
export const config = { path: '/api/config' };
