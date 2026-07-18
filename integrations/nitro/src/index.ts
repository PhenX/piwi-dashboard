import { AsyncLocalStorage } from 'node:async_hooks';
import { gzipSync } from 'node:zlib';
import { consola } from 'consola';
// Type-only: importing 'nitropack/runtime' at runtime only resolves inside a
// Nitro build, and this module must also load from node_modules when the
// server bundle externalizes it (e.g. dev builds).
import type { NitroAppPlugin } from 'nitropack';

const MAX_ENTRIES = 50;
const MAX_MSG_LENGTH = 500;
const MAX_STACK_FRAMES = 5;

export interface PiwiTestLogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
  stack?: string;
}

/** Parse and shrink a JS/TS stack trace: skip internal/node_modules frames, keep max 5. */
function shrinkStack(stack: string): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  const frames: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue; // skip error message line
    if (trimmed.includes('node:internal') || trimmed.includes('node_modules')) continue;
    if (frames.length >= MAX_STACK_FRAMES) break;
    frames.push(trimmed.slice(3).trim());
  }
  return frames.length > 0 ? frames.join('\n') : undefined;
}

/** Extract stack from an unknown error value, shrunk, or undefined. */
function extractStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return shrinkStack(err.stack);
  return undefined;
}

// Links consola calls to the request being handled. The store is scoped with
// als.run() around the whole downstream handler chain — enterWith() from a
// request hook is not reliable here (the binding dies with the hook's own
// async scope, so only the first request after boot would capture).
const als = new AsyncLocalStorage<PiwiTestLogEntry[]>();

// The consola reporter is process-global — register it only once.
let reporterAdded = false;

const TEST_LOGS_DISABLED =
  process.env.PIWI_TEST_LOGS_DISABLED === 'true' ||
  (process.env.NODE_ENV === 'production' && process.env.PIWI_TEST_LOGS_DISABLED !== 'false');

const piwiTestLogs: NitroAppPlugin = (nitroApp) => {
  if (TEST_LOGS_DISABLED) return;

  if (!reporterAdded) {
    reporterAdded = true;
    consola.addReporter({
      log(logObj) {
        if (logObj.level > 1) return; // Warning (1) and Error/Fatal (0) only
        const store = als.getStore();
        if (!store) return;
        const msg = logObj.args.map(String).join(' ');
        const stack = logObj.args.map(extractStack).find(Boolean);
        store.push({
          timestamp: Date.now(),
          level: logObj.level <= 0 ? 'Error' : 'Warning',
          category: logObj.tag ?? '',
          message: msg.length > MAX_MSG_LENGTH ? `${msg.slice(0, MAX_MSG_LENGTH)}…` : msg,
          stack,
        });
      },
    });
  }

  // Wrap the root h3 handler: both the node listener (dev and node-server
  // production entries) and route dispatch go through h3App.handler, so the
  // als.run() scope covers every hook, middleware, and route handler.
  const originalHandler = nitroApp.h3App.handler;
  nitroApp.h3App.handler = ((event) => {
    const logs: PiwiTestLogEntry[] = [];
    event.context._piwiLogs = logs;

    // Patch res.end so the X-Piwi-Logs header is injected for ALL responses,
    // including H3 error responses where Nitro bypasses the 'beforeResponse'
    // hook (h3 skips onBeforeResponse once the error handler has called res.end).
    const res = event.node.res as any;
    const originalEnd = res.end.bind(res) as (...args: any[]) => any;
    res.end = (...args: any[]) => {
      if (!res.headersSent) {
        // Collect any unhandled H3/Nitro errors — they are synchronously pushed
        // to event.context.nitro.errors before errorHandler runs, so they're
        // always available here even for error responses.
        const nitroErrors = (event.context.nitro as any)?.errors as
          | Array<{ error: unknown }>
          | undefined;
        if (nitroErrors?.length) {
          for (const { error } of nitroErrors) {
            const msg = error instanceof Error ? (error.message || String(error)) : String(error);
            logs.push({
              timestamp: Date.now(),
              level: 'Error',
              category: 'server',
              message: msg.length > MAX_MSG_LENGTH ? `${msg.slice(0, MAX_MSG_LENGTH)}…` : msg,
              stack: extractStack(error),
            });
          }
        }
        const payload = logs.length > MAX_ENTRIES ? logs.slice(0, MAX_ENTRIES) : logs;
        res.setHeader('X-Piwi-Logs', gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64'));
      }
      return originalEnd(...args);
    };

    return als.run(logs, () => originalHandler(event));
  }) as typeof originalHandler;
};

export default piwiTestLogs;
