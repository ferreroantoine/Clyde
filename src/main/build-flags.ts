declare const __ATELIER_DISTRIBUTION__: boolean | undefined

/** Set at build time with ATELIER_DISTRIBUTION=1. Distribution builds only allow API-key profiles. */
export const DISTRIBUTION = typeof __ATELIER_DISTRIBUTION__ === 'boolean' ? __ATELIER_DISTRIBUTION__ : false
