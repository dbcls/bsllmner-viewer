/** Replaced at build time with the value of BSLLMNER_VIEWER_COMMIT (see vite.config.ts). */
declare const __BSLLMNER_VIEWER_COMMIT__: string

/** The commit that the frontend was built from, or null if the build was not given one. */
export const buildCommit = (value: string = __BSLLMNER_VIEWER_COMMIT__): string | null => {
  const commit = value.trim()
  return commit === "" ? null : commit
}
