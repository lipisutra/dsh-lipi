/**
 * Locate a project that was deployed by lipi, without any Cordis dependency.
 * The bundle itself knows nothing about checker files: a deployed project is
 * one whose root carries `lipi.json` or the deployment lock `.agents/lipi/lipi.lock`.
 * @module @lipisutra/dsh-lipi/project
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Project settings file that marks a lipi-deployed root. */
const CONFIG_FILE = 'lipi.json'

/** Deployment lock that marks a lipi-deployed root even without settings. */
const LOCK_RELATIVE_PATH = join('.agents', 'lipi', 'lipi.lock')

/**
 * Raised when neither the start directory nor any of its ancestors carries a
 * lipi deployment marker (`lipi.json` or `.agents/lipi/lipi.lock`).
 */
export class ProjectNotDeployedError extends Error {
  /**
   * @param {string} startDir Directory the search started from.
   */
  constructor(startDir) {
    super(`проект не развёрнут по lipi: в каталоге «${startDir}» (и выше) нет lipi.json — запустите lipi init`)
    /** @type {string} */
    this.name = 'ProjectNotDeployedError'
    /** @type {string} */
    this.code = 'PROJECT_NOT_DEPLOYED'
    /** @type {string} */
    this.startDir = startDir
  }
}

/**
 * Find the closest lipi-deployed project at or above `startDir`. A root is
 * deployed when it has `lipi.json` or the lock file `.agents/lipi/lipi.lock`;
 * the bundle does not look for a checker there anymore.
 * @param {string} startDir Absolute or relative directory to start from; relative paths resolve against the process directory.
 * @returns {{root: string, config: Record<string, unknown> | null}} Project root and parsed `lipi.json`.
 * @throws {ProjectNotDeployedError} When no directory from `startDir` to the filesystem root carries a deployment marker.
 */
export function resolveProject(startDir) {
  if (typeof startDir !== 'string' || startDir.length === 0) {
    throw new TypeError('resolveProject: startDir должна быть непустой строкой')
  }
  const start = resolve(startDir)
  let directory = start
  for (;;) {
    if (existsSync(join(directory, CONFIG_FILE)) || existsSync(join(directory, LOCK_RELATIVE_PATH))) {
      return { root: directory, config: readProjectConfig(directory) }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new ProjectNotDeployedError(start)
}

/**
 * Read the optional project settings; unreadable or non-object settings are
 * reported as absent rather than failing discovery.
 * @param {string} root Project root.
 * @returns {Record<string, unknown> | null} Parsed `lipi.json`, or null.
 */
function readProjectConfig(root) {
  const file = join(root, CONFIG_FILE)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
