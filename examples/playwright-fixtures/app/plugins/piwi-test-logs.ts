// Backend-log capture: every response carries an X-Piwi-Logs header with the
// request's Warning/Error log entries, which the Piwi reporter attaches to the
// matching network request. This one-line re-export is the entire setup.
// (In a Nuxt app the file lives in server/plugins/ instead.)
export { default } from '@piwitests/instrumentation-nitro';
