import { Client } from '@notionhq/client';

/**
 * Get a Notion client instance
 */
export function getNotionClient(): Client {
  const token = process.env.NOTION_TOKEN;
  
  if (!token) {
    throw new Error('NOTION_TOKEN environment variable is not set');
  }
  
  return new Client({
    auth: token,
  });
}

/**
 * List databases in a Notion workspace
 */
export async function listDatabases() {
  const notion = getNotionClient();
  
  try {
    const response = await notion.databases.list({});
    return response.results;
  } catch (error) {
    console.error('Error listing Notion databases:', error);
    throw new Error(`Failed to list Notion databases: ${(error as Error).message}`);
  }
}

/**
 * Get a database by ID
 */
export async function getDatabase(databaseId: string) {
  const notion = getNotionClient();
  
  try {
    return await notion.databases.retrieve({
      database_id: databaseId,
    });
  } catch (error) {
    console.error(`Error retrieving Notion database ${databaseId}:`, error);
    throw new Error(`Failed to retrieve Notion database: ${(error as Error).message}`);
  }
}

/**
 * Query a database
 */
export async function queryDatabase(databaseId: string, filter?: any, sorts?: any) {
  const notion = getNotionClient();
  
  try {
    return await notion.databases.query({
      database_id: databaseId,
      filter,
      sorts,
    });
  } catch (error) {
    console.error(`Error querying Notion database ${databaseId}:`, error);
    throw new Error(`Failed to query Notion database: ${(error as Error).message}`);
  }
}
