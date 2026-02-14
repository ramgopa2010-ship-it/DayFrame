/**
 * Firebase Cloud Functions (Gen 2) + Gemini (Google GenAI) schedule generator
 */

const {setGlobalOptions} = require("firebase-functions/v2");
const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const {defineSecret} = require("firebase-functions/params");
const {GoogleGenAI} = require("@google/genai");

setGlobalOptions({maxInstances: 10});

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/**
 * Safely parse JSON from text, cleaning common formatting issues.
 * @param {string} text - The text to parse as JSON.
 * @return {Object} Parse result with ok, value, error, and cleaned properties.
 */
function safeJsonParse(text) {
  // Remove common fenced blocks if Gemini adds them
  const cleaned = String(text || "")
      .replace(/```json/gi, "```")
      .replace(/```/g, "")
      .trim();

  try {
    return {ok: true, value: JSON.parse(cleaned), cleaned};
  } catch (e) {
    return {ok: false, error: e, cleaned};
  }
}

/**
 * Generates a daily schedule using Gemini AI based on tasks, wake/sleep times.
 * Expects POST request with JSON body: { tasks: array, wakeTime?: string,
 * sleepTime?: string }.
 * @param {Object} req - HTTP request object.
 * @param {Object} res - HTTP response object.
 */
exports.generateSchedule = onRequest(
    {secrets: [GEMINI_API_KEY]},
    async (req, res) => {
    // --- CORS ---
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }
      if (req.method !== "POST") {
        return res.status(405).json({error: "Use POST"});
      }

      try {
        const {tasks, wakeTime, sleepTime} = req.body || {};

        if (!Array.isArray(tasks) || tasks.length === 0) {
          return res.status(400).json({
            error: "tasks must be a non-empty array",
          });
        }

        // Optional: basic shape validation (keeps Gemini prompt clean)
        // Rewritten without optional chaining for broader compatibility
        const normalizedTasks = tasks.map((t, i) => {
          const taskName = t && t.name ? t.name : `Task ${i + 1}`;
          const taskDifficulty = t && t.difficulty !== undefined ?
          Number(t.difficulty) :
          3;
          const taskSkill = t && t.skill !== undefined ?
          Number(t.skill) :
          3;
          const taskMinutes = t && t.minutes !== undefined ?
          Number(t.minutes) :
          undefined;

          return {
            name: String(taskName),
            difficulty: Number.isFinite(taskDifficulty) ?
            taskDifficulty :
            3,
            skill: Number.isFinite(taskSkill) ? taskSkill : 3,
            minutes: Number.isFinite(taskMinutes) ?
            taskMinutes :
            undefined,
          };
        });

        const prompt = [
          "You are a scheduling assistant.",
          "Create a realistic day schedule with times.",
          "Return STRICT JSON only (no markdown, no extra text).",
          "",
          "Inputs:",
          `- Wake time: ${wakeTime || "07:00"}`,
          `- Sleep time: ${sleepTime || "22:30"}`,
          `- Tasks (array): ${JSON.stringify(normalizedTasks)}`,
          "",
          "Rules:",
          "- Add short breaks (5-10 min) between big tasks",
          "- If difficulty is high, add more break time",
          "- Prefer deep-work blocks for high difficulty tasks",
          "- Include meals if the schedule spans typical meal times",
          "- Keep all times between wake and sleep",
          "",
          "Output JSON format EXACTLY:",
          "{",
          "  \"schedule\": [",
          "    {",
          "      \"start\":\"HH:MM\",",
          "      \"end\":\"HH:MM\",",
          "      \"label\":\"...\",",
          "      \"type\":\"task|break|meal\"",
          "    }",
          "  ],",
          "  \"notes\": [\"...\"]",
          "}",
        ].join("\n").trim();

        const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY.value()});
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [{text: prompt}],
            },
          ],
        });

        // Extract text from result
        let text = result && typeof result.text === "string" ? result.text : "";

        if (!text) {
        // Fallback extraction if needed
          if (
            result &&
          result.candidates &&
          result.candidates[0] &&
          result.candidates[0].content &&
          Array.isArray(result.candidates[0].content.parts)
          ) {
            text = result.candidates[0].content.parts
                .map((p) => (p && p.text ? p.text : ""))
                .join("");
          }
        }

        if (!text) {
          return res.status(500).json({
            error: "No text returned from Gemini",
          });
        }

        const parsed = safeJsonParse(text);

        if (!parsed.ok) {
        // Return raw so you can debug prompt/output without losing data
          return res.status(200).json({
            warning: "Model did not return valid JSON. Returning raw text.",
            raw: text,
            cleaned: parsed.cleaned,
          });
        }

        return res.status(200).json(parsed.value);
      } catch (err) {
        logger.error(err);
        return res.status(500).json({error: String(err)});
      }
    },
);

/**
 * Simple hello world endpoint for testing.
 * @param {Object} req - HTTP request object.
 * @param {Object} res - HTTP response object.
 */
exports.helloWorld = onRequest((req, res) => {
  logger.info("Hello logs!", {structuredData: true});
  res.send("Hello from Firebase!");
});
