import { defineNitroConfig } from 'nitropack/config';

// A minimal standalone Nitro app (pages in app/routes, JSON endpoints in
// app/api) used as the system under test. Backend logs are captured by
// @piwitests/instrumentation, registered in app/plugins/piwi-test-logs.ts.
export default defineNitroConfig({
  srcDir: 'app',
  compatibilityDate: '2026-07-17',
  // Bundle the instrumentation into the server build. Needed for
  // @piwitests/instrumentation <= 0.12.0, whose `nitropack/runtime` import
  // only resolves in-bundle; harmless on later versions.
  externals: { inline: ['@piwitests/instrumentation'] },
});
