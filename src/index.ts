import dotenv from "dotenv";
import { readFileSync } from "fs";
import { Hono } from "hono";
import { App as GitHubApp } from "octokit";
import { handlePR_Opened } from "./eval_logic";

dotenv.config();

const app_id = process.env.APP_ID!;
const webhook_secret = process.env.WEBHOOK_SECRET!;
const privateKeyPath = process.env.PRIVATE_KEY_PATH!;
const private_key_text = readFileSync(privateKeyPath, "utf-8");

const github_app = new GitHubApp({
  appId: app_id,
  privateKey: private_key_text,
  webhooks: { secret: webhook_secret },
});

github_app.webhooks.on("pull_request.opened", handlePR_Opened);
github_app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// GitHub webhook endpoint - let Octokit handle everything
app.post("/api/webhook", async (c) => {
  const signature = c.req.header("x-hub-signature-256");
  const event = c.req.header("x-github-event");
  const deliveryId = c.req.header("x-github-delivery");
  const payload = await c.req.text();

  try {
    // Use Octokit's built-in webhook verification and processing
    await github_app.webhooks.verifyAndReceive({
      id: deliveryId || "",
      name: event || "",
      signature: signature || "",
      payload: payload || "",
    });

    return c.text("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    return c.text("Bad Request", 400);
  }
});

app.use();

const port = 3000;
const localWebhookUrl = `http://localhost:${port}/api/webhook`;

console.log(`Server is listening for events at: ${localWebhookUrl}`);
console.log("Press Ctrl + C to quit.");

export default {
  port: port,
  fetch: app.fetch,
};
