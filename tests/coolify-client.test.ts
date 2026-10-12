import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { CoolifyClient } from '../src/coolify/client.js';
import { CoolifyError } from '../src/coolify/errors.js';
import { redactSecrets, limitText } from '../src/coolify/redaction.js';

function createTestConfig(overrides?: Record<string, string>) {
  return loadConfig({
    COOLIFY_URL: 'https://coolify.example',
    COOLIFY_TOKEN: 'secret-coolify-token',
    ...overrides,
  });
}

test('CoolifyClient - sends bearer auth and accept header', async () => {
  const calls: Request[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return Response.json({ uuid: 'app-1', status: 'running' });
  };

  const client = new CoolifyClient(createTestConfig(), fetchStub);
  const result = await client.request('GET', '/applications/app-1');

  assert.deepEqual(result, { uuid: 'app-1', status: 'running' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://coolify.example/api/v1/applications/app-1');
  assert.equal(calls[0]?.headers.get('authorization'), 'Bearer secret-coolify-token');
  assert.equal(calls[0]?.headers.get('accept'), 'application/json');
  assert.equal(calls[0]?.headers.has('content-type'), false);
});

test('CoolifyClient - serializes query parameters correctly', async () => {
  let requestedUrl = '';
  const fetchStub: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json([]);
  };

  const client = new CoolifyClient(createTestConfig(), fetchStub);
  await client.request('GET', '/projects', {
    query: {
      page: 2,
      active: true,
      filter: 'alpha beta',
    },
  });

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.pathname, '/api/v1/projects');
  assert.equal(parsed.searchParams.get('page'), '2');
  assert.equal(parsed.searchParams.get('active'), 'true');
  assert.equal(parsed.searchParams.get('filter'), 'alpha beta');
});

test('CoolifyClient - serializes JSON body and sets content-type', async () => {
  let capturedRequest: Request | undefined;
  const fetchStub: typeof fetch = async (input, init) => {
    capturedRequest = new Request(input, init);
    return Response.json({ created: true });
  };
  const client = new CoolifyClient(createTestConfig(), fetchStub);
  const bodyPayload = { name: 'my-app', description: 'test' };
  const res = await client.request('POST', '/applications', { body: bodyPayload });

  assert.deepEqual(res, { created: true });
  const req = capturedRequest as Request;
  assert.ok(req);
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.get('content-type'), 'application/json');
  const bodyJson = await req.json();
  assert.deepEqual(bodyJson, bodyPayload);
});

test('CoolifyClient - handles 204 No Content returning undefined', async () => {
  const fetchStub: typeof fetch = async () => {
    return new Response(null, { status: 204, statusText: 'No Content' });
  };

  const client = new CoolifyClient(createTestConfig(), fetchStub);
  const result = await client.request('DELETE', '/applications/app-1');
  assert.equal(result, undefined);
});

test('CoolifyClient - rejects path traversal and origin tampering', async () => {
  const client = new CoolifyClient(createTestConfig(), async () => Response.json({}));

  await assert.rejects(
    () => client.request('GET', '../secret'),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'validation');
      return true;
    },
  );

  await assert.rejects(
    () => client.request('GET', '/../secret'),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'validation');
      return true;
    },
  );

  await assert.rejects(
    () => client.request('GET', 'https://evil.example/api/v1/applications'),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'validation');
      return true;
    },
  );

  await assert.rejects(
    () => client.request('GET', '//evil.example/api/v1/applications'),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'validation');
      return true;
    },
  );
});

test('CoolifyClient - passes redirect error and rejects redirected responses', async () => {
  let capturedInit: RequestInit | undefined;
  const redirectStub: typeof fetch = async (_input, init) => {
    capturedInit = init;
    throw new TypeError('Failed to fetch (redirect encountered)');
  };

  const client = new CoolifyClient(createTestConfig(), redirectStub);

  await assert.rejects(
    () => client.request('GET', '/applications'),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'network');
      return true;
    },
  );

  assert.equal(capturedInit?.redirect, 'error');
});

test('CoolifyClient - rejects oversized responses via Content-Length header', async () => {
  const fetchStub: typeof fetch = async () => {
    return new Response('{"a":1}', {
      headers: { 'content-length': '2000000' },
    });
  };

  const client = new CoolifyClient(createTestConfig(), fetchStub);

  await assert.rejects(
    () => client.request('GET', '/large', { maxBytes: 1000 }),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'oversized');
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test('CoolifyClient - rejects oversized responses via chunked streaming without Content-Length', async () => {
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('chunk-one-'));
      controller.enqueue(encoder.encode('chunk-two-'));
      controller.enqueue(encoder.encode('chunk-three-exceeds-limit'));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  const fetchStub: typeof fetch = async () => {
    return new Response(stream, {
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = new CoolifyClient(createTestConfig(), fetchStub);

  await assert.rejects(
    () => client.request('GET', '/stream', { maxBytes: 15 }),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'oversized');
      assert.equal(err.retryable, false);
      return true;
    },
  );

  assert.equal(cancelled, true);
});

test('CoolifyClient - enforces request timeout', async () => {
  const hangingFetch: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    const { promise, reject } = Promise.withResolvers<Response>();
    signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    });
    return promise;
  };

  const config = createTestConfig({ COOLIFY_REQUEST_TIMEOUT_MS: '20' });
  const client = new CoolifyClient(config, hangingFetch);

  await assert.rejects(
    () => client.request('GET', '/slow'),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'timeout');
      assert.equal(err.retryable, true);
      return true;
    },
  );
});

test('CoolifyClient - respects caller-provided abort signal', async () => {
  const hangingFetch: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    const { promise, reject } = Promise.withResolvers<Response>();
    signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted by caller', 'AbortError'));
    });
    return promise;
  };

  const client = new CoolifyClient(createTestConfig(), hangingFetch);
  const controller = new AbortController();

  const promise = client.request('GET', '/slow', { signal: controller.signal });
  controller.abort();

  await assert.rejects(
    promise,
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.kind, 'timeout');
      return true;
    },
  );
});

test('CoolifyClient - maps HTTP error statuses to expected kinds and retryability', async () => {
  const cases: Array<{
    status: number;
    kind: CoolifyError['kind'];
    retryable: boolean;
  }> = [
      { status: 400, kind: 'validation', retryable: false },
      { status: 401, kind: 'auth', retryable: false },
      { status: 403, kind: 'auth', retryable: false },
      { status: 404, kind: 'not_found', retryable: false },
      { status: 409, kind: 'conflict', retryable: false },
      { status: 422, kind: 'validation', retryable: false },
      { status: 429, kind: 'rate_limited', retryable: true },
      { status: 500, kind: 'server_error', retryable: true },
      { status: 502, kind: 'server_error', retryable: true },
      { status: 503, kind: 'server_error', retryable: true },
    ];

  for (const c of cases) {
    const fetchStub: typeof fetch = async () => {
      return new Response(JSON.stringify({ message: `Error code ${c.status}` }), {
        status: c.status,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new CoolifyClient(createTestConfig(), fetchStub);

    await assert.rejects(
      () => client.request('GET', `/error-${c.status}`),
      (err: unknown) => {
        assert.ok(err instanceof CoolifyError, `Expected CoolifyError for status ${c.status}`);
        assert.equal(err.status, c.status);
        assert.equal(err.kind, c.kind, `Mismatch kind for status ${c.status}`);
        assert.equal(err.retryable, c.retryable, `Mismatch retryable for status ${c.status}`);
        return true;
      },
    );
  }
});

test('CoolifyClient - extracts and validates Retry-After header on 429', async () => {
  const testRetryHeader = async (headerVal: string | null): Promise<string | undefined> => {
    const fetchStub: typeof fetch = async () => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (headerVal !== null) {
        headers['retry-after'] = headerVal;
      }
      return new Response(JSON.stringify({ message: 'Rate limited' }), {
        status: 429,
        headers,
      });
    };
    const client = new CoolifyClient(createTestConfig(), fetchStub);
    try {
      await client.request('GET', '/rate-limited');
      assert.fail('Should have thrown');
    } catch (err: unknown) {
      assert.ok(err instanceof CoolifyError);
      return err.retryAfter;
    }
  };

  // Valid numeric seconds
  assert.equal(await testRetryHeader('120'), '120');

  // Valid HTTP date
  const dateStr = 'Wed, 21 Oct 2026 07:28:00 GMT';
  assert.equal(await testRetryHeader(dateStr), dateStr);

  // Missing header
  assert.equal(await testRetryHeader(null), undefined);

  // Invalid garbage string
  assert.equal(await testRetryHeader('invalid-seconds-value'), undefined);
});

test('CoolifyClient - handles malformed JSON responses safely without crash', async () => {
  const fetchStub: typeof fetch = async () => {
    return new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
  };

  const client = new CoolifyClient(createTestConfig(), fetchStub);
  await assert.rejects(
    () => client.request('GET', '/bad-gateway'),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      assert.equal(err.status, 502);
      assert.equal(err.kind, 'server_error');
      return true;
    },
  );
});

test('CoolifyClient - scrubs credentials and secretValues from error messages and details', async () => {
  const secretPassword = 'my-super-secret-password-xyz';
  const fetchStub: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        message: `Failed auth with Bearer secret-coolify-token and pwd ${secretPassword}`,
        details: { token: 'secret-coolify-token', password: secretPassword, normal: 'ok' },
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
  };

  const client = new CoolifyClient(createTestConfig(), fetchStub);

  await assert.rejects(
    () => client.request('POST', '/login', { secretValues: [secretPassword] }),
    (err: unknown) => {
      assert.ok(err instanceof CoolifyError);
      const str = `${err.message} ${JSON.stringify(err.details)}`;
      assert.equal(str.includes('secret-coolify-token'), false);
      assert.equal(str.includes(secretPassword), false);
      assert.ok(str.includes('[REDACTED]'));
      return true;
    },
  );
});

test('redactSecrets - recursively redacts secret keys matching pattern', () => {
  const input = {
    appName: 'app-production',
    token: 'token-val-123',
    apiKey: 'api-key-val-456',
    password: 'password-secret',
    private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    auth_secret: 'auth-secret-val',
    credential_id: 'cred-123',
    nested: {
      user_password: 'pass',
      safe_data: 'ok',
    },
  };

  const redacted = redactSecrets(input) as Record<string, unknown>;
  assert.equal(redacted.appName, 'app-production');
  assert.equal(redacted.token, '[REDACTED]');
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.password, '[REDACTED]');
  assert.equal(redacted.private_key, '[REDACTED]');
  assert.equal(redacted.auth_secret, '[REDACTED]');
  assert.equal(redacted.credential_id, '[REDACTED]');
  const nested = redacted.nested as Record<string, unknown>;
  assert.equal(nested.user_password, '[REDACTED]');
  assert.equal(nested.safe_data, 'ok');
});

test('redactSecrets - redacts env var value/real_value while preserving key name', () => {
  const input = [
    { uuid: 'env_1', key: 'CUSTOM_CONFIG', value: 'secret-val-1', real_value: 'secret-val-1', is_preview: false },
    { uuid: 'env_2', key: 'DATABASE_PASSWORD', value: 'db-pass', real_value: 'db-pass', is_preview: false },
  ];

  const redacted = redactSecrets(input) as Array<Record<string, unknown>>;
  assert.equal(redacted[0]?.key, 'CUSTOM_CONFIG');
  assert.equal(redacted[0]?.value, '[REDACTED]');
  assert.equal(redacted[0]?.real_value, '[REDACTED]');
  assert.equal(redacted[0]?.is_preview, false);

  assert.equal(redacted[1]?.key, 'DATABASE_PASSWORD');
  assert.equal(redacted[1]?.value, '[REDACTED]');
  assert.equal(redacted[1]?.real_value, '[REDACTED]');
  assert.equal(JSON.stringify(redacted).includes('secret-val-1'), false);
  assert.equal(JSON.stringify(redacted).includes('db-pass'), false);
});

test('redactSecrets - redacts raw Compose content fields', () => {
  const input = {
    uuid: 'svc-1',
    name: 'wordpress',
    docker_compose: 'services:\n  db:\n    image: mysql',
    docker_compose_raw: 'services:\n  db:\n    image: mysql',
    compose: 'services:\n  web:\n    image: nginx',
  };

  const redacted = redactSecrets(input) as Record<string, unknown>;
  assert.equal(redacted.uuid, 'svc-1');
  assert.equal(redacted.name, 'wordpress');
  assert.equal(redacted.docker_compose, '[REDACTED]');
  assert.equal(redacted.docker_compose_raw, '[REDACTED]');
  assert.equal(redacted.compose, '[REDACTED]');
});

test('redactSecrets - scrubs Bearer tokens and knownSecrets from strings anywhere in data', () => {
  const secretA = 'secret-uuid-token-xyz';
  const secretB = 'another-secret-token';
  const input = {
    description: 'Service started with Bearer eyJhbGciOiJIUzI1NiJ9.test and config secret-uuid-token-xyz',
    logLines: [
      'Connected using Bearer abcdef1234567890',
      'Value matches another-secret-token here',
    ],
  };

  const redacted = redactSecrets(input, [secretA, secretB]) as typeof input;
  assert.equal(redacted.description.includes('eyJhbGciOiJIUzI1NiJ9.test'), false);
  assert.equal(redacted.description.includes(secretA), false);
  assert.ok(redacted.description.includes('Bearer [REDACTED]'));
  assert.ok(redacted.description.includes('[REDACTED]'));

  assert.equal(redacted.logLines[0]?.includes('abcdef1234567890'), false);
  assert.ok(redacted.logLines[0]?.includes('Bearer [REDACTED]'));
  assert.equal(redacted.logLines[1]?.includes(secretB), false);
  assert.ok(redacted.logLines[1]?.includes('[REDACTED]'));
});

test('limitText - returns untruncated result when within maxBytes', () => {
  const res = limitText('hello world', 100);
  assert.equal(res.text, 'hello world');
  assert.equal(res.truncated, false);
});

test('limitText - clips cleanly at multi-byte UTF-8 boundaries without replacement characters', () => {
  // '€' is 3 bytes (0xE2, 0x82, 0xAC)
  // 'a€b': 1 + 3 + 1 = 5 bytes
  const text = 'a€b';
  // maxBytes 3 can only fit 'a' (1 byte) because '€' takes 3 bytes (1+3=4 > 3)
  const res = limitText(text, 3);
  assert.equal(res.text, 'a');
  assert.equal(res.truncated, true);
  assert.equal(Buffer.byteLength(res.text, 'utf8') <= 3, true);

  // maxBytes 4 fits 'a€' (4 bytes)
  const res4 = limitText(text, 4);
  assert.equal(res4.text, 'a€');
  assert.equal(res4.truncated, true);
  assert.equal(Buffer.byteLength(res4.text, 'utf8'), 4);
});

test('limitText - handles emoji (4-byte UTF-8) and edge cases', () => {
  // 🚀 is 4 bytes
  const text = '🚀 rocket';
  const res3 = limitText(text, 3);
  assert.equal(res3.text, '');
  assert.equal(res3.truncated, true);

  const res4 = limitText(text, 4);
  assert.equal(res4.text, '🚀');
  assert.equal(res4.truncated, true);

  const res0 = limitText(text, 0);
  assert.equal(res0.text, '');
  assert.equal(res0.truncated, true);

  const emptyRes = limitText('', 10);
  assert.equal(emptyRes.text, '');
  assert.equal(emptyRes.truncated, false);
});
