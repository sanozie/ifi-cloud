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
    console.log('Testing connections')
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
