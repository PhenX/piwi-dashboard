/**
 * Type declarations for the Node-importable fingerprint mirror.
 * See `demo-fingerprint.mjs` — logic mirrors `shared/error-fingerprint.ts`.
 */

export type DemoErrorType = 'timeout' | 'assertion' | 'strict-mode' | 'navigation' | 'crash' | 'unknown';

export interface DemoErrorSignature {
  errorType: DemoErrorType;
  signature: string;
  normalizedMessage: string;
  selector: string | null;
  topFrameFile: string | null;
}

export interface DemoErrorFingerprint extends DemoErrorSignature {
  fingerprint: string;
}

export declare function stripAnsi(text: string): string;
export declare function classifyError(text: string): DemoErrorType;
export declare function extractMessageHead(text: string): string;
export declare function maskVolatile(text: string): string;
export declare function maskSelector(selector: string): string;
export declare function extractSelector(text: string): string | null;
export declare function extractTopFrameFile(text: string): string | null;
export declare function extractErrorSignature(rawError: string): DemoErrorSignature;
export declare function computeDemoFingerprint(rawError: string): Promise<DemoErrorFingerprint>;
