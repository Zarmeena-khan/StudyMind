import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'
import styles from './styles/App.module.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const inputTabs = [
  { id: 'paste', label: 'Text paste' },
  { id: 'pdf', label: 'PDF upload' },
  { id: 'image', label: 'Image upload' }
]

const outputTabs = [
  { id: 'summary', label: 'Summary' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'quiz', label: 'Quiz' }
]

const statusPulses = ['AI is reading your notes', 'AI is refining the summary', 'AI is building your study set']

function App() {
  const [language, setLanguage] = useState('English')
  const [inputTab, setInputTab] = useState('paste')
  const [outputTab, setOutputTab] = useState('summary')
  const [rawText, setRawText] = useState('')
  const [inputType, setInputType] = useState('text')
  const [inputData, setInputData] = useState('')
  const [imageType, setImageType] = useState('image/jpeg')
  const [summary, setSummary] = useState(null)
  const [flashcards, setFlashcards] = useState([])
  const [quiz, setQuiz] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Paste your notes to begin')
  const [error, setError] = useState('')
  const [pdfName, setPdfName] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [flashIndex, setFlashIndex] = useState(0)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [quizIndex, setQuizIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [score, setScore] = useState(0)
  const [quizComplete, setQuizComplete] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedTerm, setSelectedTerm] = useState(null)
  const [currentPulse, setCurrentPulse] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentPulse((value) => (value + 1) % statusPulses.length)
    }, 2400)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (flashcards.length && flashIndex >= flashcards.length) {
      setFlashIndex(flashcards.length - 1)
    }
  }, [flashcards, flashIndex])

  useEffect(() => {
    if (quiz.length && quizIndex >= quiz.length) {
      setQuizIndex(quiz.length - 1)
    }
  }, [quiz, quizIndex])

  useEffect(() => {
    const handleKey = (event) => {
      if (outputTab !== 'flashcards') return
      if (event.key === 'ArrowRight') {
        setFlashIndex((value) => Math.min(value + 1, flashcards.length - 1))
        setCardFlipped(false)
      }
      if (event.key === 'ArrowLeft') {
        setFlashIndex((value) => Math.max(value - 1, 0))
        setCardFlipped(false)
      }
      if (event.key === ' ') {
        event.preventDefault()
        setCardFlipped((value) => !value)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [outputTab, flashcards.length])

  const handleTextChange = (event) => {
    setRawText(event.target.value)
    setInputType('text')
    setInputData(event.target.value)
  }

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const extractPdfText = async (file) => {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise
    let output = ''

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex)
      const content = await page.getTextContent()
      const pageText = content.items.map((item) => item.str).join(' ')
      output += `${pageText}\n\n`
    }

    return output.trim()
  }

  const handlePdfFile = async (file) => {
    try {
      setError('')
      setLoading(true)
      setStatus('Extracting PDF text…')
      const text = await extractPdfText(file)
      setRawText(text)
      setInputType('text')
      setInputData(text)
      setPdfName(file.name)
      setStatus('PDF notes ready to summarize')
    } catch (err) {
      setError('Unable to parse PDF. Please try a different file.')
    } finally {
      setLoading(false)
    }
  }

  const handleImageFile = async (file) => {
    try {
      setError('')
      setLoading(true)
      setStatus('Processing image…')
      const dataUrl = await fileToDataUrl(file)
      const base64 = dataUrl.split(',')[1]
      setImagePreview(dataUrl)
      setInputType('image')
      setInputData(base64)
      setImageType(file.type || 'image/jpeg')
      setRawText('Image uploaded, ready to generate study set.')
      setStatus('Image ready to summarize')
    } catch (err) {
      setError('Could not process the image.')
    } finally {
      setLoading(false)
    }
  }

  const processFileDrop = async (file) => {
    if (!file) return
    if (inputTab === 'pdf' && file.type === 'application/pdf') {
      await handlePdfFile(file)
      return
    }
    if (inputTab === 'image' && file.type.startsWith('image/')) {
      await handleImageFile(file)
      return
    }
    setError('Please drop a valid PDF or image file for this input type.')
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    await processFileDrop(file)
  }

  const handleFileChange = async (event) => {
    const file = event.target.files[0]
    await processFileDrop(file)
  }

  const handleSubmit = async () => {
    if (!inputData.trim()) {
      setError('Add your notes first to generate the study guide.')
      setStatus('Paste your notes to begin')
      return
    }

    try {
      setLoading(true)
      setError('')
      setStatus('AI is reading your notes…')
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: inputData, type: inputType, mimeType: imageType })
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Failed to generate notes. Please try again.')
      }

      const data = await response.json()
      setSummary(data.summary)
      setFlashcards(Array.isArray(data.flashcards) ? data.flashcards : [])
      setQuiz(Array.isArray(data.quiz) ? data.quiz : [])
      setOutputTab('summary')
      setFlashIndex(0)
      setCardFlipped(false)
      setQuizIndex(0)
      setSelectedAnswer(null)
      setFeedback('')
      setScore(0)
      setQuizComplete(false)
      setSelectedTerm(null)
      setStatus('Your premium study set is ready')
    } catch (err) {
      setError(err.message)
      setStatus('Unable to generate study notes')
    } finally {
      setLoading(false)
    }
  }

  const copyNotes = async () => {
    await navigator.clipboard.writeText(rawText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const currentFlash = flashcards[flashIndex] || {}
  const quizItem = quiz[quizIndex] || {}
  const quizProgress = quiz.length ? Math.round(((quizIndex + 1) / quiz.length) * 100) : 0

  const handleAnswer = (option) => {
    if (selectedAnswer) return
    setSelectedAnswer(option)
    const correct = quizItem.correct
    if (option === correct) {
      setScore((value) => value + 1)
      setFeedback('Correct! ' + quizItem.explanation)
    } else {
      setFeedback(`Not quite. ${quizItem.explanation}`)
    }
    if (quizIndex === quiz.length - 1) {
      setQuizComplete(true)
    }
  }

  const nextQuizItem = () => {
    if (quizIndex < quiz.length - 1) {
      setQuizIndex((value) => value + 1)
      setSelectedAnswer(null)
      setFeedback('')
    } else {
      setQuizComplete(true)
    }
  }

  const resetQuiz = () => {
    setQuizIndex(0)
    setSelectedAnswer(null)
    setFeedback('')
    setScore(0)
    setQuizComplete(false)
  }

  return (
    <div className={styles.app}>
      <div className={styles.heroBar} />
      <header className={styles.header}>
        <div>
          <div className={styles.brand}>
            <span className={styles.brandDot} />
            <span>StudyMind</span>
          </div>
          <p className={styles.tagline}>Turn your notes into knowledge</p>
        </div>
        <button
          type="button"
          className={styles.langButton}
          onClick={() => setLanguage((value) => (value === 'English' ? 'Urdu' : 'English'))}
        >
          {language}
        </button>
      </header>

      <main className={styles.mainGrid}>
        <section className={styles.leftPanel}>
          <div className={styles.panelHeader}>
            <p className={styles.panelLabel}>Input</p>
            <div className={styles.tabBar}>
              {inputTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`${styles.tabButton} ${inputTab === tab.id ? styles.activeTab : ''}`}
                  onClick={() => setInputTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.inputPanel}>
            {inputTab === 'paste' && (
              <div className={styles.pasteArea}>
                <textarea
                  value={rawText}
                  onChange={handleTextChange}
                  placeholder="Paste your notes here..."
                  className={styles.textarea}
                />
                <div className={styles.metaBar}>
                  <span>{rawText.length} characters</span>
                  <button type="button" onClick={copyNotes} className={styles.copyButton}>
                    {copied ? 'Copied' : 'Copy notes'}
                  </button>
                </div>
              </div>
            )}

            {(inputTab === 'pdf' || inputTab === 'image') && (
              <div
                className={styles.dropZone}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <div>
                  <span className={styles.dropTitle}>Drag & drop {inputTab === 'pdf' ? 'PDF' : 'image'} here</span>
                  <p className={styles.dropText}>Or click to upload a file from your device.</p>
                  <input
                    type="file"
                    accept={inputTab === 'pdf' ? 'application/pdf' : 'image/*'}
                    onChange={handleFileChange}
                    className={styles.fileInput}
                  />
                </div>
                {inputTab === 'pdf' && pdfName && <p className={styles.sourceLabel}>Loaded: {pdfName}</p>}
                {inputTab === 'image' && imagePreview && (
                  <img src={imagePreview} alt="Uploaded note" className={styles.imagePreview} />
                )}
              </div>
            )}

            <div className={styles.controlsRow}>
              <button type="button" className={styles.primaryButton} onClick={handleSubmit} disabled={loading}>
                Generate study set
              </button>
              <span className={styles.statusText}>{loading ? 'AI is reading your notes…' : status}</span>
            </div>

            {error && <p className={styles.errorText}>{error}</p>}
          </div>

          <div className={styles.quickPreview}>
            <h3 className={styles.previewTitle}>Raw note preview</h3>
            <p className={styles.previewCopy}>{rawText ? `${rawText.slice(0, 220)}${rawText.length > 220 ? '...' : ''}` : 'Your note text will appear here once you paste or upload content.'}</p>
          </div>
        </section>

        <section className={styles.rightPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelLabel}>Output</p>
              <p className={styles.panelHint}>Review by summary, flashcards, or quiz.</p>
            </div>
            <div className={styles.tabBar}>
              {outputTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`${styles.tabButton} ${outputTab === tab.id ? styles.activeTab : ''}`}
                  onClick={() => setOutputTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.outputPanel}>
            {loading && (
              <div className={styles.loadingState}>
                <div className={styles.loadingPulse} />
                <p>{statusPulses[currentPulse]}<span className={styles.dotPulse}>.</span><span className={styles.dotPulse}>.</span><span className={styles.dotPulse}>.</span></p>
              </div>
            )}

            {!loading && !summary && (
              <div className={styles.emptyState}>
                <div className={styles.emptyShape} />
                <h2>Paste your notes to begin</h2>
                <p>Generate a distraction‑free summary, flashcards, and quiz in one study session.</p>
              </div>
            )}

            {!loading && summary && outputTab === 'summary' && (
              <div className={styles.summaryView}>
                <div className={styles.summaryHeader}>
                  <p className={styles.shortline}>TL;DR</p>
                  <h2 className={styles.summaryTitle}>{summary.tldr}</h2>
                  <span className={styles.readTime}>Estimated read time: {Math.max(1, Math.ceil((summary.tldr.length + summary.keyPoints.join(' ').length) / 180))} min</span>
                </div>

                <div className={styles.keyList}>
                  {summary.keyPoints.map((point, index) => (
                    <div key={index} className={styles.keyPoint}>
                      <span>{index + 1}</span>
                      <p>{point}</p>
                    </div>
                  ))}
                </div>

                <div className={styles.termsGrid}>
                  {summary.terms.map((item) => (
                    <div key={item.term} className={styles.termChip} onClick={() => setSelectedTerm(selectedTerm?.term === item.term ? null : item)}>
                      <strong>{item.term}</strong>
                    </div>
                  ))}
                </div>

                {selectedTerm && (
                  <div className={styles.termDefinition}>
                    <strong>{selectedTerm.term}</strong>: {selectedTerm.definition}
                  </div>
                )}
              </div>
            )}

            {!loading && summary && outputTab === 'flashcards' && (
              <div className={styles.flashcardView}>
                <div className={styles.flashHeader}>
                  <div>
                    <p className={styles.shortline}>Flashcard deck</p>
                    <h3>Review the key concepts</h3>
                  </div>
                  <div>
                    <span className={styles.cardCounter}>{flashIndex + 1} of {flashcards.length}</span>
                    <div className={styles.flashProgress}>
                      <div className={styles.flashProgressBar} style={{ width: `${((flashIndex + 1) / flashcards.length) * 100}%` }} />
                    </div>
                  </div>
                </div>

                <div className={styles.deckContainer}>
                  <div className={styles.cardStack}>
                    {flashcards.slice(flashIndex + 1, flashIndex + 3).reverse().map((item, index) => (
                      <div key={index} className={styles.stackCard} style={{ transform: `translateY(${12 + index * 8}px) scale(${0.94 - index * 0.02})` }} />
                    ))}
                    <div
                      className={`${styles.flashCard} ${cardFlipped ? styles.flipped : ''}`}
                      onClick={() => setCardFlipped((value) => !value)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => event.key === 'Enter' && setCardFlipped((value) => !value)}
                    >
                      <div className={styles.flashCardInner}>
                        <div className={styles.flashFront}>
                          <p className={styles.cardLabel}>Question</p>
                          <p>{currentFlash.question || 'Your flashcard will appear here.'}</p>
                        </div>
                        <div className={styles.flashBack}>
                          <p className={styles.cardLabel}>Answer</p>
                          <p>{currentFlash.answer || 'Tap the card to reveal the answer.'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles.flashControls}>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => {
                        setFlashIndex((i) => Math.max(i - 1, 0))
                        setCardFlipped(false)
                      }}
                      disabled={flashIndex === 0}
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => {
                        setFlashIndex((i) => Math.min(i + 1, flashcards.length - 1))
                        setCardFlipped(false)
                      }}
                      disabled={flashIndex === flashcards.length - 1}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!loading && summary && outputTab === 'quiz' && (
              <div className={styles.quizView}>
                <div className={styles.quizHeader}>
                  <div>
                    <p className={styles.shortline}>Quiz mode</p>
                    <h3>One question at a time</h3>
                  </div>
                  <div className={styles.scoreBadge}>Score: {score}</div>
                </div>

                <div className={styles.quizProgress}>
                  <div className={styles.quizProgressBar} style={{ width: `${quizProgress}%` }} />
                </div>

                {quizComplete ? (
                  <div className={styles.quizResult}>
                    <h2>{score >= quiz.length / 2 ? 'Excellent work' : 'Keep practicing'}</h2>
                    <p>You scored {score} out of {quiz.length}. {score >= quiz.length / 2 ? 'You are building strong recall.' : 'Try another round to strengthen the concepts.'}</p>
                    <div className={styles.resultActions}>
                      <button type="button" className={styles.primaryButton} onClick={resetQuiz}>Retry</button>
                      <button type="button" className={styles.secondaryButton} onClick={() => { resetQuiz(); setOutputTab('summary') }}>New quiz</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.questionCard}>
                    <div className={styles.questionMeta}>Question {quizIndex + 1} / {quiz.length}</div>
                    <h4>{quizItem.question || 'Your quiz will appear here once the AI generates it.'}</h4>
                    <div className={styles.optionGrid}>
                      {(quizItem.options || []).map((option) => {
                        const correct = selectedAnswer && option === quizItem.correct
                        const wrong = selectedAnswer && option === selectedAnswer && selectedAnswer !== quizItem.correct
                        return (
                          <button
                            key={option}
                            type="button"
                            className={`${styles.optionCard} ${correct ? styles.correctOption : ''} ${wrong ? styles.wrongOption : ''}`}
                            onClick={() => handleAnswer(option)}
                            disabled={Boolean(selectedAnswer)}
                          >
                            {option}
                          </button>
                        )
                      })}
                    </div>
                    {feedback && <p className={styles.answerFeedback}>{feedback}</p>}
                    <div className={styles.quizActions}>
                      <button type="button" className={styles.secondaryButton} onClick={nextQuizItem} disabled={!selectedAnswer}>
                        Continue
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
