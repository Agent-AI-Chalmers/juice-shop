



const validateIfDependencyCheckerIsInstalled = async () => {
  try {
    // @ts-expect-error FIXME due to non-existing type definitions for check-dependencies
    await import('check-dependencies')
  } catch (err) {
    console.error('Please run "npm install" before starting the application!')
    process.exit(1)
  }
}

export default validateIfDependencyCheckerIsInstalled
