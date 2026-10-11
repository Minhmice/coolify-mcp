import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('rejects missing Coolify URL and token', () => {
  assert.throws(() => loadConfig({}), /COOLIFY_URL/);
  assert.throws(() => loadConfig({ COOLIFY_URL: '' }), /COOLIFY_URL/);
  assert.throws(() => loadConfig({ COOLIFY_URL: '   ' }), /COOLIFY_URL/);
  assert.throws(() => loadConfig({ COOLIFY_URL: 'https://coolify.example' }), /COOLIFY_TOKEN/);
  assert.throws(() => loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: '' }), /COOLIFY_TOKEN/);
  assert.throws(() => loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: '   ' }), /COOLIFY_TOKEN/);
});

test('rejects plain HTTP and normalizes API prefix', () => {
  assert.throws(() => loadConfig({ COOLIFY_URL: 'http://coolify.example', COOLIFY_TOKEN: 'x' }), /HTTPS/);
  const config = loadConfig({ COOLIFY_URL: 'https://coolify.example/', COOLIFY_TOKEN: 'x', COOLIFY_API_PREFIX: '/api/v1/' });
  assert.equal(config.baseUrl, 'https://coolify.example/');
  assert.equal(config.apiPrefix, '/api/v1');
});

test('rejects invalid URL structures: userinfo, query, hash, and non-root paths', () => {
  const token = 'valid-token';
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'https://user:pass@coolify.example', COOLIFY_TOKEN: token }),
    /userinfo/,
  );
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'https://coolify.example?query=1', COOLIFY_TOKEN: token }),
    /query/,
  );
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'https://coolify.example#hash', COOLIFY_TOKEN: token }),
    /hash|fragment/i,
  );
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'https://coolify.example/subpath', COOLIFY_TOKEN: token }),
    /path/,
  );
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'not-a-url', COOLIFY_TOKEN: token }),
    /valid URL/i,
  );
});

test('rejects tokens containing CRLF without leaking token in error message', () => {
  const secretToken = 'super-secret-123';
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: `${secretToken}\r\nmalicious` }),
    (err: Error) => {
      assert.match(err.message, /newline|carriage return/i);
      assert.ok(!err.message.includes(secretToken), 'Error message must not leak token');
      return true;
    },
  );
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: `token\n` }),
    /newline|carriage return/i,
  );
  assert.throws(
    () => loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: `token\r` }),
    /newline|carriage return/i,
  );
});

test('validates and normalizes apiPrefix', () => {
  const valid = { COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'x' };

  // Default prefix
  const defaultConfig = loadConfig(valid);
  assert.equal(defaultConfig.apiPrefix, '/api/v1');

  // Strip trailing slashes
  const trimmedSlash = loadConfig({ ...valid, COOLIFY_API_PREFIX: '/api/v2///' });
  assert.equal(trimmedSlash.apiPrefix, '/api/v2');

  // Ensure leading slash added if missing
  const addedLeading = loadConfig({ ...valid, COOLIFY_API_PREFIX: 'api/custom' });
  assert.equal(addedLeading.apiPrefix, '/api/custom');

  // Reject protocol-relative
  assert.throws(() => loadConfig({ ...valid, COOLIFY_API_PREFIX: '//evil.com/api' }), /protocol-relative/i);

  // Reject absolute URL
  assert.throws(() => loadConfig({ ...valid, COOLIFY_API_PREFIX: 'https://evil.com/api' }), /absolute/i);

  // Reject traversal
  assert.throws(() => loadConfig({ ...valid, COOLIFY_API_PREFIX: '/api/../v1' }), /traversal/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_API_PREFIX: '../v1' }), /traversal/i);
});

test('validates requestTimeoutMs bounds and defaults', () => {
  const valid = { COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'x' };

  // Default
  assert.equal(loadConfig(valid).requestTimeoutMs, 30000);

  // Valid values
  assert.equal(loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: '1' }).requestTimeoutMs, 1);
  assert.equal(loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: '60000' }).requestTimeoutMs, 60000);
  assert.equal(loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: '120000' }).requestTimeoutMs, 120000);

  // Out of bounds or invalid
  assert.throws(() => loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: '0' }), /timeout/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: '-10' }), /timeout/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: '120001' }), /timeout/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: 'abc' }), /timeout/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_REQUEST_TIMEOUT_MS: '1.5' }), /timeout/i);
});

test('validates maxLogBytes bounds and defaults', () => {
  const valid = { COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'x' };

  // Default
  assert.equal(loadConfig(valid).maxLogBytes, 65536);

  // Valid values
  assert.equal(loadConfig({ ...valid, COOLIFY_MAX_LOG_BYTES: '1' }).maxLogBytes, 1);
  assert.equal(loadConfig({ ...valid, COOLIFY_MAX_LOG_BYTES: '1048576' }).maxLogBytes, 1048576);

  // Out of bounds or invalid
  assert.throws(() => loadConfig({ ...valid, COOLIFY_MAX_LOG_BYTES: '0' }), /log/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_MAX_LOG_BYTES: '-5' }), /log/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_MAX_LOG_BYTES: '1048577' }), /log/i);
  assert.throws(() => loadConfig({ ...valid, COOLIFY_MAX_LOG_BYTES: 'invalid' }), /log/i);
});

test('normalizes baseUrl to origin with trailing slash', () => {
  const c1 = loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'x' });
  assert.equal(c1.baseUrl, 'https://coolify.example/');

  const c2 = loadConfig({ COOLIFY_URL: 'https://coolify.example/', COOLIFY_TOKEN: 'x' });
  assert.equal(c2.baseUrl, 'https://coolify.example/');

  const c3 = loadConfig({ COOLIFY_URL: 'https://coolify.example:8443', COOLIFY_TOKEN: 'x' });
  assert.equal(c3.baseUrl, 'https://coolify.example:8443/');
});

test('returns frozen object', () => {
  const config = loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'x' });
  assert.ok(Object.isFrozen(config));
  assert.throws(() => {
    // @ts-expect-error mutating frozen object
    config.baseUrl = 'https://other.example/';
  }, TypeError);
});
