// src/lib/fetchAll.js
// PostgREST caps every response at 1000 rows and gives no error when it
// truncates — a .limit(5000) still comes back with 1000. Anything that could
// exceed 1000 rows has to page through with .range() instead.
//
// Usage:
//   const products = await fetchAll(() =>
//     supabase.from("products").select("*").eq("company_id", companyId)
//   );
//
// The callback must build a FRESH query each time; a Supabase query builder
// cannot be re-used once it has been awaited.

var PAGE_SIZE = 1000;
var MAX_PAGES = 50;

export async function fetchAll(buildQuery) {
  var out = [];
  var page = 0;
  while (page < MAX_PAGES) {
    var from = page * PAGE_SIZE;
    var res = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (res.error) throw res.error;
    var rows = res.data || [];
    out = out.concat(rows);
    if (rows.length < PAGE_SIZE) break;
    page++;
  }
  return out;
}

// .in() lists travel in the URL, so long id lists must be chunked or the
// request line exceeds the server limit.
var IN_CHUNK = 200;

export async function fetchAllIn(buildQuery, column, values) {
  var out = [];
  for (var i = 0; i < values.length; i += IN_CHUNK) {
    var slice = values.slice(i, i + IN_CHUNK);
    var rows = await fetchAll(function () {
      return buildQuery().in(column, slice);
    });
    out = out.concat(rows);
  }
  return out;
}
