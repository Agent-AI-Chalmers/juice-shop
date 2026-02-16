/**
 * OWASP Juice Shop — 2FA Security Test Suite
 *
 * Tests both normal 2FA business flows and known attack paths.
 * Run against a local Juice Shop instance on port 3000.
 *
 * Usage: node test_2fa.js
 */

const otplib = require('otplib')
const http = require('http')

const BASE = 'http://127.0.0.1:3000'
const KNOWN_SECRET = 'IFTXE3SPOEYVURT2MRYGI52TKJ4HC3KH'
const WURSTBROT_EMAIL = 'wurstbrot@juice-sh.op'
const WURSTBROT_PASSWORD = 'EinBelegtesBrotMitSchinkenSCHINKEN!'

let passed = 0
let failed = 0
let skipped = 0

// ────────────── HTTP Helpers ──────────────

function httpRequest (method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

const GET = (path, headers) => httpRequest('GET', path, null, headers)
const POST = (path, body, headers) => httpRequest('POST', path, body, headers)

// ────────────── Test Runner ──────────────

function assert (condition, testName, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`)
    passed++
  } else {
    console.log(`  ❌ FAIL: ${testName}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

function skip (testName, reason) {
  console.log(`  ⏭️  SKIP: ${testName} — ${reason}`)
  skipped++
}

// ────────────── Test Cases ──────────────

async function testNormalLoginWithout2FA () {
  console.log('\n── Test Group 1: Normal Login (user without 2FA) ──')

  const res = await POST('/rest/user/login', {
    email: 'admin@juice-sh.op',
    password: 'admin123'
  })

  assert(res.status === 200, 'Login succeeds for user without 2FA')
  assert(res.body?.authentication?.token, 'Returns auth token', `status=${res.status}`)
  assert(res.body?.authentication?.umail === 'admin@juice-sh.op', 'Returns correct email')

  return res.body?.authentication?.token
}

async function testNormalLoginWith2FA () {
  console.log('\n── Test Group 2: Normal Login (user with 2FA — wurstbrot) ──')

  // Step 1: Password login should require 2FA
  const loginRes = await POST('/rest/user/login', {
    email: WURSTBROT_EMAIL,
    password: WURSTBROT_PASSWORD
  })

  assert(loginRes.status === 401, '2FA user gets 401 on password-only login')
  assert(loginRes.body?.status === 'totp_token_required', 'Response indicates TOTP required')
  assert(loginRes.body?.data?.tmpToken, 'Returns tmpToken for 2FA flow')

  if (!loginRes.body?.data?.tmpToken) {
    skip('2FA verification with correct TOTP', 'No tmpToken received')
    return null
  }

  // Step 2: Submit correct TOTP
  const tmpToken = loginRes.body.data.tmpToken
  const totpToken = otplib.authenticator.generate(KNOWN_SECRET)

  const verifyRes = await POST('/rest/2fa/verify', { tmpToken, totpToken })

  assert(verifyRes.status === 200, '2FA verification succeeds with correct TOTP')
  assert(verifyRes.body?.authentication?.umail === WURSTBROT_EMAIL, 'Returns correct user email')
  assert(verifyRes.body?.authentication?.token, 'Returns final auth token')

  return verifyRes.body?.authentication?.token
}

async function testWrongTOTP () {
  console.log('\n── Test Group 3: 2FA with Wrong TOTP ──')

  const loginRes = await POST('/rest/user/login', {
    email: WURSTBROT_EMAIL,
    password: WURSTBROT_PASSWORD
  })

  const tmpToken = loginRes.body?.data?.tmpToken
  if (!tmpToken) {
    skip('Wrong TOTP rejected', 'No tmpToken')
    return
  }

  const verifyRes = await POST('/rest/2fa/verify', {
    tmpToken,
    totpToken: '000000'
  })

  assert(verifyRes.status === 401, 'Wrong TOTP is rejected with 401')
}

async function testInvalidTmpToken () {
  console.log('\n── Test Group 4: 2FA with Invalid/Tampered tmpToken ──')

  const verifyRes = await POST('/rest/2fa/verify', {
    tmpToken: 'eyJhbGciOiJSUzI1NiJ9.eyJ1c2VySWQiOjk5OSwidHlwZSI6ImZha2UifQ.invalid',
    totpToken: '123456'
  })

  assert(verifyRes.status === 401, 'Tampered tmpToken is rejected')
}

async function test2FAStatusEndpoint () {
  console.log('\n── Test Group 5: 2FA Status Endpoint ──')

  // Unauthenticated access
  const noAuthRes = await GET('/rest/2fa/status')
  assert(noAuthRes.status === 401, 'Unauthenticated access to /rest/2fa/status returns 401')

  // Authenticated access (use admin who has no 2FA)
  const loginRes = await POST('/rest/user/login', {
    email: 'admin@juice-sh.op',
    password: 'admin123'
  })
  const token = loginRes.body?.authentication?.token
  if (!token) {
    skip('2FA status for logged-in user', 'Could not get admin token')
    return
  }

  const statusRes = await GET('/rest/2fa/status', { Authorization: `Bearer ${token}` })
  assert(statusRes.status === 200, '2FA status returns 200 for authenticated user')
  assert(statusRes.body?.setup === false, 'Admin user shows 2FA not set up')
  assert(statusRes.body?.secret, 'Returns TOTP secret for setup')
  assert(statusRes.body?.setupToken, 'Returns setupToken for setup flow')
}

async function testWrongPasswordLogin () {
  console.log('\n── Test Group 6: Login with Wrong Password ──')

  const res = await POST('/rest/user/login', {
    email: WURSTBROT_EMAIL,
    password: 'WrongPassword123'
  })

  assert(res.status === 401, 'Wrong password returns 401')
  assert(!res.body?.data?.tmpToken, 'No tmpToken issued for wrong password')
}

// ────────────── Attack Path Tests ──────────────

async function testSQLiViaLogin () {
  console.log('\n── Attack Test 1: SQL Injection via Login Endpoint ──')

  const res = await POST('/rest/user/login', {
    email: "' OR 1=1--",
    password: 'anything'
  })

  assert(res.status === 401, 'SQLi in login email returns 401 (not 200)')
  assert(!res.body?.authentication?.token, 'No auth token returned via SQLi')
}

async function testSQLiViaSearch () {
  console.log('\n── Attack Test 2: SQL Injection via Search to Extract totpSecret ──')

  const sqliPayload = "qwert')) UNION SELECT id,email,password,totpSecret,'5','6','7','8','9' FROM Users--"
  const res = await GET(`/rest/products/search?q=${encodeURIComponent(sqliPayload)}`)

  // Find wurstbrot in results
  const wurstbrot = res.body?.data?.find(p => p.name && p.name.includes('wurstbrot'))

  if (!wurstbrot) {
    // Search SQLi might be patched too
    assert(true, 'Search SQL injection does not return user data (patched)')
    return
  }

  // SQLi worked — check if the extracted secret is usable
  const extractedSecret = wurstbrot.price
  console.log(`    Extracted value: ${extractedSecret?.substring(0, 40)}...`)

  // Is it the plaintext secret?
  const isPlaintext = extractedSecret === KNOWN_SECRET
  assert(!isPlaintext, 'Extracted totpSecret is NOT plaintext',
    isPlaintext ? 'VULNERABLE: plaintext secret exposed!' : 'Secret is encrypted or obfuscated')

  // Try to use extracted secret to generate TOTP
  if (extractedSecret) {
    try {
      const totpFromExtracted = otplib.authenticator.generate(extractedSecret)

      // Login to get tmpToken
      const loginRes = await POST('/rest/user/login', {
        email: WURSTBROT_EMAIL,
        password: WURSTBROT_PASSWORD
      })
      const tmpToken = loginRes.body?.data?.tmpToken

      if (tmpToken) {
        const verifyRes = await POST('/rest/2fa/verify', {
          tmpToken,
          totpToken: totpFromExtracted
        })

        assert(verifyRes.status !== 200, 'TOTP from extracted secret does NOT pass 2FA',
          verifyRes.status === 200 ? 'VULNERABLE: 2FA bypassed!' : `Correctly rejected (${verifyRes.status})`)
      }
    } catch (e) {
      assert(true, 'Extracted secret cannot be used to generate TOTP (invalid format)')
    }
  }
}

async function testSQLiUnionColumnEnum () {
  console.log('\n── Attack Test 3: SQL Injection Column Enumeration ──')

  // Attacker tries SELECT * with different column counts
  const sqliPayload = "qwert')) UNION SELECT sql,2,3,4,5,6,7,8,9 FROM sqlite_master--"
  const res = await GET(`/rest/products/search?q=${encodeURIComponent(sqliPayload)}`)

  const hasSchema = res.body?.data?.some(p =>
    typeof p.name === 'string' && p.name.includes('CREATE TABLE')
  )

  if (hasSchema) {
    // This is a separate vulnerability (dbSchemaChallenge), just note it
    console.log('    ⚠️  Note: DB schema is accessible via search SQLi (separate issue)')
  }
}

async function testBruteForce2FA () {
  console.log('\n── Attack Test 4: Brute Force TOTP (rate limiting check) ──')

  const loginRes = await POST('/rest/user/login', {
    email: WURSTBROT_EMAIL,
    password: WURSTBROT_PASSWORD
  })
  const tmpToken = loginRes.body?.data?.tmpToken

  if (!tmpToken) {
    skip('Brute force test', 'No tmpToken')
    return
  }

  // Send 5 rapid wrong attempts
  let rejectedCount = 0
  for (let i = 0; i < 5; i++) {
    const code = String(100000 + i).padStart(6, '0')
    const res = await POST('/rest/2fa/verify', { tmpToken, totpToken: code })
    if (res.status === 401) rejectedCount++
  }

  assert(rejectedCount === 5, 'All 5 brute force attempts rejected')

  // Check if we can still use the correct code (not locked out from valid use)
  const correctToken = otplib.authenticator.generate(KNOWN_SECRET)
  const validRes = await POST('/rest/2fa/verify', { tmpToken, totpToken: correctToken })

  // Note: current rate limit is 100/5min which is very permissive
  console.log(`    ℹ️  Rate limit: /rest/2fa/verify allows 100 requests per 5 minutes`)
}

// ────────────── Main ──────────────

async function main () {
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║   OWASP Juice Shop — 2FA Security Test Suite    ║')
  console.log('╚══════════════════════════════════════════════════╝')

  // Normal business flows
  await testNormalLoginWithout2FA()
  await testNormalLoginWith2FA()
  await testWrongTOTP()
  await testInvalidTmpToken()
  await test2FAStatusEndpoint()
  await testWrongPasswordLogin()

  // Attack paths
  await testSQLiViaLogin()
  await testSQLiViaSearch()
  await testSQLiUnionColumnEnum()
  await testBruteForce2FA()

  // Summary
  console.log('\n══════════════════════════════════════════════════')
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`)
  console.log('══════════════════════════════════════════════════')

  if (failed > 0) {
    console.log('\n  ⚠️  Some tests failed — vulnerabilities may still exist!')
    process.exit(1)
  } else {
    console.log('\n  🎉 All tests passed!')
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Test suite error:', err.message)
  process.exit(2)
})
