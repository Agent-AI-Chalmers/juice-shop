import * as frisby from 'frisby'

import * as security from '../../lib/insecurity'

const API_URL = 'http://localhost:3000/api'

const authHeader = { Authorization: 'Bearer ' + security.authorize(), 'content-type': 'application/json' }

describe('White-box vulnerability verification: API-only XSS', () => {
  it('should successfully inject and return a payload containing <iframe...>', () => {
    return frisby.post(API_URL + '/Products', {
      headers: authHeader,
      body: {
        name: 'XSS Juice (42ml)',
        description: '<iframe src="javascript:alert(`xss`)">',
        price: 9999.99,
        image: 'xss3juice.jpg'
      }
    })

      .expect('status', 201)
      .expect('json', 'data', { description: '<iframe src="javascript:alert(`xss`)">' })
  })
})
