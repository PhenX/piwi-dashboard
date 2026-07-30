// The implementation lives in `shared/` so the server, demo router, and browser
// share one parser. Re-exported here so existing `server/utils/parse-location`
// importers keep working.
export { parseLocation } from '#shared/parse-location';
