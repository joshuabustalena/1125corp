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

/*
  Fetches EVERY row a query matches, page by page.

  PostgREST caps a response at 1000 rows by default and says nothing when it
  truncates — no error, no flag, just a short array. Any code that sums or
  counts what comes back is then quietly wrong, and only starts being wrong
  once the table crosses 1000 rows, long after the code was written and
  tested.

  That is exactly what happened on the Collector Remittance page: `payments`
  reached 1,077 rows, the page's unpaginated "every payment up to this date"
  query silently returned only the first 1000, and the 77 it dropped belonged
  mostly to two collectors — whose Balance Owed then read -₱73,450 and
  -₱174,870 because their collected total was short while their remitted
  total (54 rows, well under the cap) was complete.

  Use this for any query whose result is AGGREGATED (summed, counted,
  reconciled) rather than just displayed a page at a time. A query already
  narrowed to one day, one loan, or one customer doesn't need it.
*/
const PAGE_SIZE = 1000;

export async function selectAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data as T[]) ?? [];
    rows.push(...batch);
    // A short page means this was the last one. A full page might be the
    // last one too — the next round trip returns empty and ends it.
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

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
