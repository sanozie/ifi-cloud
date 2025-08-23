/**
 * Repository suggestion result
 */
export interface RepoSuggestion {
  fullName: string;
  score: number;
}

/**
 * Pull request suggestion result
 */
export interface PRSuggestion {
  fullName: string;
  number: number;
  title: string;
  score: number;
}

/**
 * MCP search response shape
 */
interface MCPSearchResponse {
  repos?: Array<{
    fullName?: string;
    score?: number;
    [key: string]: any;
  }>;
  prs?: Array<{
    fullName?: string;
    number?: number;
    title?: string;
    score?: number;
    [key: string]: any;
  }>;
  [key: string]: any;
}

/**
 * Suggests repositories and pull requests based on a natural language query
 * using the Model Context Protocol GitHub server
 * 
 * @param query Natural language query to search for repos and PRs
 * @returns Promise with arrays of suggested repos and PRs
 */
export async function suggestRepoAndPR(query: string): Promise<{
  repos: RepoSuggestion[];
  prs: PRSuggestion[];
}> {
  // Get MCP GitHub URL from environment
  const mcpUrl = process.env.MCP_GITHUB_URL;
  
  // If URL is not set, return empty results
  if (!mcpUrl) {
    console.warn('MCP_GITHUB_URL not set, returning empty suggestions');
    return { repos: [], prs: [] };
  }
  
  try {
    // Ensure trailing slash is removed then append /search
    const url = `${mcpUrl.replace(/\/$/, '')}/search`;

    // Abort after 10 s
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10_000);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ac.signal,
    }).catch((err) => {
      console.error('Fetch error contacting MCP server:', err);
      throw err;
    });

    clearTimeout(timeout);

    if (!res || !res.ok) {
      console.warn(`MCP server responded with status ${res?.status}`);
      return { repos: [], prs: [] };
    }

    const json = await res.json().catch(() => ({}));

    return validateAndTransformResponse(json);
  } catch (error) {
    console.error('Error in MCP GitHub suggestion:', error);
    return { repos: [], prs: [] };
  }
}

/**
 * Validates and transforms the MCP search response
 */
function validateAndTransformResponse(response: any): {
  repos: RepoSuggestion[];
  prs: PRSuggestion[];
} {
  const result: {
    repos: RepoSuggestion[];
    prs: PRSuggestion[];
  } = {
    repos: [],
    prs: [],
  };
  
  try {
    // Ensure response is an object
    if (!response || typeof response !== 'object') {
      return result;
    }
    
    const mcpResponse = response as MCPSearchResponse;
    
    // Process repos if present
    if (Array.isArray(mcpResponse.repos)) {
      result.repos = mcpResponse.repos
        .filter(repo => 
          typeof repo === 'object' && 
          typeof repo.fullName === 'string' &&
          typeof repo.score === 'number'
        )
        .map(repo => ({
          fullName: repo.fullName as string,
          score: repo.score as number,
        }))
        .sort((a, b) => b.score - a.score); // Sort by score descending
    }
    
    // Process PRs if present
    if (Array.isArray(mcpResponse.prs)) {
      result.prs = mcpResponse.prs
        .filter(pr => 
          typeof pr === 'object' && 
          typeof pr.fullName === 'string' &&
          typeof pr.number === 'number' &&
          typeof pr.title === 'string' &&
          typeof pr.score === 'number'
        )
        .map(pr => ({
          fullName: pr.fullName as string,
          number: pr.number as number,
          title: pr.title as string,
          score: pr.score as number,
        }))
        .sort((a, b) => b.score - a.score); // Sort by score descending
    }
  } catch (error) {
    console.error('Error validating MCP response:', error);
  }
  
  return result;
}

/**
 * Gets an MCP GitHub client if configured
 * @returns The MCP client or null if not configured
 */
export function getMcpGithubClient() {
  const mcpUrl = process.env.MCP_GITHUB_URL;
  if (!mcpUrl) {
    return null;
  }
  
  return {
    suggestRepoAndPR,
  };
}
