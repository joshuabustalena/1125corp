import { supabase } from '@/lib/supabase/client';

/*
  Runs a Supabase .in('column', ids) query in batches instead of one call.

  A single .in() with every id inlined into the URL breaks once the list gets
  long enough — Balanga alone has 413 customers, and passing them all as query
  parameters builds a ~15,000 character URL that the request fails outright on
  ("fetch failed"). Verified against live data that 300 ids (~11,000 chars)
  still succeeds; 150 leaves a wide margin for the branch to keep growing.

  Use this wherever the id list comes from an unbounded, unpaginated query
  (e.g. "every customer in this branch") rather than a page of results that's
  already capped small. Where the ids can instead be reached with a join
  (`.eq('customers.branch_id', ...)`), prefer that — it's one request instead
  of several.
*/
const CHUNK_SIZE = 150;

export async function selectInChunks<T>(
  build: (query: ReturnType<typeof supabase.from>) => any,
  tableName: string,
  column: string,
  ids: string[],
): Promise<T[]> {
  if (ids.length === 0) return [];
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const { data, error } = await build(supabase.from(tableName)).in(column, chunk);
    if (error) throw error;
    results.push(...((data as T[]) ?? []));
  }
  return results;
}
