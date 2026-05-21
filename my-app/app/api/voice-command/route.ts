import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenAI, Type } from "@google/genai"
import { executeDag, DAGNode } from "@/lib/dag/executor"

// Initialize the enterprise Gemini SDK client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

export async function POST(req: NextRequest) {
  try {
    // 1. Enterprise Security Check: Verify user session
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
      select: { id: true },
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

    let isVoice = true
    let textCommand = ""
    let fileType = "audio/webm"
    let base64Audio = ""

    if (textInput) {
      isVoice = false
      textCommand = textInput
    } else if (file) {
      isVoice = true
      fileType = file.type || "audio/webm"
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      base64Audio = buffer.toString("base64")
    }

    // Layer 2: Context Manager — Retrieve user's recent successful activity logs to resolve multi-turn context references (conversational memory)
    const shortTermMemory = await prisma.activityLog.findMany({
      where: { userId, status: "SUCCESS" },
      orderBy: { timestamp: "desc" },
      take: 3,
      select: { voiceInput: true, action: true, intentJson: true }
    })

    const conversationContext = shortTermMemory.slice().reverse().map((log, i) => {
      return `Command ${i+1}: User said: "${log.voiceInput}". System mapped to action: [${log.action}].`
    }).join("\n")

    const contextPrompt = conversationContext
      ? `CONVERSATIONAL MEMORY MANAGER CONTEXT:\n${conversationContext}\nUse this context history to resolve pronouns like 'it', 'them', 'that', or 'this task' if present in the new command.`
      : "No prior command history in this session."

    // 3. AI Orchestration Engine: Call Gemini with Strict Structured JSON output and automatic retry/backoff
    let aiResponse = null
    const modelOptions = ["gemini-2.5-flash"]
    let lastError = null

    for (const model of modelOptions) {
      const maxRetries = 3
      const baseDelayMs = 1500
      let attempt = 0

      while (attempt < maxRetries) {
        attempt++
        try {
          console.log(`[SYSTEM] Attempting content generation with model: ${model} (attempt ${attempt}/${maxRetries}, isVoice: ${isVoice})`)
          
          const response = await ai.models.generateContent({
            model: model,
            contents: isVoice
              ? [
                  {
                    inlineData: {
                      mimeType: fileType,
                      data: base64Audio,
                    },
                  },
                  `You are the core processing engine for VoxCRM. Your job is to analyze the user's recorded speech and map it to one or more structured operational objects representing their intents.

   Context:
   ${contextPrompt}

   Strict Instructions:
   1. If the user mentions "task", "create task", "add task", or asks to do an action, add an action object with intent set to "CREATE_TASK". Extract a concise summary for 'title' (max 5 words) and put the full context in 'description'.
   2. If the user mentions "leave", "sick leave", "vacation", or "time off", add an action object with intent set to "REQUEST_LEAVE". Set 'leaveType' to either "FULL_DAY" or "HALF_DAY" based on context, and extract the reason into 'reason'.
   3. If the audio contains generic greetings, testing phrases (like "hello hello"), or ambiguous speech, add an action object with intent set to "UNKNOWN".
   4. A single audio clip can contain multiple instructions (e.g. creating a task and requesting leave at the same time). Make sure to parse each instruction into a separate action object in the 'actions' array.

   CRITICAL: Ensure the 'title' field is never empty if an action's intent is "CREATE_TASK".`
                ]
              : [
                  `You are the core processing engine for VoxCRM. Your job is to analyze the user's text command and map it to one or more structured operational objects representing their intents.

   Context:
   ${contextPrompt}

   Input Command to Parse:
   "${textCommand}"

   Strict Instructions:
   1. If the user mentions "task", "create task", "add task", or asks to do an action, add an action object with intent set to "CREATE_TASK". Extract a concise summary for 'title' (max 5 words) and put the full context in 'description'.
   2. If the user mentions "leave", "sick leave", "vacation", or "time off", add an action object with intent set to "REQUEST_LEAVE". Set 'leaveType' to either "FULL_DAY" or "HALF_DAY" based on context, and extract the reason into 'reason'.
   3. If the input contains generic greetings, testing phrases (like "hello hello"), or ambiguous speech, add an action object with intent set to "UNKNOWN".
   4. A single command can contain multiple instructions (e.g. creating a task and requesting leave at the same time). Make sure to parse each instruction into a separate action object in the 'actions' array.

   CRITICAL: Ensure the 'title' field is never empty if an action's intent is "CREATE_TASK".
   Provide the verbatim input text command in the 'transcription' field of the output JSON.`
                ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  transcription: { type: Type.STRING },
                  actions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        intent: { 
                          type: Type.STRING, 
                          enum: ["CREATE_TASK", "REQUEST_LEAVE", "UNKNOWN"] 
                        },
                        data: {
                          type: Type.OBJECT,
                          properties: {
                            title: { type: Type.STRING },
                            description: { type: Type.STRING },
                            leaveType: { type: Type.STRING, enum: ["FULL_DAY", "HALF_DAY"] },
                            reason: { type: Type.STRING }
                          }
                        }
                      },
                      required: ["intent", "data"],
                    }
                  }
                },
                required: ["transcription", "actions"],
              },
            },
          })
          
          if (response && response.text) {
            aiResponse = response
            console.log(`[SYSTEM] Content generation succeeded with model: ${model}`)
            break
          }
        } catch (err: any) {
          console.warn(`[WARNING] Model ${model} failed to respond (attempt ${attempt}/${maxRetries}):`, err.message || err)
          lastError = err

          const isRetryable = 
            err.status === 503 || 
            err.status === 429 || 
            (err.message && (
              err.message.includes("503") || 
              err.message.includes("429") || 
              err.message.includes("RESOURCE_EXHAUSTED") || 
              err.message.includes("UNAVAILABLE")
            ))

          if (attempt >= maxRetries || !isRetryable) {
            break
          }

          let delay = baseDelayMs * Math.pow(2, attempt - 1)
          // Attempt to extract Google API's specific retry delay (e.g. "retryDelay":"24s")
          try {
            const errStr = typeof err === "string" ? err : (JSON.stringify(err) || err.message || "")
            const match = errStr.match(/"retryDelay"\s*:\s*"(\d+)s"/) || errStr.match(/retryDelay.*?(\d+)s/)
            if (match && match[1]) {
              const seconds = parseInt(match[1], 10)
              if (!isNaN(seconds) && seconds > 0) {
                // Wait the requested time + 1.5s buffer, capped at 30 seconds
                delay = Math.min((seconds + 1.5) * 1000, 30000)
                console.log(`[SYSTEM] Gemini API rate limit detected. Dynamic delay set to ${delay}ms (retryDelay: ${seconds}s)`)
              }
            }
          } catch (e) {
            // fallback to default delay
          }

          console.log(`[SYSTEM] Waiting ${delay}ms before retrying model ${model}...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }

      if (aiResponse) {
        break
      }
    }

    if (!aiResponse) {
      throw lastError || new Error("All AI processing models failed to respond.")
    }

    const responseText = aiResponse.text
    if (!responseText) {
      throw new Error("AI core returned empty processing matrix.")
    }

    const aiPayload = JSON.parse(responseText)
    const { transcription, actions } = aiPayload

    // 4a. Strict Intent Validation Filter — eliminates AI classification drift / ghost intents
    // The AI schema enforces structure, but Gemini can still over-classify (e.g. tagging a
    // task command as REQUEST_LEAVE). This layer validates each action against the actual
    // transcription before any database operation runs.
    const cleanText = transcription.toLowerCase()

    const finalizedActions: typeof actions = []
    for (const action of actions) {
      const { intent, data } = action

      if (intent === "CREATE_TASK") {
        // Must have a title AND the speech must contain task-creation vocabulary
        const hasTaskKeywords =
          cleanText.includes("task") || cleanText.includes("create") ||
          cleanText.includes("add") || cleanText.includes("build") ||
          cleanText.includes("make") || cleanText.includes("schedule")
        if (data?.title && hasTaskKeywords) {
          finalizedActions.push(action)
        }
      } else if (intent === "REQUEST_LEAVE") {
        // Must have leave-related vocabulary AND an extracted reason or leaveType
        const hasLeaveKeywords =
          cleanText.includes("leave") || cleanText.includes("holiday") ||
          cleanText.includes("time off") || cleanText.includes("emergency") ||
          cleanText.includes("sick") || cleanText.includes("vacation")
        if (hasLeaveKeywords && (data?.reason || data?.leaveType)) {
          finalizedActions.push(action)
        }
      }
      // UNKNOWN intents are intentionally dropped — no database write for noise
    }

    // If every action was filtered out, emit a single safe UNKNOWN audit entry
    if (finalizedActions.length === 0) {
      finalizedActions.push({
        intent: "UNKNOWN",
        data: { title: "Ambiguous Command", description: "Filtered by validation layer." },
      })
    }

    // 4b. Parallel DAG Execution Engine
    // Each intent produces two graph nodes:
    //   • db_N   — the entity write (Task or Leave). No dependencies → runs in parallel.
    //   • log_N  — the audit log entry. Depends on db_N (needs the entity ID).
    //
    // Wave 1: all db_N nodes fire simultaneously via Promise.allSettled()
    // Wave 2: all log_N nodes fire simultaneously once their db_N parents complete
    //
    // For a 2-intent command this reduces sequential round-trips from 4 to 2.
    const operationalResult = await prisma.$transaction(async (tx) => {
      const dagNodes: DAGNode[] = []

      finalizedActions.forEach((action: any, idx: number) => {
        const { intent, data } = action
        const dbNodeId  = `db_${idx}`
        const logNodeId = `log_${idx}`

        // Node A: write the primary entity (no upstream dependencies)
        dagNodes.push({
          id: dbNodeId,
          type: "database",
          dependencies: [],
          execute: async () => {
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
            return null // UNKNOWN — no entity write
          },
        })

        // Node B: write the audit log (depends on the entity write finishing first)
        dagNodes.push({
          id: logNodeId,
          type: "audit",
          dependencies: [dbNodeId],
          execute: async (_results) => {
            return tx.activityLog.create({
              data: {
                userId: userId,
                action: intent,
                voiceInput: transcription,
                intentJson: action,
                status: intent !== "UNKNOWN" ? "SUCCESS" : "FAILED",
              },
            })
          },
        })
      })

      // Fire the DAG — parallel waves replace the old sequential for-loop
      const { results: dagResults, failed } = await executeDag(dagNodes)

      if (failed.size > 0) {
        const firstError = [...failed.values()][0]
        throw firstError
      }

      // Build the response summary from the settled DAG results
      const results = finalizedActions.map((_: any, idx: number) => ({
        intent: finalizedActions[idx].intent,
        createdEntityId: dagResults.get(`db_${idx}`)?.id ?? null,
        logId: dagResults.get(`log_${idx}`)?.id ?? null,
      }))

      return { transcription, results }
    })

    // 5. Post-transaction webhook events (fire-and-forget, non-blocking)
    // Fires after any REQUEST_LEAVE is committed to the DB so that n8n can
    // trigger downstream notifications (Slack, email, etc.).
    // Silently skipped when webhooks are absent — never affects the response.
    const webhookUrl = process.env.N8N_LEAVE_WEBHOOK || process.env.N8N_WEBHOOK_URL
    if (webhookUrl) {
      operationalResult.results.forEach((result: any, idx: number) => {
        if (result.intent === "REQUEST_LEAVE" && result.createdEntityId) {
          const actionData = finalizedActions[idx]?.data ?? {}
          void fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "LEAVE_REQUESTED",
              userId,
              leaveId: result.createdEntityId,
              reason: actionData.reason ?? null,
              type: actionData.leaveType ?? "FULL_DAY",
              timestamp: new Date().toISOString(),
            }),
          })
            .then(() => console.log(`[WEBHOOK] n8n notified for leave: ${result.createdEntityId}`))
            .catch((err: Error) => console.warn("[WEBHOOK] n8n ping failed (non-fatal):", err.message))
        }
      })
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
