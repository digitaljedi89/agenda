// Verifies a Supabase access token and returns the user id (or null).
export async function userIdFromToken(token) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? String(u.id) : null;
}
export const bearer = req => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
