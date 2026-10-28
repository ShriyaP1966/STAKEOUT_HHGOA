/** Startup problem with a message meant for a human (missing file, wrong chain, missing role). */
export class VerifierStartupError extends Error {}

/** Thrown where real decisions need Person 1's graph analysis or the agreed rules.json. */
export class NotImplementedError extends Error {}

export const NOT_IMPLEMENTED_MESSAGE = "not implemented: waiting for Person 1 graph analysis / agreed rules.json";
