describe('Normal User Flow', () => {
  const testUser = {
    email: `testuser${Date.now()}@test.com`,
    password: 'TestPassword123!',
    securityQuestion: 'Your eldest siblings middle name?',
    securityAnswer: 'TestAnswer'
  }

  describe('User Registration Flow', () => {
    it('should allow a new user to register successfully', () => {
      cy.visit('/#/register')
      cy.get('#emailControl').type(testUser.email)
      cy.get('#passwordControl').type(testUser.password)
      cy.get('#repeatPasswordControl').type(testUser.password)
      cy.get('mat-select[name="securityQuestion"]').click()
      cy.get('mat-option').contains(testUser.securityQuestion).click()
      cy.get('#securityAnswerControl').type(testUser.securityAnswer)
      cy.get('#registerButton').click()
      cy.url().should('include', '/#/login')
    })
  })

  describe('User Login Flow', () => {
    beforeEach(() => {
      cy.visit('/#/login')
    })

    it('should allow registered user to login with valid credentials', () => {
      cy.get('#email').type('admin@juice-sh.op')
      cy.get('#password').type('admin123')
      cy.get('#loginButton').click()
      cy.wait(1000)
      cy.get('button[aria-label="Show/hide account menu"]').should('exist')
    })

    it('should show error message for invalid credentials', () => {
      cy.get('#email').type('invalid@test.com')
      cy.get('#password').type('wrongpassword')
      cy.get('#loginButton').click()
      cy.get('.error').should('be.visible')
    })

    it('should disable login button for empty credentials', () => {
      cy.get('#loginButton').should('be.disabled')
    })
  })

  describe('User Logout Flow', () => {
    beforeEach(() => {
      cy.login({ email: 'admin', password: 'admin123' })
    })

    it('should allow logged-in user to logout', () => {
      cy.visit('/#/')
      cy.get('button[aria-label="Show/hide account menu"]').click()
      cy.get('#navbarLogoutButton').click()
      cy.wait(1000)
      cy.get('button[aria-label="Show/hide account menu"]').click()
      cy.get('#navbarLoginButton').should('be.visible')
    })
  })
})
