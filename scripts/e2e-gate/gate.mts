// Runs in the trusted "Decide e2e-ocp-helm" job of pr-podman-push.yaml.
// It never checks out or executes PR code; it only reads PR metadata from
// the GitHub API.
//
// Environment:
//   GITHUB_REPOSITORY, GITHUB_TOKEN  repository and a token with statuses:write
//   RHDH_BOT_TOKEN                   token of a Prow-trusted org member (posts /test,
//                                    sees private org members)
//   PR_NUMBER, HEAD_SHA              from the workflow_run event
//   BUILD_CONCLUSION                 conclusion of the image build workflow
//   PUBLISH_RESULT                   outcome of the image push step
//   IMAGE_SKIPPED                    "true" when the build and push were skipped
//   RUN_URL                          link used as the status target
import { appendFileSync } from "node:fs";
import {
  alreadyRequested,
  changedPaths,
  decide,
  MAX_LISTED_FILES,
  prowStatus,
  runRequestMarker,
  STATUS_CONTEXT,
  statusDescription,
  TEST_COMMAND,
  type CommitStatus,
  type GateAction,
  type IssueComment,
  type PullRequestFile,
} from "./decide.mts";
import { GATED_BASE_BRANCHES } from "./rules.mts";

const STATUS_STATE: Record<GateAction, string> = {
  // Until Prow picks up the /test comment and reports its own pending status.
  run: "pending",
  skip: "success",
  wait: "pending",
  fail: "failure",
};

const env = process.env;
const API = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;

function headers(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface PullRequest {
  state: string;
  draft: boolean;
  title: string;
  author_association: string;
  user: { login: string };
  head: { sha: string };
  base: { ref: string };
  labels: { name: string }[];
}

const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

/**
 * Prow trusts members of the repo's org, including private members, but
 * author_association only shows MEMBER for public ones. Asking with an org
 * member's token also sees private members: 204 yes, 404 no (302 when the
 * token's user is not a member). Anything else is an error, so a broken token
 * does not quietly turn members into untrusted authors.
 */
async function isOrgMember(token: string, login: string): Promise<boolean> {
  const org = required("GITHUB_REPOSITORY").split("/")[0];
  // Only plain user logins can be members; bots like renovate[bot] cannot.
  if (!GITHUB_LOGIN.test(org) || !GITHUB_LOGIN.test(login)) return false;
  const res = await fetch(
    `https://api.github.com/orgs/${org}/members/${login}`,
    { redirect: "manual", headers: headers(token) },
  );
  if (res.status === 204) return true;
  if (res.status === 404 || res.status === 302) return false;
  throw new Error(`Org membership check for ${login}: ${res.status}`);
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
      ...headers(token),
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
    url = res.headers
      .get("link")
      ?.split(",")
      .find((link) => link.includes('rel="next"'))
      ?.split(";")[0]
      .trim()
      .slice(1, -1); // <url>; rel="next"
  }
  return items;
}

/** The newest ci/prow/e2e-ocp-helm status if Prow wrote it, else null. */
async function prowResult(
  token: string,
  headSha: string,
): Promise<CommitStatus | null> {
  return prowStatus(
    await getJson<CommitStatus[]>(
      token,
      `/commits/${headSha}/statuses?per_page=100`,
    ),
  );
}

/**
 * Sets the status unless Prow reported on the commit while the gate was
 * deciding. Returns false when Prow's result was left in place.
 */
async function setStatus(
  token: string,
  headSha: string,
  state: string,
  description: string,
): Promise<boolean> {
  if (await prowResult(token, headSha)) {
    console.log("Prow reported while the gate was deciding; leaving it.");
    return false;
  }
  await request(token, `/statuses/${headSha}`, {
    method: "POST",
    body: JSON.stringify({
      state,
      context: STATUS_CONTEXT,
      description: description.slice(0, 140),
      target_url: env.RUN_URL,
    }),
  });
  return true;
}

/** Strips line breaks and control characters from API values before logging. */
function clean(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ");
}

function report(lines: string[]): void {
  const text = lines.map(clean).join("\n");
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

async function main(): Promise<void> {
  const prNumber = Number(env.PR_NUMBER);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    // Failing the step sets an error status, so the required status is never
    // left missing.
    throw new Error("Could not determine the PR for this image build.");
  }
  const headSha = required("HEAD_SHA");
  const token = required("GITHUB_TOKEN");
  const pr = await getJson<PullRequest>(token, `/pulls/${prNumber}`);

  if (pr.state !== "open") {
    console.log(`PR #${prNumber} is ${clean(pr.state)}; nothing to do.`);
    return;
  }
  if (pr.head.sha !== headSha) {
    console.log(
      `PR #${prNumber} head moved to ${clean(pr.head.sha)}; a newer run will decide.`,
    );
    return;
  }
  if (!GATED_BASE_BRANCHES.test(pr.base.ref)) {
    console.log(
      `Base branch ${clean(pr.base.ref)} has no e2e-ocp-helm job; nothing to do.`,
    );
    return;
  }

  // A manual /test or a run the gate requested earlier already produced a
  // Prow result for this commit. Never replace it or start a second run.
  const prow = await prowResult(token, headSha);
  if (prow) {
    console.log(
      `Prow already reported "${clean(prow.state)}" for this commit; leaving it.`,
    );
    return;
  }

  const botToken = env.RHDH_BOT_TOKEN;
  const [rawFiles, orgMember] = await Promise.all([
    paginate<PullRequestFile>(token, `/pulls/${prNumber}/files`),
    botToken ? isOrgMember(botToken, pr.user.login) : false,
  ]);
  const files = changedPaths(rawFiles);
  const decision = decide({
    files,
    allFilesListed: rawFiles.length < MAX_LISTED_FILES,
    author: pr.user.login,
    authorAssociation: pr.author_association,
    orgMember,
    title: pr.title,
    labels: pr.labels.map((l) => l.name),
    draft: pr.draft,
    buildConclusion: env.BUILD_CONCLUSION ?? "",
    publishResult: env.PUBLISH_RESULT ?? "",
    imageSkipped: env.IMAGE_SKIPPED === "true",
  });

  report([
    `## e2e-ocp-helm gate: \`${decision.action}\``,
    "",
    `- PR: #${prNumber}${pr.draft ? " (draft)" : ""} into \`${pr.base.ref}\` by \`${pr.user.login}\` (${pr.author_association}${orgMember ? ", org member" : ""})`,
    `- Head: \`${headSha}\``,
    `- Reason: ${decision.reason}`,
    `- Changed files: ${files.length}`,
  ]);

  if (decision.action === "run") {
    // Prow decides on the comment author's trust, so this must be the token
    // of an org member. The marker lets a re-run see the earlier request.
    const runToken = required("RHDH_BOT_TOKEN");
    const comments = await paginate<IssueComment>(
      runToken,
      `/issues/${prNumber}/comments`,
    );
    if (alreadyRequested(comments, headSha)) {
      console.log("A run was already requested for this commit.");
      return;
    }
    // The pending status shows the request on the PR if Prow never picks it up.
    const requested = await setStatus(
      token,
      headSha,
      STATUS_STATE.run,
      `Requested ${TEST_COMMAND}; comment it again if the job does not start`,
    );
    if (!requested) return;
    await request(runToken, `/issues/${prNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `${TEST_COMMAND}\n${runRequestMarker(headSha)}\nThe PR image for \`${headSha.slice(0, 8)}\` is published, so the OCP e2e check can start.`,
      }),
    });
    return;
  }

  await setStatus(
    token,
    headSha,
    STATUS_STATE[decision.action],
    statusDescription(decision),
  );
}

// A failure here fails the step, and the workflow's "Report a gate failure"
// step sets an error status, so Tide never waits on a missing status.
await main();
