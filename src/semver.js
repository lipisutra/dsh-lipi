/**
 * Minimal dependency-free semver comparison. Only numeric `major.minor.patch`
 * segments are compared; prerelease and build metadata are ignored.
 * @module @lipisutra/dsh-lipi/semver
 */

/**
 * Parse `X.Y.Z` into `[major, minor, patch]`, or null when malformed.
 * @param {string} version Version string.
 * @returns {[number, number, number] | null} Numeric segments or null.
 */
export function parseSemver(version) {
  if (typeof version !== 'string') return null
  const core = version.trim().split('-')[0].split('+')[0]
  const parts = core.split('.')
  if (parts.length !== 3) return null
  const nums = parts.map((part) => Number(part))
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null
  return nums
}

/**
 * Compare two versions: -1, 0, or 1. Invalid input compares as 0.
 * @param {string} a Left version.
 * @param {string} b Right version.
 * @returns {number} -1, 0, or 1.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === null || pb === null) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/**
 * `a >= b` by numeric segments; false when either side is malformed.
 * @param {string} a Left version.
 * @param {string} b Right version.
 * @returns {boolean} Whether `a` is at least `b`.
 */
export function gte(a, b) {
  if (parseSemver(a) === null || parseSemver(b) === null) return false
  return compareSemver(a, b) >= 0
}

/**
 * `version < min` by numeric segments; false when either side is malformed.
 * @param {string} version Version to test.
 * @param {string} min Minimum acceptable version.
 * @returns {boolean} Whether `version` is older than `min`.
 */
export function isOlder(version, min) {
  if (parseSemver(version) === null || parseSemver(min) === null) return false
  return compareSemver(version, min) < 0
}
