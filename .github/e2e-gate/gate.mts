// Runs in the trusted "Decide e2e-ocp-helm" job of pr-podman-push.yaml.
// It never checks out or executes PR code; it only reads PR metadata from
// the GitHub API.
//
// Environment:
//   GITHUB_REPOSITORY, GITHUB_TOKEN  repository and a token with statuses:write
//   RHDH_BOT_TOKEN                   token of a Prow-trusted org member (posts /test)
//   PR_NUMBER, HEAD_SHA              from the workflow_run event
//   BUILD_CONCLUSION                 conclusion of the image build workflow
//   PUBLISH_RESULT                   result of the podman-push job
//   IMAGE_SKIPPED                    "true" when the build and push were skipped
//   GATE_MODE                        "enforce" to act; anything else only reports
//   RUN_URL                          link used as the status target
import { appendFileSync } from "node:fs";
import { decide, TEST_COMMAND, type GateAction } from "./decide.mts";
import { GATED_BASE_BRANCHES } from "./rules.mts";

const STATUS_CONTEXT = "ci/prow/e2e-ocp-helm";
const STATUS_STATE: Record<Exclude<GateAction, "run">, string> = {
  skip: "success",
  wait: "pending",
  fail: "failure",
};

const env = process.env;
const API = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;

interface PullRequest {
  state: string;
  title: string;
  author_association: string;
  user: { login: string };
  head: { sha: string };
  base: { ref: string };
  labels: { name: string }[];
}

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function request(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(url.startsWith("https://") ? url : `${API}${url}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${url}: ${res.status} ${await res.text()}`,
    );
  }
  return res;
}

async function getJson<T>(token: string, url: string): Promise<T> {
  return (await (await request(token, url)).json()) as T;
}

async function paginate<T>(token: string, path: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = `${API}${path}?per_page=100`;
  while (url) {
    const res = await request(token, url);
    items.push(...((await res.json()) as T[]));
    url = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  return items;
}

function report(lines: string[]): void {
  const text = lines.join("\n");
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

async function main(): Promise<void> {
  const prNumber = Number(env.PR_NUMBER);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.log("No PR number; nothing to do.");
    return;
  }
  const headSha = required("HEAD_SHA");
  const token = required("GITHUB_TOKEN");
  const pr = await getJson<PullRequest>(token, `/pulls/${prNumber}`);

  if (pr.state !== "open") {
    console.log(`PR #${prNumber} is ${pr.state}; nothing to do.`);
    return;
  }
  if (pr.head.sha !== headSha) {
    console.log(
      `PR #${prNumber} head moved to ${pr.head.sha}; a newer run will decide.`,
    );
    return;
  }
  if (!GATED_BASE_BRANCHES.test(pr.base.ref)) {
    console.log(
      `Base branch ${pr.base.ref} has no e2e-ocp-helm job; nothing to do.`,
    );
    return;
  }

  const files = (
    await paginate<{ filename: string }>(token, `/pulls/${prNumber}/files`)
  ).map((f) => f.filename);
  const decision = decide({
    files,
    author: pr.user.login,
    authorAssociation: pr.author_association,
    title: pr.title,
    labels: pr.labels.map((l) => l.name),
    buildConclusion: env.BUILD_CONCLUSION ?? "",
    publishResult: env.PUBLISH_RESULT ?? "",
    imageSkipped: env.IMAGE_SKIPPED === "true",
  });

  const enforce = env.GATE_MODE === "enforce";
  report([
    `## e2e-ocp-helm gate: \`${decision.action}\``,
    "",
    `- PR: #${prNumber} into \`${pr.base.ref}\` by \`${pr.user.login}\` (${pr.author_association})`,
    `- Head: \`${headSha}\``,
    `- Reason: ${decision.reason}`,
    `- Changed files: ${files.length}`,
    `- Mode: ${enforce ? "enforce" : "report only (set the E2E_GATE_MODE repository variable to `enforce` to act)"}`,
  ]);
  if (!enforce) return;

  if (decision.action === "run") {
    // Prow decides on the comment author's trust, so this must be the token
    // of an org member. The marker lets a re-run see the earlier request.
    const botToken = required("RHDH_BOT_TOKEN");
    const marker = `<!-- e2e-ocp-gate sha=${headSha} -->`;
    const comments = await paginate<{ body?: string }>(
      botToken,
      `/issues/${prNumber}/comments`,
    );
    if (comments.some((c) => c.body?.includes(marker))) {
      console.log("A run was already requested for this commit.");
      return;
    }
    await request(botToken, `/issues/${prNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `${TEST_COMMAND}\n${marker}\nThe PR image for \`${headSha.slice(0, 8)}\` is published, so the OCP e2e check can start.`,
      }),
    });
    return;
  }

  await request(token, `/statuses/${headSha}`, {
    method: "POST",
    body: JSON.stringify({
      state: STATUS_STATE[decision.action],
      context: STATUS_CONTEXT,
      description: decision.reason.slice(0, 140),
      target_url: env.RUN_URL,
    }),
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
