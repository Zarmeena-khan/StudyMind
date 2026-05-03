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

const callGemini = async (contents, modelName, apiKey) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`

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

const callGeminiWithRetry = async (contents, modelName, apiKey, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await callGemini(contents, modelName, apiKey)
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

const callGeminiWithFallback = async (contents, apiKey) => {
  let lastError = null

  for (const model of FALLBACK_MODELS) {
    try {
      console.log(`Trying model: ${model}`)
      return await callGeminiWithRetry(contents, model, apiKey)
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable' })
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

    const text = await callGeminiWithFallback(contents, GEMINI_API_KEY)
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
}
