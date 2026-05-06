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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Missing GROQ_API_KEY environment variable' })
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
}
