import { Hono } from "hono";
import { Octokit, App as GitHubApp } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import dotenv from "dotenv";
import { readFileSync } from "fs";

dotenv.config();

const app_id = process.env.APP_ID || "";
const webhook_secret = process.env.WEBHOOK_SECRET || "";
const privateKeyPath = process.env.PRIVATE_KEY_PATH || "";

const private_key_text = readFileSync(privateKeyPath, "utf-8");

const github_app = new GitHubApp({
  appId: app_id,
  privateKey: private_key_text,
  webhooks: { secret: webhook_secret },
});

const messageForNewPRs =
  "Thanks for opening a new PR! Please follow our contributing guidelines to make your PR easier to review.";

async function handlePR_Opened({ octokit, payload }) {
  console.log(
    `Received a pull request event for #${payload.pull_request.number}`,
  );
  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        body: messageForNewPRs,
        headers: {
          "x-github-api-version": "2022-11-28",
        },
      },
    );
  } catch (error) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    }
    console.error(error);
  }
}

github_app.webhooks.on("pull_request.opened", handlePR_Opened);

github_app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

const port = 3000;
const host = "localhost";
const path = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${path}`;

const gh_middleware = createNodeMiddleware(github_app.webhooks, { path });

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.use(gh_middleware);

export default {
  port: port,
  fetch: app.fetch,
};
