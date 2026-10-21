import {
  adminApiBase,
  claimsEndpoint,
  publishAccountClaims,
} from '@/lib/admin-api';

/**
 * Account creation is only "done" once Campaign HQ has published the new
 * login's claims. These tests cover the two things that decide whether that
 * call is trustworthy: the URL the app actually builds, and whether every
 * non-success answer is surfaced as a rejection the create hook can roll back
 * on. A silent success here would leave an account that signs in and then
 * fails every rules check.
 */

describe('adminApiBase', () => {
  it('returns null when the build has no configured endpoint', () => {
    expect(adminApiBase(undefined)).toBeNull();
    expect(adminApiBase('')).toBeNull();
    expect(adminApiBase('   ')).toBeNull();
  });

  it('accepts the common deployment URL shapes', () => {
    expect(adminApiBase('https://hq.example.com')).toBe('https://hq.example.com');
    expect(adminApiBase('https://hq.example.com/')).toBe('https://hq.example.com');
    expect(adminApiBase(' https://hq.example.com/// ')).toBe(
      'https://hq.example.com'
    );
  });

  it('removes an accidental /api suffix exactly once', () => {
    expect(adminApiBase('https://hq.example.com/api')).toBe(
      'https://hq.example.com'
    );
    expect(adminApiBase('https://hq.example.com/api/')).toBe(
      'https://hq.example.com'
    );
    // A path that merely ENDS in "api" is not the suffix we strip.
    expect(adminApiBase('https://hq.example.com/campaign-api')).toBe(
      'https://hq.example.com/campaign-api'
    );
  });

  it('treats a bare /api as no endpoint rather than an empty origin', () => {
    expect(adminApiBase('/api')).toBeNull();
  });

  it('builds the claims route from the origin', () => {
    expect(claimsEndpoint('https://hq.example.com')).toBe(
      'https://hq.example.com/api/account/claims'
    );
  });
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('publishAccountClaims', () => {
  it('posts the uid and the manager token, and returns the claims', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;

    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return jsonResponse({
        ok: true,
        claims: { role: 'karykarta', wardNo: 4 },
      });
    }) as typeof fetch;

    const claims = await publishAccountClaims({
      base: 'https://hq.example.com',
      token: 'manager-id-token',
      uid: 'new-uid',
      operation: 'mobile-create',
      fetchImpl: fakeFetch,
    });

    expect(claims).toEqual({ role: 'karykarta', wardNo: 4 });
    expect(seenUrl).toBe('https://hq.example.com/api/account/claims');
    expect(seenInit?.method).toBe('POST');
    expect(seenInit?.headers).toMatchObject({
      authorization: 'Bearer manager-id-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(seenInit?.body))).toEqual({
      uid: 'new-uid',
      operation: 'mobile-create',
    });
  });

  it('rejects a server refusal and keeps the request id for support', async () => {
    const fakeFetch = (async () =>
      jsonResponse(
        {
          ok: false,
          error: 'Only a super admin or developer can publish claims.',
          requestId: 'req-123',
        },
        403
      )) as typeof fetch;

    await expect(
      publishAccountClaims({
        base: 'https://hq.example.com',
        token: 'token',
        uid: 'uid',
        fetchImpl: fakeFetch,
      })
    ).rejects.toThrow(
      'Only a super admin or developer can publish claims. (ref: req-123)'
    );
  });

  it('rejects a 200 that is not an explicit ok', async () => {
    const fakeFetch = (async () => jsonResponse({ claims: {} })) as typeof fetch;

    await expect(
      publishAccountClaims({
        base: 'https://hq.example.com',
        token: 'token',
        uid: 'uid',
        fetchImpl: fakeFetch,
      })
    ).rejects.toThrow('Campaign HQ refused the activation (HTTP 200).');
  });

  it('turns an unreachable host into a rollback-able error', async () => {
    const fakeFetch = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;

    await expect(
      publishAccountClaims({
        base: 'https://hq.example.com',
        token: 'token',
        uid: 'uid',
        fetchImpl: fakeFetch,
      })
    ).rejects.toThrow('Could not reach Campaign HQ');
  });

  it('aborts a hung request instead of spinning forever', async () => {
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        );
      })) as typeof fetch;

    await expect(
      publishAccountClaims({
        base: 'https://hq.example.com',
        token: 'token',
        uid: 'uid',
        fetchImpl: hangingFetch,
        timeoutMs: 5,
      })
    ).rejects.toThrow('Campaign HQ took too long');
  });
});
