import type { Release } from "../types/index.ts";
import { REPO_SLUG } from "./paths.ts";

const API_BASE = "https://api.github.com";
const USER_AGENT = "ui-ux-pro-max-cli";

export class GitHubRateLimitError extends Error {
  override name = "GitHubRateLimitError";
}

export class GitHubRequestError extends Error {
  override name = "GitHubRequestError";
}

export function getGitHubTokenGuidance(): string {
  return (
    "To increase your GitHub API rate limit, set the UI_PRO_MAX_GITHUB_TOKEN environment variable\n" +
    "to a GitHub Personal Access Token (no scopes needed for public repos).\n" +
    "Example: UI_PRO_MAX_GITHUB_TOKEN=ghp_xxx uipro versions\n" +
    "Or pass it directly: uipro versions --token ghp_xxx"
  );
}

function checkRateLimit(response: Response): void {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if ((response.status === 403 && remaining === "0") || response.status === 429) {
    const reset = response.headers.get("x-ratelimit-reset");
    const resetDate = reset ? new Date(Number.parseInt(reset, 10) * 1000).toLocaleTimeString() : "unknown";
    throw new GitHubRateLimitError(`GitHub API rate limit exceeded. Resets at ${resetDate}.\n${getGitHubTokenGuidance()}`);
  }
}

function headers(token?: string): Record<string, string> {
  const resolved = (token || process.env.UI_PRO_MAX_GITHUB_TOKEN || process.env.GITHUB_TOKEN)?.trim();
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    ...(resolved ? { Authorization: `Bearer ${resolved}` } : {}),
  };
}

async function getJson<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}/repos/${REPO_SLUG}${path}`, { headers: headers(token) });
  checkRateLimit(response);
  if (!response.ok) throw new GitHubRequestError(`GitHub request failed: ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

/** Releases of the fork, falling back to plain tags when no release is published. */
export async function fetchReleases(token?: string): Promise<Release[]> {
  const releases = await getJson<Release[]>("/releases", token);
  if (releases.length > 0) return releases;
  const tags = await getJson<{ name: string }[]>("/tags", token);
  return tags.map((tag) => ({ tag_name: tag.name, name: tag.name, published_at: "", html_url: `https://github.com/${REPO_SLUG}/releases/tag/${tag.name}` }));
}

export async function getLatestVersion(token?: string): Promise<string | null> {
  const releases = await fetchReleases(token);
  return releases[0]?.tag_name.replace(/^v/i, "") ?? null;
}
