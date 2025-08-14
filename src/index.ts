import dotenv from "dotenv";
import { readFileSync } from "fs";
import { Hono } from "hono";
import { App as GitHubApp } from "octokit";
import { Ollama } from "ollama";

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

async function reviewCodeWithOllama(files) {
  const prompt = `You are a code reviewer. Please review the following code changes and provide feedback on:
- Code quality and best practices
- Potential bugs or issues
- Security concerns
- Performance improvements
- Style and readability

Here are the file changes:

${files
  .map(
    (file) => `
## File: ${file.filename} (${file.status})
Changes: +${file.additions} -${file.deletions}

${file.patch || "No diff available"}
`,
  )
  .join("\n")}

Please provide a concise review with specific suggestions for improvement.`;

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "codellama:7b",
        prompt: prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error("Error calling Ollama:", error);
    return "Sorry, I could not review the code at this time. Please check that Ollama is running.";
  }
}

async function handlePR_Opened({ octokit, payload }) {
  console.log(
    `Received a pull request event for #${payload.pull_request.number}`,
  );

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pull_number = payload.pull_request.number;

  let LLM_response;

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

    LLM_response = reviewCodeWithOllama(files);
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
        body: LLM_response,
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
