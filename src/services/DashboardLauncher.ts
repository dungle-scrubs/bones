import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = join(__dirname, "..", "..", "apps", "dashboard");
const SKILL_DIR = join(__dirname, "..", "..");
const DASHBOARD_PORT = 3019;
const API_PORT = 8019;

/**
 * Checks if a TCP port is accepting connections.
 * Uses a brief connection attempt with timeout.
 */
function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: "127.0.0.1" });
		socket.setTimeout(500);

		socket.on("connect", () => {
			socket.destroy();
			resolve(true);
		});

		socket.on("timeout", () => {
			socket.destroy();
			resolve(false);
		});

		socket.on("error", () => {
			socket.destroy();
			resolve(false);
		});
	});
}

/**
 * Polls until a port becomes available or timeout is reached.
 * Used after spawning servers to wait for them to be ready.
 */
async function waitForPort(
	port: number,
	maxWaitMs: number = 10000,
): Promise<boolean> {
	const startTime = Date.now();
	while (Date.now() - startTime < maxWaitMs) {
		if (await isPortInUse(port)) {
			return true;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

/**
 * Starts the API server as a detached background process if not already running.
 * Returns whether a new process was started (false if already running).
 */
async function ensureApiServerRunning(): Promise<{ started: boolean }> {
	// Check if already running
	if (await isPortInUse(API_PORT)) {
		return { started: false };
	}

	// Start API server in background
	const child = spawn("node", ["dist/server.js"], {
		cwd: SKILL_DIR,
		detached: true,
		stdio: "ignore",
		env: { ...process.env, BONES_PORT: String(API_PORT) },
	});

	child.unref();

	const success = await waitForPort(API_PORT);
	return { started: success };
}

/**
 * Starts the Next.js dashboard frontend as a detached background process.
 * Returns whether a new process was started (false if already running).
 */
async function ensureFrontendRunning(): Promise<{ started: boolean }> {
	// Check if already running
	if (await isPortInUse(DASHBOARD_PORT)) {
		return { started: false };
	}

	// Start dashboard frontend in background
	const child = spawn("pnpm", ["dev"], {
		cwd: DASHBOARD_DIR,
		detached: true,
		stdio: "ignore",
	});

	child.unref();

	const success = await waitForPort(DASHBOARD_PORT);
	return { started: success };
}

/**
 * Ensures both API server and dashboard frontend are running.
 * Starts them in parallel if not already running.
 * Called by --web flag to enable web interface.
 */
export async function ensureDashboardRunning(): Promise<{
	started: boolean;
	url: string;
	api: { started: boolean; url: string };
	frontend: { started: boolean; url: string };
}> {
	// Start both API server and frontend
	const [api, frontend] = await Promise.all([
		ensureApiServerRunning(),
		ensureFrontendRunning(),
	]);

	const apiUrl = `http://localhost:${API_PORT}`;
	const frontendUrl = `http://localhost:${DASHBOARD_PORT}`;

	return {
		started: api.started || frontend.started,
		url: frontendUrl,
		api: { started: api.started, url: apiUrl },
		frontend: { started: frontend.started, url: frontendUrl },
	};
}

/** Returns the dashboard URL for a specific game. */
export function getDashboardUrl(gameId: string): string {
	return `http://localhost:${DASHBOARD_PORT}/game/${gameId}`;
}
