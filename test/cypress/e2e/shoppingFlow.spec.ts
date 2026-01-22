describe('Shopping Flow', () => {
  beforeEach(() => {
    cy.login({ email: 'admin', password: 'admin123' })
    cy.visit('/#/')
  })

  describe('Product Browsing', () => {
    it('should display products on the main page', () => {
      cy.get('mat-grid-tile').should('have.length.at.least', 1)
    })

    it('should show product details when clicking on a product', () => {
      cy.get('mat-grid-tile').first().within(() => {
        cy.get('.product').click()
      })
      cy.get('mat-dialog-container').should('be.visible')
      cy.get('button[aria-label="Close Dialog"]').click()
    })
  })

  describe('Search Functionality', () => {
    it('should search for products using search bar', () => {
      cy.get('#searchQuery').click()
      cy.get('app-mat-search-bar input').type('apple').type('{enter}')
      cy.wait(500)
      cy.get('mat-grid-tile').should('have.length.at.least', 1)
    })

    it('should show empty results for non-existent products', () => {
      cy.get('#searchQuery').click()
      cy.get('app-mat-search-bar input')
        .type('nonexistentproduct12345')
        .type('{enter}')
      cy.wait(500)
      cy.get('.emptyState').should('be.visible')
    })
  })

  describe('Add to Basket', () => {
    it('should add a product to the basket', () => {
      cy.get('mat-grid-tile').first().within(() => {
        cy.get('button[aria-label="Add to Basket"]').click()
      })
      cy.wait(500)
      cy.get('button[aria-label="Show the shopping cart"]').click()
      cy.url().should('include', '/#/basket')
      cy.get('mat-row').should('have.length.at.least', 1)
    })

    it('should update basket counter correctly when removing and adding products', () => {
      cy.visit('/#/basket')
      cy.get('mat-row').should('have.length.at.least', 1)
      
      cy.get('button[aria-label="Show the shopping cart"] .fa-layers-counter')
        .invoke('text')
        .then((initialText) => {
          const initialCount = parseInt(initialText)
          
          cy.get('mat-cell.mat-column-remove button').first().click()
          cy.wait(1000)
          cy.get('button[aria-label="Show the shopping cart"] .fa-layers-counter')
            .invoke('text')
            .then((afterRemoveText) => {
              const afterRemoveCount = parseInt(afterRemoveText)
              const removedQuantity = initialCount - afterRemoveCount
              expect(removedQuantity).to.be.greaterThan(0)
              
              cy.visit('/#/')
              cy.get('mat-grid-tile').first().within(() => {
                cy.get('button[aria-label="Add to Basket"]').click()
              })
              cy.wait(1000)
              cy.get('button[aria-label="Show the shopping cart"] .fa-layers-counter')
                .invoke('text')
                .then((afterAddText) => {
                  const afterAddCount = parseInt(afterAddText)
                  expect(afterAddCount).to.equal(afterRemoveCount + 1)
                })
            })
        })
    })
  })
})
