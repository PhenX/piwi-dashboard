import { describe, test, expect } from 'vitest';
import {
  ENV_OUTPUT_FORMATS,
  emitDockerCompose,
  emitDockerRunBash,
  emitDockerRunPowershell,
  emitDotenv,
  emitKubernetes,
  emitPowershellEnv,
  emitShellExports,
  emitSystemd,
  quoteDotenvValue,
  quotePowershellValue,
  quoteShellValue,
  quoteYamlValue,
  type EnvEntry,
} from '#shared/env-format';

const plain = (name: string, value: string): EnvEntry => ({ name, value });
const secret = (name: string, value: string): EnvEntry => ({ name, value, secret: true });

describe('quoteDotenvValue', () => {
  test('leaves simple values unquoted', () => {
    expect(quoteDotenvValue('local')).toBe('local');
    expect(quoteDotenvValue('.data/piwi.db')).toBe('.data/piwi.db');
    expect(quoteDotenvValue('https://piwi.example.com')).toBe('https://piwi.example.com');
    expect(quoteDotenvValue('587')).toBe('587');
    expect(quoteDotenvValue('a,b,c')).toBe('a,b,c');
  });

  test('double-quotes values with spaces, hashes and quotes', () => {
    expect(quoteDotenvValue('has space')).toBe('"has space"');
    expect(quoteDotenvValue('a#b')).toBe('"a#b"');
    expect(quoteDotenvValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteDotenvValue('back\\slash')).toBe('"back\\\\slash"');
  });

  test('escapes newlines in double quotes', () => {
    expect(quoteDotenvValue('Wait for timeout*\n*waitForTimeout*')).toBe('"Wait for timeout*\\n*waitForTimeout*"');
  });

  test('single-quotes values containing $ so interpolation never rewrites them', () => {
    expect(quoteDotenvValue('pa$$word')).toBe("'pa$$word'");
  });

  test('keeps empty values empty', () => {
    expect(quoteDotenvValue('')).toBe('');
  });
});

describe('shell quoting', () => {
  test('bash single quotes with embedded quote escape', () => {
    expect(quoteShellValue('plain')).toBe("'plain'");
    expect(quoteShellValue("it's")).toBe("'it'\\''s'");
  });

  test('powershell doubles embedded single quotes', () => {
    expect(quotePowershellValue('plain')).toBe("'plain'");
    expect(quotePowershellValue("it's")).toBe("'it''s'");
  });
});

describe('quoteYamlValue', () => {
  test('always quotes so booleans and numbers stay strings', () => {
    expect(quoteYamlValue('true')).toBe("'true'");
    expect(quoteYamlValue('587')).toBe("'587'");
    expect(quoteYamlValue('0.92')).toBe("'0.92'");
  });

  test('doubles single quotes in single-quoted style', () => {
    expect(quoteYamlValue("it's")).toBe("'it''s'");
  });

  test('uses double-quoted style with escapes for control characters', () => {
    expect(quoteYamlValue('a\nb')).toBe('"a\\nb"');
    expect(quoteYamlValue('a\tb')).toBe('"a\\tb"');
  });
});

describe('emitDotenv', () => {
  test('renders entries with comments and header', () => {
    const out = emitDotenv(
      [
        { ...plain('PIWI_SITE_URL', 'https://piwi.example.com'), comment: 'Public base URL' },
        plain('PIWI_SMTP_PORT', '587'),
      ],
      { header: ['Generated locally'] },
    );
    expect(out).toBe(
      '# Generated locally\n\n# Public base URL\nPIWI_SITE_URL=https://piwi.example.com\nPIWI_SMTP_PORT=587\n',
    );
  });
});

describe('emitShellExports / emitPowershellEnv', () => {
  test('bash exports', () => {
    expect(emitShellExports([plain('PIWI_AUTH_ENABLED', 'true')])).toBe("export PIWI_AUTH_ENABLED='true'\n");
  });

  test('powershell env assignments', () => {
    expect(emitPowershellEnv([plain('PIWI_AUTH_ENABLED', 'true')])).toBe("$env:PIWI_AUTH_ENABLED = 'true'\n");
  });
});

describe('docker run emitters', () => {
  const entries = [plain('PIWI_AUTH_ENABLED', 'true'), secret('PIWI_AUTH_SECRET', "s3cr'et")];

  test('bash form uses backslash continuations and single quotes', () => {
    const out = emitDockerRunBash(entries);
    expect(out).toContain('docker run -d --name piwi \\');
    expect(out).toContain("  -e PIWI_AUTH_ENABLED='true' \\");
    expect(out).toContain("  -e PIWI_AUTH_SECRET='s3cr'\\''et' \\");
    expect(out.trimEnd().endsWith('phenx/piwitests-server:latest')).toBe(true);
  });

  test('powershell form uses backtick continuations and doubled quotes', () => {
    const out = emitDockerRunPowershell(entries);
    expect(out).toContain('docker run -d --name piwi `');
    expect(out).toContain("  -e PIWI_AUTH_SECRET='s3cr''et' `");
    expect(out).toContain('-v "${PWD}/.data:/app/.data" `');
  });

  test('honors a custom image', () => {
    expect(emitDockerRunBash(entries, { image: 'piwi-dashboard:local' })).toContain('piwi-dashboard:local');
  });
});

describe('emitDockerCompose', () => {
  test('quotes every value and keeps the canonical service shape', () => {
    const out = emitDockerCompose([plain('PIWI_SMTP_PORT', '587'), plain('PIWI_AUTH_ENABLED', 'true')]);
    expect(out).toContain('image: phenx/piwitests-server:latest');
    expect(out).toContain("      PIWI_SMTP_PORT: '587'");
    expect(out).toContain("      PIWI_AUTH_ENABLED: 'true'");
    expect(out).toContain('- ./.data:/app/.data');
  });

  test('renders an empty environment map when no entries', () => {
    expect(emitDockerCompose([])).toContain('environment:\n      {}');
  });
});

describe('emitKubernetes', () => {
  test('splits secrets into a Secret and references both', () => {
    const out = emitKubernetes([plain('PIWI_AUTH_ENABLED', 'true'), secret('PIWI_AUTH_SECRET', 'abc')]);
    const docs = out.split('\n---\n');
    expect(docs[0]).toContain('kind: ConfigMap');
    expect(docs[0]).toContain("  PIWI_AUTH_ENABLED: 'true'");
    expect(docs[0]).not.toContain('PIWI_AUTH_SECRET');
    expect(docs[1]).toContain('kind: Secret');
    expect(docs[1]).toContain('stringData:');
    expect(docs[1]).toContain("  PIWI_AUTH_SECRET: 'abc'");
    expect(out).toContain('secretRef:');
  });

  test('omits the Secret document when nothing is secret', () => {
    const out = emitKubernetes([plain('PIWI_SITE_URL', 'https://x.example')]);
    expect(out).not.toContain('kind: Secret');
    expect(out).not.toContain('secretRef:');
    expect(out).toContain('configMapRef:');
  });
});

describe('emitSystemd', () => {
  test('includes usage instructions and dotenv-style lines', () => {
    const out = emitSystemd([plain('PIWI_SITE_URL', 'https://piwi.example.com')]);
    expect(out).toContain('EnvironmentFile=/etc/piwi/piwi.env');
    expect(out).toContain('PIWI_SITE_URL=https://piwi.example.com');
  });
});

describe('ENV_OUTPUT_FORMATS', () => {
  test('ids are unique and every format emits the variable name', () => {
    const ids = ENV_OUTPUT_FORMATS.map((format) => format.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const format of ENV_OUTPUT_FORMATS) {
      const out = format.emit([plain('PIWI_SITE_URL', 'https://piwi.example.com')]);
      expect(out, format.id).toContain('PIWI_SITE_URL');
      expect(format.filename.length).toBeGreaterThan(0);
      expect(format.label.length).toBeGreaterThan(0);
    }
  });
});
