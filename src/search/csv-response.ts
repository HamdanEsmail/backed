// The CSV export as a download.
import { searchCsv } from "./exports";
import type { SearchView } from "./read";

export function csvResponse(view: SearchView): Response {
  return new Response(searchCsv(view), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="backed-${view.search.id}.csv"`,
      "cache-control": "no-store",
    },
  });
}
