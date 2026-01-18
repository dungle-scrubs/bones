/**
 * Uses words-hurt library to compose validation prompts.
 * Direct library import avoids subprocess overhead.
 */

import { type ComposeResult, compose } from "words-hurt";

export type { ComposeResult };

/**
 * Composes a validation prompt using the words-hurt library.
 * Returns the complete prompt ready for the referee agent.
 *
 * @param verb - Action to perform (validate, plan, etc.)
 * @param noun - Subject of action (bug, doc_drift, etc.)
 * @param input - JSON input to pass to the template
 * @param cwd - Directory where .words_hurt/ exists
 */
export function composePrompt(
	verb: string,
	noun: string,
	input: Record<string, unknown>,
	cwd: string,
): ComposeResult {
	return compose([{ verb, noun }], input, { cwd });
}
