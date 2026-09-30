import pkg from "../../package.json" with { type: "json" };

/** Heron version, read from package.json. */
export const HERON_VERSION: string = pkg.version;
