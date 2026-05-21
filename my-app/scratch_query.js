const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const targetId = '8facca91-4387-44f2-b6ac-fdedbcb4c480'
  console.log(`[DATABASE LOOKUP] Checking UUID: ${targetId}`)

  // Search Task table
  const task = await prisma.task.findUnique({ where: { id: targetId } })
  if (task) {
    console.log(`\n🎉 Found in [Task] table:`, JSON.stringify(task, null, 2))
    return
  }

  // Search Leave table
  const leave = await prisma.leave.findUnique({ where: { id: targetId } })
  if (leave) {
    console.log(`\n🎉 Found in [Leave] table:`, JSON.stringify(leave, null, 2))
    return
  }

  // Search ActivityLog table
  const log = await prisma.activityLog.findUnique({ where: { id: targetId } })
  if (log) {
    console.log(`\n🎉 Found in [ActivityLog] table:`, JSON.stringify(log, null, 2))
    return
  }

  console.log(`\n❌ UUID not found in active CRM tables.`)
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())
