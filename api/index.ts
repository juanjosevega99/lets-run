import type { IncomingMessage, ServerResponse } from "node:http";
import { requestHandler } from "../src/web/server.js";

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return requestHandler(req, res);
}
