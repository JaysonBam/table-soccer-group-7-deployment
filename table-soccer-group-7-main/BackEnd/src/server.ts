// Starts the backend server.

import { createServer } from "node:http";
import { createLobbyRouteHandler } from "./api/lobbyRoutes.ts";
import { createLobbyService } from "./lobbies/lobbyService.ts";
import { SERVER_HOST, SERVER_PORT } from "./shared/constants.ts";
import { createLobbySocketServer } from "./realtime/lobbySocketServer.ts";

const lobbyService = createLobbyService();
const server = createServer();
const lobbySocketServer = createLobbySocketServer(server, lobbyService);

server.on("request", createLobbyRouteHandler({
  lobbyService,
  lobbySocketServer
}));

server.listen(SERVER_PORT, SERVER_HOST, () => {
  const displayHost = SERVER_HOST === "0.0.0.0" ? "localhost" : SERVER_HOST;

  console.log(`Backend server running on http://${displayHost}:${SERVER_PORT}`);
});
