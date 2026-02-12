/**
 * OAuth credential management for Bones.
 * Handles Anthropic (Claude Pro/Max) login, token persistence, and refresh.
 * Credentials stored in ~/.bones/oauth.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	anthropicOAuthProvider,
	getOAuthApiKey,
	type OAuthCredentials,
} from "@mariozechner/pi-ai";

const DATA_DIR = process.env.BONES_DATA_DIR ?? join(homedir(), ".bones");
const CREDENTIALS_PATH = join(DATA_DIR, "oauth.json");

/** Stored credentials keyed by provider ID. */
type CredentialStore = Record<string, OAuthCredentials>;

/**
 * Reads saved OAuth credentials from disk.
 *
 * @returns Credential store or empty object if none saved
 */
function loadCredentials(): CredentialStore {
	if (!existsSync(CREDENTIALS_PATH)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
	} catch {
		return {};
	}
}

/**
 * Saves OAuth credentials to disk.
 * Creates ~/.bones/ if it doesn't exist.
 *
 * @param store - Credential store to persist
 */
function saveCredentials(store: CredentialStore): void {
	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(CREDENTIALS_PATH, JSON.stringify(store, null, 2), {
		mode: 0o600, // owner-only read/write
	});
}

/**
 * Runs the Anthropic OAuth login flow.
 * Opens browser for authorization, prompts for code, saves tokens.
 *
 * @param openUrl - Callback to open the auth URL (e.g., open browser)
 * @param promptCode - Callback to get the authorization code from user
 * @returns The saved credentials
 */
export async function login(
	openUrl: (url: string) => void,
	promptCode: () => Promise<string>,
): Promise<OAuthCredentials> {
	const credentials = await anthropicOAuthProvider.login({
		onAuth: (info) => openUrl(info.url),
		onPrompt: (prompt) => promptCode(),
	});

	const store = loadCredentials();
	store.anthropic = credentials;
	saveCredentials(store);

	return credentials;
}

/**
 * Gets a valid API key from saved OAuth credentials.
 * Automatically refreshes expired tokens and persists updated credentials.
 *
 * @returns OAuth access token usable as API key, or null if not logged in
 * @throws Error if token refresh fails
 */
export async function getOAuthKey(): Promise<string | null> {
	const store = loadCredentials();
	if (!store.anthropic) {
		return null;
	}

	const result = await getOAuthApiKey("anthropic", store);
	if (!result) {
		return null;
	}

	// Persist refreshed credentials
	store.anthropic = result.newCredentials;
	saveCredentials(store);

	return result.apiKey;
}

/**
 * Checks whether OAuth credentials are saved and not expired.
 *
 * @returns true if valid credentials exist
 */
export function isLoggedIn(): boolean {
	const store = loadCredentials();
	if (!store.anthropic) {
		return false;
	}
	// Check if access token is still valid (with 1 min buffer)
	return store.anthropic.expires > Date.now() + 60_000;
}

/**
 * Removes saved OAuth credentials.
 */
export function logout(): void {
	const store = loadCredentials();
	delete store.anthropic;
	saveCredentials(store);
}
