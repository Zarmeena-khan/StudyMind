import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const app = express()
const PORT = 4000
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

app.use(cors({ origin: 'http://localhost:5173' }))
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

const FALLBACK_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const callGemini = async (contents, modelName) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents
    })
  })

  const json = await response.json()

  if (!response.ok) {
    const errorCode = json.error?.code
    const errorMessage = json.error?.message || 'Unknown error'
    const errorStatus = json.error?.status || ''

    if (errorCode === 429 || errorStatus === 'RESOURCE_EXHAUSTED') {
      throw new Error('QUOTA_EXCEEDED')
    }

    throw new Error(`Gemini API error: ${errorMessage}`)
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) throw new Error('Empty response from Gemini')

  return text.trim()
}

const callGeminiWithRetry = async (contents, modelName, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await callGemini(contents, modelName)
    } catch (error) {
      if (error.message === 'QUOTA_EXCEEDED') {
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000
          console.log(`Quota exceeded for ${modelName}, retrying in ${delay}ms...`)
          await sleep(delay)
          continue
        }
        throw error
      }
      throw error
    }
  }
}

const callGeminiWithFallback = async (contents) => {
  let lastError = null

  for (const model of FALLBACK_MODELS) {
    try {
      console.log(`Trying model: ${model}`)
      return await callGeminiWithRetry(contents, model)
    } catch (error) {
      console.log(`Model ${model} failed: ${error.message}`)
      lastError = error
      if (error.message !== 'QUOTA_EXCEEDED') {
        throw error
      }
    }
  }

  throw new Error('QUOTA_EXCEEDED')
}

app.post('/api/generate', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY in .env.local' })
  }

  const { content, type, mimeType } = req.body

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
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: content } },
          { text: instruction }
        ]
      }]
    }

    const text = await callGeminiWithFallback(contents)
    const result = parseJson(text)
    res.json(result)
  } catch (error) {
    if (error.message === 'QUOTA_EXCEEDED') {
      return res.status(429).json({
        error: 'Quota limit reached. Please try again in a few minutes.'
      })
    }
    res.status(500).json({ error: error.message || 'Unable to generate study notes.' })
  }
})

const startServer = (port) => {
  app.listen(port, () => {
    console.log(`StudyMind API is running on http://localhost:${port}`)
  }).on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the process using this port or update server.js to use a different port.`)
    } else {
      console.error('Server failed to start:', error)
    }
    process.exit(1)
  })
}

startServer(PORT)