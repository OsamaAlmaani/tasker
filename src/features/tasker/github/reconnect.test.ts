import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isConnectionLostError,
	loadWithReconnectRetry,
	waitForConnection,
} from "./reconnect";

const lost = () =>
	new Error(
		"[CONVEX A(githubActions:getPullRequest)] Connection lost while action was in flight Called by client",
	);

function fakeClient(connected: boolean) {
	let listener: ((state: { isWebSocketConnected: boolean }) => void) | null =
		null;
	const client = {
		connected,
		unsubscribed: 0,
		connectionState: () => ({ isWebSocketConnected: client.connected }),
		subscribeToConnectionState: (
			cb: (state: { isWebSocketConnected: boolean }) => void,
		) => {
			listener = cb;
			return () => {
				client.unsubscribed++;
				listener = null;
			};
		},
		connect: () => {
			client.connected = true;
			listener?.({ isWebSocketConnected: true });
		},
	};
	return client;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("reconnect retries", () => {
	it("recognises the dropped-connection error only", () => {
		expect(isConnectionLostError(lost())).toBe(true);
		expect(
			isConnectionLostError(new Error("GitHub request failed (502).")),
		).toBe(false);
		expect(isConnectionLostError("Connection lost")).toBe(false);
	});

	it("loads again after the connection comes back", async () => {
		const client = fakeClient(false);
		const load = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(lost())
			.mockResolvedValueOnce("pull request");
		const result = loadWithReconnectRetry(load, client);
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
		client.connect();
		await expect(result).resolves.toBe("pull request");
		expect(load).toHaveBeenCalledTimes(2);
		expect(client.unsubscribed).toBe(1);
	});

	it("does not retry other errors, and gives up after two retries", async () => {
		const other = vi.fn().mockRejectedValue(new Error("Not found"));
		await expect(loadWithReconnectRetry(other, undefined)).rejects.toThrow(
			"Not found",
		);
		expect(other).toHaveBeenCalledTimes(1);

		const always = vi.fn().mockRejectedValue(lost());
		await expect(loadWithReconnectRetry(always, undefined)).rejects.toThrow(
			"Connection lost",
		);
		expect(always).toHaveBeenCalledTimes(3);
	});

	it("stops when a newer load replaced this one", async () => {
		const load = vi.fn().mockRejectedValue(lost());
		await expect(
			loadWithReconnectRetry(load, undefined, () => true),
		).rejects.toThrow("Connection lost");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("stops waiting for the connection after the timeout", async () => {
		vi.useFakeTimers();
		const client = fakeClient(false);
		const wait = waitForConnection(client, 1000);
		vi.advanceTimersByTime(1000);
		await expect(wait).resolves.toBeUndefined();
		expect(client.unsubscribed).toBe(1);
	});
});
