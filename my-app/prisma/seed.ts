import { PrismaClient } from './client/client';
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from 'bcryptjs';

// Explicitly load the local environment variables from our .env file natively in Node
try {
  process.loadEnvFile();
} catch (e) {
  // Ignored
}

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Pass the adapter directly into the Prisma 7 client constructor
const prisma = new PrismaClient({ adapter });

async function main() {
  // Purge any lingering user data to reset states clean
  await prisma.user.deleteMany();

  // 1. Provisions our System Administrator
  const adminPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      email: 'admin@voxcrm.com',
      name: 'Admin User',
      password: adminPassword,
      role: 'ADMIN',
    },
  });

  // 2. Provisions our standard base employee accounts
  const employeePassword = await bcrypt.hash('password123', 10);
  await prisma.user.create({
    data: {
      email: 'john@voxcrm.com',
      name: 'John Doe',
      password: employeePassword,
      role: 'EMPLOYEE',
      leaveBalance: 20,
    },
  });

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
