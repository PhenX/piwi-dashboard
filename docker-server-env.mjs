// Preloaded (via `node --import`) before the bundled server starts.
//
// The prebuilt server bakes its runtime config at build time and only honors
// NUXT_*-prefixed overrides at run time. Map the operator-facing PIWI_AUTH_*
// variables onto those overrides so enabling authentication at run time takes
// effect on both the server and the browser (public) config. Existing NUXT_*
// values win, and PIWI_SECRET_KEY / PIWI_AUTH_ENABLED are still read directly by
// the server, so this only reconciles the pieces baked into the client bundle.
if (process.env.PIWI_AUTH_ENABLED === 'true') {
  process.env.NUXT_AUTH_ENABLED ??= 'true';
  process.env.NUXT_PUBLIC_AUTH_ENABLED ??= 'true';
}
if (process.env.PIWI_AUTH_SECRET) {
  process.env.NUXT_AUTH_SECRET ??= process.env.PIWI_AUTH_SECRET;
}
