import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { executeDag, DAGNode } from "@/lib/dag/executor"
import OpenAI from "openai"
import { notificationQueue } from "@/lib/queue"
import bcrypt from "bcryptjs"

// Initialize the OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Helper wrapper to trace DAG execution
function executionTraceWrapper(
  id: string,
  type: string,
  dependencies: string[],
  fn: (results: Map<string, any>) => Promise<any>
) {
  return async (results: Map<string, any>) => {
    return fn(results);
  };
}

export async function POST(req: NextRequest) {
  try {
    // 1. Security Check: Verify user session
    const session = await auth()
    if (!session || !session.user) {
      return NextResponse.json({ success: false, error: "Unauthorized access detected." }, { status: 401 })
    }

    const userId = session.user.id as string
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized access detected." }, { status: 401 })
    }

    const userExists = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!userExists) {
      return NextResponse.json(
        { success: false, error: "Stale session detected. Please log out and sign back in to refresh credentials." },
        { status: 401 }
      )
    }

    // 2. Determine Payload Type (Voice Input vs Text Input)
    const formData = await req.formData()
    const file = formData.get("file") as Blob | null
    const textInput = formData.get("text") as string | null

    if (!file && !textInput) {
      return NextResponse.json({ success: false, error: "Missing both voice boundary or text input payloads." }, { status: 400 })
    }

    let textCommand = ""

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const fileStream = await OpenAI.toFile(buffer, "audio_command.webm", {
        type: file.type || "audio/webm"
      })
      const sttResponse = await openai.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
      })
      textCommand = sttResponse.text
    } else if (textInput) {
      textCommand = textInput
    }

    // Layer 2: Context Manager — Retrieve user's recent successful activity logs to resolve multi-turn context references (conversational memory)
    const shortTermMemory = await prisma.activityLog.findMany({
      where: { userId, status: "SUCCESS" },
      orderBy: { timestamp: "desc" },
      take: 2,
      select: { voiceInput: true, action: true, intentJson: true }
    })

    const conversationContext = shortTermMemory.slice().reverse().map((log, i) => {
      return `Command ${i+1}: User said: "${log.voiceInput}". System mapped to action: [${log.action}].`
    }).join("\n")

    const contextPrompt = conversationContext
      ? `CONVERSATIONAL MEMORY MANAGER CONTEXT:\n${conversationContext}\nUse this context history to resolve pronouns like 'it', 'them', 'that', or 'this task' if present in the new command.`
      : "No prior command history in this session."

    // 3. AI Orchestration Engine: Call OpenAI with Strict Structured JSON output
    const userRole = userExists.role

    const systemPrompt = `You are Orion, VoxCRM's voice assistant.
Today's date is ${new Date().toISOString().split('T')[0]}.
User ID: "${userId}", Role: "${userRole}".

${contextPrompt}

Extract ONE primary intent from the user's command and return strict JSON:
{
  "action": "mark_leave" | "create_task" | "schedule_meeting" | "approve_leave" | "query_attendance" | "query_tasks" | "query_leave_balance" | "create_user" | "UNKNOWN",
  "confidence": float (0.0 to 1.0),
  "payload": {
    // mark_leave:      { "type": "FULL_DAY" | "HALF_DAY", "reason": "reason string" }
    // create_task:     { "title": "concise task title", "description": "task description" }
    // schedule_meeting: { "title": "meeting title", "participantsEmails": ["email1", "email2"] }
    // approve_leave:   { "leaveId": "leaveId string if known", "employeeName": "employeeName string if known" }
    // create_user:     { "name": "full name", "email": "email address", "role": "EMPLOYEE" | "ADMIN" }
    // queries/unknown:  {}
  }
}`

    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: textCommand }
      ],
      temperature: 0.3,
    })

    const intent = JSON.parse(gptResponse.choices[0].message.content || "{}")

    // Confidence gate
    if (!intent.action || intent.confidence < 0.70) {
      return NextResponse.json({
        success: true,
        meta: {
          transcription: textCommand,
          results: [{ intent: "UNKNOWN", message: "Confidence too low. Please rephrase your command." }]
        }
      })
    }

    const { action, payload } = intent

    // 4a. Intent Validation Filter — eliminates AI classification drift
    const INTENT_KEYWORDS: Record<string, string[]> = {
      mark_leave:        ['leave', 'off', 'absent', 'holiday', 'sick', 'day off'],
      create_task:       ['task', 'assign', 'create', 'todo', 'work', 'job'],
      schedule_meeting:  ['meeting', 'schedule', 'call', 'standup', 'sync', 'book'],
      approve_leave:     ['approve', 'accept', 'confirm', 'grant'],
      query_attendance:  ['who', 'absent', 'leave today', 'on leave', 'attendance'],
      query_tasks:       ['my tasks', 'pending', 'assigned', 'what tasks'],
      query_leave_balance: ['balance', 'how many leaves', 'remaining'],
      create_user:       ['user', 'employee', 'admin', 'add', 'create', 'register', 'provision'],
    }

    function validateIntentAgainstTranscript(action: string, transcript: string): boolean {
      if (action === 'UNKNOWN') return true
      const keywords = INTENT_KEYWORDS[action] || []
      const lower = transcript.toLowerCase()
      return keywords.some(kw => lower.includes(kw))
    }

    const isValidIntent = validateIntentAgainstTranscript(action, textCommand)
    if (!isValidIntent && intent.confidence < 0.85) {
      return NextResponse.json({
        success: true,
        meta: {
          transcription: textCommand,
          results: [{ intent: 'UNKNOWN', message: 'Command not recognised clearly. Please try again.' }]
        }
      })
    }

    // Map single intent action and payload to finalizedActions
    const finalizedActions: any[] = []

    if (action === "mark_leave") {
      finalizedActions.push({
        intent: "REQUEST_LEAVE",
        data: {
          leaveType: payload.type === "HALF_DAY" ? "HALF_DAY" : "FULL_DAY",
          reason: payload.reason || "Requested via Voice Core"
        }
      })
    } else if (action === "create_task") {
      finalizedActions.push({
        intent: "CREATE_TASK",
        data: {
          title: payload.title || "Voice Task",
          description: payload.description || "Created via VoxCRM Voice Core"
        }
      })
    } else if (action === "schedule_meeting") {
      finalizedActions.push({
        intent: "SCHEDULE_MEETING",
        data: {
          title: payload.title || "Voice Meeting",
          description: payload.description || "Scheduled via VoxCRM Voice Core",
          participantsEmails: payload.participantsEmails || []
        }
      })
    } else if (action === "approve_leave") {
      finalizedActions.push({
        intent: "APPROVE_LEAVE",
        data: {
          leaveId: payload.leaveId || null,
          employeeName: payload.employeeName || null
        }
      })
    } else if (action === "query_attendance") {
      finalizedActions.push({
        intent: "QUERY_ATTENDANCE",
        data: {}
      })
    } else if (action === "query_tasks") {
      finalizedActions.push({
        intent: "QUERY_TASKS",
        data: {}
      })
    } else if (action === "query_leave_balance") {
      finalizedActions.push({
        intent: "QUERY_LEAVE_BALANCE",
        data: {}
      })
    } else if (action === "create_user") {
      finalizedActions.push({
        intent: "CREATE_USER",
        data: {
          name: payload.name || "",
          email: payload.email || "",
          role: payload.role || "EMPLOYEE"
        }
      })
    } else {
      finalizedActions.push({
        intent: "UNKNOWN",
        data: { title: "Ambiguous Command", description: "Filtered by validation layer." }
      })
    }

    // 4b. Parallel DAG Execution Engine
    let actionMessage: string | undefined = undefined

    const operationalResult = await prisma.$transaction(async (tx) => {
      const dagNodes: DAGNode[] = []

      finalizedActions.forEach((actionObj: any, idx: number) => {
        const { intent, data } = actionObj
        const dbNodeId = (intent === "QUERY_TASKS" || intent === "QUERY_ATTENDANCE" || intent === "QUERY_LEAVE_BALANCE" || intent === "APPROVE_LEAVE" || intent === "CREATE_USER")
          ? "db_query"
          : (intent === "SCHEDULE_MEETING" ? "schedule_meeting" : `db_${idx}`)
        const logNodeId = (intent === "QUERY_TASKS" || intent === "QUERY_ATTENDANCE" || intent === "QUERY_LEAVE_BALANCE" || intent === "APPROVE_LEAVE" || intent === "CREATE_USER")
          ? "log_activity"
          : `log_${idx}`

        // Node A: write the primary entity or perform query (no upstream dependencies)
        dagNodes.push({
          id: dbNodeId,
          type: "database",
          dependencies: [],
          retry: 0,
          execute: executionTraceWrapper(dbNodeId, "database", [], async () => {
            if (intent === "CREATE_TASK" && data.title) {
              return tx.task.create({
                data: {
                  title: data.title,
                  description: data.description || "Created via VoxCRM Voice Core",
                  status: "OPEN",
                  createdById: userId,
                },
              })
            }
            if (intent === "REQUEST_LEAVE") {
              return tx.leave.create({
                data: {
                  userId: userId,
                  date: new Date(),
                  type: data.leaveType === "HALF_DAY" ? "HALF_DAY" : "FULL_DAY",
                  reason: data.reason || "Requested via Voice Core",
                  status: "PENDING",
                },
              })
            }
            if (intent === "QUERY_TASKS") {
              return tx.task.findMany({
                where: { assignedToId: userId, status: { not: "COMPLETED" } },
                orderBy: { createdAt: "asc" }
              })
            }
            if (intent === "SCHEDULE_MEETING") {
              const participantIds = []
              if (data.participantsEmails?.length) {
                const users = await tx.user.findMany({
                  where: { email: { in: data.participantsEmails } },
                  select: { id: true }
                })
                participantIds.push(...users.map((u: any) => ({ id: u.id })))
              }
              participantIds.push({ id: userId }) // always include creator

              return tx.meeting.create({
                data: {
                  title: data.title || "Voice Meeting",
                  description: data.description || "Scheduled via VoxCRM Voice Core",
                  startTime: new Date(),
                  endTime: new Date(Date.now() + 60 * 60 * 1000), // Default to 1 hour duration
                  createdById: userId,
                  participants: { connect: participantIds }
                }
              })
            }
            if (intent === "APPROVE_LEAVE") {
              if (data.leaveId) {
                return tx.leave.update({
                  where: { id: data.leaveId },
                  data: { status: "APPROVED" }
                })
              }
              if (data.employeeName) {
                const user = await tx.user.findFirst({
                  where: { name: { contains: data.employeeName, mode: 'insensitive' } }
                })
                if (user) {
                  const pendingLeave = await tx.leave.findFirst({
                    where: { userId: user.id, status: "PENDING" },
                    orderBy: { createdAt: "asc" }
                  })
                  if (pendingLeave) {
                    return tx.leave.update({
                      where: { id: pendingLeave.id },
                      data: { status: "APPROVED" }
                    })
                  }
                }
              }
              return null
            }
            if (intent === "QUERY_ATTENDANCE") {
              return tx.leave.findMany({
                where: {
                  date: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0)),
                    lte: new Date(new Date().setHours(23, 59, 59, 999))
                  },
                  status: "APPROVED"
                },
                include: { user: { select: { name: true } } }
              })
            }
            if (intent === "QUERY_LEAVE_BALANCE") {
              return tx.user.findUnique({
                where: { id: userId },
                select: { leaveBalance: true, name: true }
              })
            }
            if (intent === "CREATE_USER") {
              if (userRole !== "ADMIN") {
                throw new Error("PERMISSION_DENIED: Only system administrators can provision user accounts.")
              }
              if (!data.email || !data.name) {
                throw new Error("BAD_REQUEST: Missing email or name for the new user.")
              }
              const defaultPasswordHash = await bcrypt.hash("welcome123", 10)
              return tx.user.create({
                data: {
                  email: data.email,
                  name: data.name,
                  password: defaultPasswordHash,
                  role: data.role === "ADMIN" ? "ADMIN" : "EMPLOYEE",
                  leaveBalance: 20
                }
              })
            }
            return null // UNKNOWN — no entity write
          }),
        })

        // Node B: write the audit log (depends on the database write/query finishing first)
        dagNodes.push({
          id: logNodeId,
          type: "audit",
          dependencies: [dbNodeId],
          retry: 0,
          execute: executionTraceWrapper(logNodeId, "audit", [dbNodeId], async () => {
            return tx.activityLog.create({
              data: {
                userId: userId,
                action: intent,
                voiceInput: textCommand,
                intentJson: actionObj,
                status: intent !== "UNKNOWN" ? "SUCCESS" : "FAILED",
              },
            })
          }),
        })
      })

      // Fire the DAG — parallel waves replace the old sequential for-loop
      const { results: dagResults, failed } = await executeDag(dagNodes)

      if (failed.size > 0) {
        const firstError = [...failed.values()][0]
        throw firstError
      }

      // Check if db_query was executed and build response message
      const primaryAction = finalizedActions[0]
      const primaryIntent = primaryAction?.intent
      const queryResult = dagResults.get("db_query")
      if (queryResult) {
        if (primaryIntent === "QUERY_TASKS") {
          actionMessage = queryResult.length > 0
            ? `You have ${queryResult.length} active tasks: ${queryResult.map((t: any) => t.title).join(", ")}.`
            : "You have no pending tasks."
        } else if (primaryIntent === "QUERY_ATTENDANCE") {
          actionMessage = queryResult.length > 0
            ? `On leave today: ${queryResult.map((l: any) => l.user.name).join(", ")}.`
            : "Nobody is on leave today."
        } else if (primaryIntent === "QUERY_LEAVE_BALANCE") {
          actionMessage = `Your remaining leave balance is ${queryResult?.leaveBalance ?? 0} days.`
        } else if (primaryIntent === "APPROVE_LEAVE") {
          actionMessage = queryResult
            ? `Leave request has been approved.`
            : "No matching pending leave request found."
        } else if (primaryIntent === "CREATE_USER") {
          actionMessage = queryResult
            ? `Successfully registered user ${queryResult.name} (${queryResult.email}) as ${queryResult.role}.`
            : "Failed to register user."
        }
      }

      // Build the response summary from the settled DAG results
      const results = finalizedActions.map((_: any, idx: number) => {
        const currentIntent = finalizedActions[idx].intent
        const isQuery = currentIntent === "QUERY_TASKS" || currentIntent === "QUERY_ATTENDANCE" || currentIntent === "QUERY_LEAVE_BALANCE" || currentIntent === "APPROVE_LEAVE" || currentIntent === "CREATE_USER"
        const isMeeting = currentIntent === "SCHEDULE_MEETING"
        const dbId = isQuery ? "db_query" : (isMeeting ? "schedule_meeting" : `db_${idx}`)
        const logId = isQuery ? "log_activity" : `log_${idx}`
        return {
          intent: currentIntent,
          createdEntityId: dagResults.get(dbId)?.id ?? null,
          logId: dagResults.get(logId)?.id ?? null,
        }
      })

      return { transcription: textCommand, results, actionMessage }
    }, {
      maxWait: 15000,
      timeout: 30000,
      isolationLevel: 'Serializable',
    })

    // 5. Post-transaction notification events (BullMQ queue with sync fallback)
    operationalResult.results.forEach((result: any, idx: number) => {
      if (result.intent === "REQUEST_LEAVE" && result.createdEntityId) {
        const actionData = finalizedActions[idx]?.data ?? {}
        const payloadData = {
          event: "LEAVE_REQUESTED",
          userId,
          leaveId: result.createdEntityId,
          reason: actionData.reason ?? null,
          type: actionData.leaveType ?? "FULL_DAY",
          timestamp: new Date().toISOString(),
        }

        if (notificationQueue) {
          notificationQueue.add('send_notification', payloadData)
            .then(() => console.log(`[QUEUE] Notification job added for leave: ${result.createdEntityId}`))
            .catch((err) => {
              console.warn("[QUEUE] Failed to queue job, using synchronous fallback:", err.message)
              triggerSynchronousFallback(payloadData)
            })
        } else {
          triggerSynchronousFallback(payloadData)
        }
      }
    })

    function triggerSynchronousFallback(payloadData: any) {
      const webhookUrl = process.env.N8N_WEBHOOK_URL
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadData),
        })
          .then(() => console.log(`[WEBHOOK] Synchronous fallback notified: ${payloadData.leaveId}`))
          .catch((err: Error) => console.warn("[WEBHOOK] Synchronous fallback failed:", err.message))
      }
      
      const resendKey = process.env.RESEND_API_KEY
      if (resendKey) {
        import('resend').then(({ Resend }) => {
          const resend = new Resend(resendKey)
          resend.emails.send({
            from: 'VoxCRM <notifications@voxcrm.com>',
            to: process.env.ADMIN_EMAIL || 'admin@voxcrm.com',
            subject: `VoxCRM — ${payloadData.event} (Sync Fallback)`,
            html: `<p>Event: <strong>${payloadData.event}</strong></p>
                   <p>User: ${payloadData.userId} | Type: ${payloadData.type || 'N/A'} | Reason: ${payloadData.reason || 'N/A'}</p>`,
          })
        }).catch((err) => console.error("[MAILER] Sync fallback email fail:", err))
      }
    }

    return NextResponse.json({ success: true, meta: operationalResult })

  } catch (error: any) {
    console.error("[CRITICAL SYSTEM ERROR]:", error)
    return NextResponse.json(
      { success: false, error: "Internal cluster processing failure.", details: error.message },
      { status: 500 }
    )
  }
}
