/**
 * Convex fails an action that was in flight when its WebSocket dropped, for
 * example when a phone puts the page in the background. GitHub loads are
 * reads, so they are safe to send again once the connection is back.
 */
const CONNECTION_LOST = "Connection lost while action was in flight";
const MAX_RECONNECT_RETRIES = 2;
const CONNECTION_WAIT_MS = 15_000;

type ConnectionClient = {
	connectionState(): { isWebSocketConnected: boolean };
	subscribeToConnectionState(
		cb: (state: { isWebSocketConnected: boolean }) => void,
	): () => void;
};

export function isConnectionLostError(error: unknown) {
	return error instanceof Error && error.message.includes(CONNECTION_LOST);
}

/** Resolves once the WebSocket is connected, or after a timeout. */
export function waitForConnection(
	client: ConnectionClient | undefined,
	timeoutMs = CONNECTION_WAIT_MS,
): Promise<void> {
	if (!client || client.connectionState().isWebSocketConnected) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		let unsubscribe: (() => void) | undefined;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			unsubscribe?.();
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(finish, timeoutMs);
		unsubscribe = client.subscribeToConnectionState((state) => {
			if (state.isWebSocketConnected) finish();
		});
		if (done) unsubscribe();
	});
}

/**
 * Runs `load`, and runs it again after the connection comes back when it
 * failed only because the connection dropped. Stops early when `isStale`
 * says a newer load replaced this one.
 */
export async function loadWithReconnectRetry<T>(
	load: () => Promise<T>,
	client: ConnectionClient | undefined,
	isStale: () => boolean = () => false,
): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await load();
		} catch (error) {
			if (
				!isConnectionLostError(error) ||
				attempt >= MAX_RECONNECT_RETRIES ||
				isStale()
			) {
				throw error;
			}
			await waitForConnection(client);
			if (isStale()) throw error;
		}
	}
}
