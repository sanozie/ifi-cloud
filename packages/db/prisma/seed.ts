import { PrismaClient } from '@prisma/client';

/**
 * Seed script to populate the database with initial data
 * This will create a sample thread with a welcome message if the database is empty
 */
async function main() {
  console.log('Starting database seed...');
  
  // Create a new PrismaClient instance
  const prisma = new PrismaClient();
  
  try {
    // Check if there are any existing threads
    const threadCount = await prisma.thread.count();
    
    if (threadCount === 0) {
      console.log('No threads found, creating sample thread...');
      
      // Create a welcome thread
      const thread = await prisma.thread.create({
        data: {
          title: 'Welcome to IFI',
        },
      });
      
      // Add a welcome message to the thread
      await prisma.message.create({
        data: {
          threadId: thread.id,
          role: 'assistant',
          content: 'Welcome to IFI! I can help you with GitHub repositories, Notion workspaces, and coding tasks. How can I assist you today?',
        },
      });
      
      console.log(`Created sample thread with ID: ${thread.id}`);
    } else {
      console.log(`Found ${threadCount} existing threads, skipping seed.`);
    }
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    // Disconnect from the database
    await prisma.$disconnect();
  }
}

// Execute the main function
main()
  .then(() => console.log('Database seed completed successfully.'))
  .catch((e) => {
    console.error('Failed to seed database:', e);
    process.exit(1);
  });
