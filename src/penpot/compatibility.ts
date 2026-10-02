export const PENPOT_TESTED_VERSIONS: readonly string[] = ["2.17.2"];
/** Accept build/prerelease suffixes, but never a different patch or an arbitrary prefix. */
export function isTestedVersion(reported: string): boolean {
  const version = /^(\d+\.\d+\.\d+)(?:$|[-+])/.exec(reported)?.[1];
  return version !== undefined && PENPOT_TESTED_VERSIONS.includes(version);
}
