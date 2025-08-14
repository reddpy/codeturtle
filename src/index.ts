import { Hono } from "hono";
import { Octokit, App as GitHubApp } from "octokit";
import "dotenv/config";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
