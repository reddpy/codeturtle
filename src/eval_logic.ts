async function reviewCodeWithOllama(
  files: Array<Record<string, any>>,
  commit_msg: string,
) {
  const prompt = `
  You are a code reviewer posting your comments to GitHub.
  Provide a very concise review **only for the files affected**.
  Say "Good to Ship 🚀" at the end of the review if and only if there are no issues or alterations suggested in any category.
  Say "Needs Fix 🛠️" at the end of the review if there are considerable issues in any of the categories, especially "Security Concerns" or "Potential Bugs or Issues".
  Split your feedback into these categories:
  - Code Quality & Best Practices
  - Potential Bugs or Issues
  - Security Concerns
  - Performance Improvements
  - Style & Readability

  Commit message: ${commit_msg}

  File changes:

  ${files
    .map(
      (file) => `
  ## File: ${file.filename} (${file.status})
  Changes: +${file.additions} -${file.deletions}

  ${file.patch || "No diff available"}
  `,
    )
    .join("\n")}
  `;

  try {
    console.log("☎️ Calling Ollama API...");
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemma3n:latest",
        prompt: prompt,
        stream: false,
      }),
    });

    console.log("📝 Ollama response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ollama error response:", errorText);
      throw new Error(
        `Ollama request failed: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    console.log("✅ Ollama response received");

    // Make sure we return a string
    const reviewText = data.response || "No review generated";

    return reviewText;
  } catch (error) {
    console.error("🚫 Error calling Ollama:", error);
    return "Sorry, I could not review the code at this time. Please check that Ollama is running with: `ollama serve`";
  }
}

export async function handlePR_Opened({ octokit, payload }) {
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
    const commit_message = payload.pull_request.body;

    LLM_response = await reviewCodeWithOllama(files, commit_message);
  } catch (error: any) {
    if (error.response) {
      console.log("getting PR details");
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    }
    console.error(error);
  }

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
  } catch (error: any) {
    if (error.response) {
      console.error(
        `Error! Status: ${error.response.status}. Message: ${error.response.data.message}`,
      );
    }
    console.error(error);
  }
}
