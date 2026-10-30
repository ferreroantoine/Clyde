declare const __CLYDE_DISTRIBUTION__: boolean | undefined

/** Set at build time with CLYDE_DISTRIBUTION=1. Distribution builds only allow API-key profiles. */
export const DISTRIBUTION = typeof __CLYDE_DISTRIBUTION__ === 'boolean' ? __CLYDE_DISTRIBUTION__ : false
