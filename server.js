import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const app = express()
const PORT = 4000

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

const callGroqText = async (prompt, apiKey) => {
  const url = 'https://api.groq.com/openai/v1/chat/completions'

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are StudyMind AI. Return ONLY valid JSON, no markdown, no backticks.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  })

  const json = await response.json()

  if (!response.ok) {
    const errorMessage = json.error?.message || 'Unknown error'
    throw new Error(`Groq API error: ${errorMessage}`)
  }

  const text = json.choices?.[0]?.message?.content

  if (!text) throw new Error('Empty response from Groq')

  return text.trim()
}

const callGroqVision = async (prompt, base64Image, apiKey) => {
  const url = 'https://api.groq.com/openai/v1/chat/completions'

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  })

  const json = await response.json()

  if (!response.ok) {
    const errorMessage = json.error?.message || 'Unknown error'
    throw new Error(`Groq API error: ${errorMessage}`)
  }

  const text = json.choices?.[0]?.message?.content

  if (!text) throw new Error('Empty response from Groq')

  return text.trim()
}

app.post('/api/generate', async (req, res) => {
  const GROQ_API_KEY = process.env.GROQ_API_KEY

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Missing GROQ_API_KEY in .env.local' })
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

    let text

    if (type === 'text') {
      const prompt = instruction + `\n\nContent: ${content}`
      text = await callGroqText(prompt, GROQ_API_KEY)
    } else if (type === 'image') {
      text = await callGroqVision(instruction, content, GROQ_API_KEY)
    }

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
      console.error(`Port ${port} is already in use. Stop the process using this port or update server.js to use a different port.`)
    } else {
      console.error('Server failed to start:', error)
    }
    process.exit(1)
  })
}

startServer(PORT)