import { Router } from 'express';
import { getDB } from '../lib/db.js';

const router = Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ── POST /api/conversations/:id/summary ───────────────────────
router.post('/:id/summary', requireAuth, async (req, res) => {
  const db = getDB();
  const conversationId = req.params.id;

  // Authorization
  const member = db.prepare(
    'SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?'
  ).get(conversationId, req.session.userId);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  // How many messages to summarize (sent from client)
  const limit = parseInt(req.body?.limit) || 50;
  const limitLabel = limit === 9999 ? 'all' : `last ${limit}`;

  // Load messages (limited or all)
  const messages = db.prepare(`
    SELECT m.content, u.name as sender_name, m.created_at, m.id
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `).all(conversationId, limit).reverse();

  if (messages.length === 0) {
    return res.status(400).json({ error: 'No messages to summarize' });
  }

  const transcript = messages
    .map((m) => `${m.sender_name}: ${m.content}`)
    .join('\n');

  // Return the last message ID so client can detect new messages since last summary
  const lastMessageId = messages[messages.length - 1].id;

  const prompt = `You are a strict AI assistant that analyzes student/team conversation transcripts.

CRITICAL RULES — follow these exactly:
1. Only extract information that is EXPLICITLY and CLEARLY stated. No inferences or assumptions.
2. If a name is not mentioned, write "Not specified" — do NOT guess from context.
3. If a deadline is not mentioned with a clear date/time, write "Not specified".
4. If something could be interpreted multiple ways, leave it out entirely.
5. Do NOT paraphrase or reword action items — use the actual words from the conversation.
6. Only list a decision if it was clearly agreed upon by both parties.
7. Open questions must be actual questions asked in the conversation that were not answered.

Conversation (${limitLabel} messages, ${messages.length} total):
${transcript}

Respond with ONLY a raw JSON object — no markdown, no explanation, no extra text:
{
  "summary": "1-2 sentence factual overview using only what is stated",
  "decisions": ["only explicitly agreed decisions, empty array if none"],
  "tasks": [
    {"assignee": "exact name from conversation or 'Not specified'", "task": "exact task as stated", "deadline": "exact deadline as stated or 'Not specified'"}
  ],
  "openQuestions": ["only actual unanswered questions from the conversation"],
  "meetingDetails": "exact meeting time/place if stated, otherwise null"
}`;

  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey || apiKey === 'your_google_ai_api_key_here') {
    return res.status(503).json({ error: 'AI service not configured. Add AI_API_KEY to .env' });
  }

  // Use explicit AI_PROVIDER env var, or fall back to key-format detection
  const provider = (process.env.AI_PROVIDER?.trim().toLowerCase()) || detectProvider(apiKey);
  console.log(`🤖  Using AI provider: ${provider} (key prefix: ${apiKey.substring(0, 8)}...)`);

  try {
    let rawText;

    if (provider === 'groq' || provider === 'openai' || provider === 'together') {
      rawText = await callOpenAICompatible(provider, apiKey, prompt);
    } else {
      rawText = await callGemini(apiKey, prompt);
    }

    // Parse JSON (strip accidental markdown fences)
    const jsonText = rawText.replace(/```json\n?|```\n?/g, '').trim();
    let summary;
    try {
      summary = JSON.parse(jsonText);
    } catch {
      console.error('Failed to parse AI response:', rawText);
      return res.status(502).json({ error: 'AI returned unexpected format. Try again.' });
    }

    res.json({ summary, messageCount: messages.length, lastMessageId, limit, provider });
  } catch (err) {
    console.error('Summary error:', err.message);
    res.status(500).json({ error: 'Failed to generate summary. Please try again.' });
  }
});

// ── Detect provider from API key prefix ───────────────────────
function detectProvider(key) {
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('sk-')) return 'openai';
  if (key.startsWith('AIzaSy')) return 'gemini';
  if (key.startsWith('together')) return 'together';
  // Default guess based on format
  return 'gemini';
}

// ── Groq / OpenAI-compatible call ─────────────────────────────
async function callOpenAICompatible(provider, apiKey, prompt) {
  const endpoints = {
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    together: 'https://api.together.xyz/v1/chat/completions',
  };

  const models = {
    groq: 'qwen/qwen3.8-27b',       // Fast, free, available on Groq
    openai: 'gpt-4o-mini',
    together: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
  };

  const response = await fetch(endpoints[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: models[provider],
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`${provider} API error (${response.status}):`, errText);
    throw new Error(`${provider} API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Gemini call ───────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error('Gemini API error:', response.status, errText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export default router;
