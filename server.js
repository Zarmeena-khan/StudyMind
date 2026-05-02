import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const app = express()
const PORT = 3001
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

app.use(cors({ origin: 'http://localhost:5175' }))
app.use(express.json({ limit: '2mb' }))

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

const callGemini = async (contents) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents
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

app.post('/api/generate', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY in .env.local' })
  }

  const { content, type } = req.body

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'No content provided.' })
  }

  try {
    const instruction = `Analyze the following content and generate a study set in the exact JSON format below. Return only the JSON, no markdown or code blocks.

{
  "summary": {
    "tldr": "one sentence",
    "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"],
    "terms": [{"term": "word", "definition": "meaning"}]
  },
  "flashcards": [
    {"question": "Q?", "answer": "A."}
  ],
  "quiz": [
    {
      "question": "Q?",
      "options": ["A", "B", "C", "D"],
      "correct": "A",
      "explanation": "Because..."
    }
  ]
}`

    let contents = []

    if (type === 'text') {
      const userPrompt = instruction + `\n\nContent: ${content}`
      contents = [{
        parts: [{ text: userPrompt }]
      }]
    } else if (type === 'image') {
      contents = [{
        parts: [
          { inline_data: { mime_type: "image/jpeg", data: content } },
          { text: instruction }
        ]
      }]
    }

    const text = await callGemini(contents)
    const result = parseJson(text)
    res.json(result)
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