import dotenv from "dotenv";
import { readFileSync } from "fs";
import { Hono } from "hono";
import { App as GitHubApp } from "octokit";

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

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pull_number = payload.pull_request.number;

  try {
    const { data: files } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      {
        owner,
        repo,
        pull_number,
        headers: {
          "x-github-api-version": "2022-11-28",
        },
      },
    );

    console.log(`📁 Files changed in PR #${pull_number}:`);
    files.forEach((file) => {
      console.log(`  ${file.status}: ${file.filename}`);
      console.log(`    +${file.additions} -${file.deletions} changes`);
      // file.patch contains the diff for this specific file
      if (file.patch) {
        console.log("file patch:");
        console.log(file.patch);
      }
    });

    console.log("finished printing files");
  } catch (error) {
    if (error.response) {
      console.log("getting PR details");
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    }
    console.error(error);
  }

  console.log(payload.pull_request.body);
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
