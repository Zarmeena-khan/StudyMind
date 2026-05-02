import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const app = express()
const PORT = process.env.PORT || 4000
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash'

app.use(cors())
app.use(express.json({ limit: '2mb' }))

const JSON_PROMPT = {
  summary: (notes, language) => `You are an expert study assistant. Simplify the following notes into:\n1. ONE sentence TL;DR\n2. 5-7 key bullet points in simple language\n3. List of important terms with brief definitions\nRespond in JSON format:\n{\n  tldr: string,\n  keyPoints: string[],\n  terms: [{term: string, definition: string}]\n}\nIf student chose Urdu, respond in simple Roman Urdu.\n\nNotes:\n${notes}`,
  flashcards: (notes) => `Create 8-10 flashcards from these notes. Respond ONLY in JSON:\n[{question: string, answer: string}]\n\nNotes:\n${notes}`,
  quiz: (notes) => `Create 5 MCQ questions from these notes. Respond ONLY in JSON:\n[{question: string, options: [string], correct: string, explanation: string}]\n\nNotes:\n${notes}`
}

const parseJson = (text) => {
  try {
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch (error) {
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (match) {
      return JSON.parse(match[0])
    }
    throw error
  }
}

const callGemini = async (prompt) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200,
        topP: 0.95,
        topK: 40
      }
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Gemini request failed: ${body}`)
  }

  const json = await response.json()
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) throw new Error('Empty response from Gemini')

  return text.trim()
}

app.post('/api/notes', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY in .env.local' })
  }

  const { notes, language } = req.body

  if (!notes || !notes.trim()) {
    return res.status(400).json({ error: 'No notes were provided.' })
  }

  try {
    const summaryPrompt = JSON_PROMPT.summary(notes, language)
    const flashcardsPrompt = JSON_PROMPT.flashcards(notes)
    const quizPrompt = JSON_PROMPT.quiz(notes)

    const [summaryText, flashcardsText, quizText] = await Promise.all([
      callGemini(summaryPrompt),
      callGemini(flashcardsPrompt),
      callGemini(quizPrompt)
    ])

    const summary = parseJson(summaryText)
    const flashcards = parseJson(flashcardsText)
    const quiz = parseJson(quizText)

    res.json({ summary, flashcards, quiz })
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to generate study notes.' })
  }
})

const startServer = (port) => {
  app.listen(port, () => {
    console.log(`StudyMind API is running on http://localhost:${port}`)
  }).on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1
      console.warn(`Port ${port} is in use, trying ${nextPort}...`)
      startServer(nextPort)
    } else {
      console.error('Server failed to start:', error)
      process.exit(1)
    }
  })
}

startServer(PORT)