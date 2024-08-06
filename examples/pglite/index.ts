import { pbkdf2Sync } from "node:crypto";
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PostgresConnection, verifySaslPassword } from "pg-gateway";

const db = new PGlite();

const server = net.createServer((socket) => {
	const connection = new PostgresConnection(socket, {
		serverVersion: "16.3 (PGlite 0.2.0)",
		auth: {
			mode: "sasl",
			//  async getSalt(credentials) {
			//   // user credentials.user to fetch the salt
			//   return 'salt';
			// },
			validateCredentials: async (credentials) => {
				const { clientProof, salt, iterations, authMessage } = credentials;

				const saltBuffer = Buffer.from(salt, "base64");
				const saltedPassword = pbkdf2Sync(
					"postgres",
					saltBuffer,
					iterations,
					32,
					"sha256",
				).toString("base64");

				const isValid = verifySaslPassword({
					saltedPassword,
					clientProof,
					authMessage,
				});

				if (!isValid) {
					return false;
				}

				return saltedPassword;
			},
		},
		async onStartup() {
			// Wait for PGlite to be ready before further processing
			await db.waitReady;
			return false;
		},
		async onMessage(data, { isAuthenticated }) {
			// Only forward messages to PGlite after authentication
			if (!isAuthenticated) {
				return false;
			}

			// Forward raw message to PGlite
			try {
				const [[_, responseData]] = await db.execProtocol(data);
				connection.sendData(responseData);
			} catch (err) {
				connection.sendError(err);
				connection.sendReadyForQuery();
			}
			return true;
		},
	});

	socket.on("close", () => {
		console.log("Client disconnected");
	});
});

server.listen(2345, () => {
	console.log("Server listening on port 5432");
});
