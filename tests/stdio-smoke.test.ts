import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ENTRYPOINT_PATH = fileURLToPath(new URL('../dist/index.js', import.meta.url));


test('stdio smoke: initializes, lists exactly 42 tools, and enforces confirmation on destructive tool', async () => {
  const stderrChunks: Buffer[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRYPOINT_PATH],
    env: {
      COOLIFY_URL: 'https://coolify.example.com',
      COOLIFY_TOKEN: 'synthetic-token-secret-12345',
    },
    stderr: 'pipe',
  });

  if (transport.stderr) {
    transport.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
  }

  const client = new Client({ name: 'smoke-test-client', version: '1.0.0' });

  try {
    await client.connect(transport);

    // 1. tools/list returns exactly 42 tools
    const listRes = await client.listTools();
    assert.equal(listRes.tools.length, 42);

    // 2. destructive tool call with mismatched confirmation fails safely before any network call
    const deleteRes = await client.callTool({
      name: 'coolify_delete_application',
      arguments: {
        resourceUuid: 'app-target-uuid-1',
        confirmResourceUuid: 'app-mismatched-uuid-2',
      },
    });

    assert.equal(deleteRes.isError, true);
    const content = deleteRes.content;
    const firstBlock = Array.isArray(content) ? content[0] : undefined;
    const text = firstBlock && typeof firstBlock === 'object' && 'text' in firstBlock && typeof firstBlock.text === 'string'
      ? firstBlock.text
      : '';
    assert.match(text, /Resource confirmation does not match/);

    // 3. Stderr did not leak token
    const stderrOutput = Buffer.concat(stderrChunks).toString('utf8');
    assert.equal(stderrOutput.includes('synthetic-token-secret-12345'), false);
  } finally {
    await client.close();
  }
});

test('stdio smoke: invalid config causes process to exit non-zero and prints to stderr without leaking secrets', async () => {
  const secretToken = 'super-secret-token-do-not-leak-999';

  const child = spawn(process.execPath, [ENTRYPOINT_PATH], {
    env: {
      ...process.env,
      COOLIFY_URL: '', // missing URL
      COOLIFY_TOKEN: secretToken,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  assert.notEqual(exitCode, 0);
  assert.equal(stdout, '', 'stdout must be empty on startup configuration failure');
  assert.match(stderr, /COOLIFY_URL is required/i);
  assert.equal(stderr.includes(secretToken), false, 'stderr must never contain secret token');
});

test('stdio smoke: invalid URL protocol exits non-zero and logs to stderr without stdout pollution', async () => {
  const secretToken = 'another-sensitive-token-888';

  const child = spawn(process.execPath, [ENTRYPOINT_PATH], {
    env: {
      ...process.env,
      COOLIFY_URL: 'http://insecure.example.com',
      COOLIFY_TOKEN: secretToken,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
  child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  assert.notEqual(exitCode, 0);
  assert.equal(stdout, '', 'stdout must be empty on invalid URL protocol failure');
  assert.match(stderr, /HTTPS/i);
  assert.equal(stderr.includes(secretToken), false, 'stderr must never contain secret token');
});
