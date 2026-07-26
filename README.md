# 🌟 AskiFy AI

<div align="center">
  <img src="frontend/public/AskiFy_Logo.png" alt="AskiFy AI Logo" width="120" />

  ### Premium Academic Study Hub & RAG Assistant

  A modern AI-powered academic platform for document-based learning, smart study workflows, and fast RAG interactions.

  [![React](https://img.shields.io/badge/React-19.2.0-20232A?style=for-the-badge&logo=react)](https://react.dev/)
  [![Vite](https://img.shields.io/badge/Vite-7.3.1-646CFF?style=for-the-badge&logo=vite)](https://vite.dev/)
  [![Python](https://img.shields.io/badge/Python-3.13-3776AB?style=for-the-badge&logo=python)](https://www.python.org/)
  [![Flask](https://img.shields.io/badge/Flask-3.1.0-000000?style=for-the-badge&logo=flask)](https://flask.palletsprojects.com/)
  [![LangChain](https://img.shields.io/badge/LangChain-RAG-1C3C3C?style=for-the-badge)](https://www.langchain.com/)
</div>

---

## 📚 Overview

**AskiFy AI** is a premium academic assistant designed to help students and educators learn faster from uploaded content. It combines a polished glassmorphic interface with document-aware AI workflows powered by Google Gemma 3 and LangChain-based RAG.

It is built for:
- Document-based question answering
- Smart notes and study material generation
- Flashcards and quiz creation
- Guided academic roadmaps
- Clean and interactive learning experiences

---

## ✨ Features

### 🗂️ Advanced Document RAG
Upload, process, and query multiple file formats, including:

- PDF
- DOCX
- PPTX
- XLSX
- TXT
- MD
- SVG
- JPG / PNG / WEBP

### 🧠 Agentic AI Experience
The platform supports a more structured AI workflow with:
- Multi-step reasoning flow
- Tool and event awareness
- Source and citation aggregation
- Context-aware academic assistance

### 🎓 Study Hub Tools
Turn raw learning material into interactive academic resources:

- **Smart Document Viewer** — Formats extracted text into readable headings, paragraphs, and lists
- **Interactive Flashcards** — Generates study cards from uploaded content
- **Interactive Quizzes** — Creates MCQ-based assessments with grading and explanations
- **Learning Roadmaps** — Builds milestone-based study plans for topics and syllabi

### 🌓 Modern UI Experience
- Dark and light theme support
- Smooth transitions
- Responsive glassmorphic layout
- Clean academic workspace design

---

## 🏗️ Tech Stack

### Backend
- **Flask** — Lightweight and fast API layer
- **LangChain** — LLM orchestration and RAG pipeline handling
- **FAISS** — In-memory vector search for fast retrieval
- **Sentence Transformers** — Local embedding generation for semantic search

### Frontend
- **React 19** — Component-based UI architecture
- **Vite** — Fast development server and optimized build setup
- **Vanilla CSS** — Custom styling without heavy UI dependencies
- **Custom Typography & Glassmorphism** — Premium visual design language

---

## ⚡ Performance Optimizations

AskiFy AI is optimized for fast response times and smooth study interactions.

### 🔌 Connection Reuse
Backend engines such as `study_engine` and `chat_engine` are cached in Flask global state to reduce repeated connection overhead.

### 🔑 Token Control
Different tasks use controlled `max_tokens` settings to improve speed and keep outputs focused.

### 🧬 In-Memory Retrieval
FAISS runs in memory for near-instant document chunk retrieval and lower latency during academic queries.

---

## 🎨 UI/UX Highlights

| Feature | Description |
|--------|-------------|
| 📁 Navigation History | Sidebar for uploaded files and recent sessions |
| 🎓 Expanded Study Hub | Large side panel for notes, roadmaps, flashcards, and quizzes |
| 💡 Quick Actions | One-click prompts like Explain Topic, Compare, Solve Question, Study Plan, and Summarize |
| 🌓 Theme Support | Smooth dark/light switching for a better reading experience |

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/MeetPrajapati4/AskiFy_AI.git
cd AskiFy_AI
```

### 2. Start the backend

Open a terminal in the project root:

```powershell
# Activate virtual environment
.\venv\Scripts\activate

# Install backend dependencies
pip install -r requirements.txt
```

Backend runs at:
```text
http://localhost:7860
```

### 3. Start the frontend

Open another terminal:

```powershell
cd frontend

# Install frontend dependencies
npm install

# Run development server
cd ..
npm run dev:all
```

Frontend runs at:
```text
http://localhost:5173
```

---

## 🧪 Testing

Run the backend test suite with:

```powershell
venv\Scripts\activate
venv\Scripts\pytest
```

---

## 📁 Project Focus

AskiFy AI is designed to improve the academic workflow by combining:
- intelligent document interaction,
- fast retrieval-augmented generation,
- structured study tools,
- and a premium user experience.

---

## ❤️ Built For

<div align="center">
  Students • Educators • Self-Learners
</div>
