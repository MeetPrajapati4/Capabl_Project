# 🌟 AskiFy AI

<div align="center">
  <img src="frontend/public/AskiFy_Logo.png" alt="AskiFy AI Logo" width="120" />

  ### Premium Academic Study Hub & Agentic RAG Platform
  **Engineered for Learners from Grade 6 to PhD Researchers**

  [![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Express.js](https://img.shields.io/badge/Express.js-4.21-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
  [![React](https://img.shields.io/badge/React-19.2-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
  [![Vite](https://img.shields.io/badge/Vite-7.3-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
  [![NVIDIA NIM](https://img.shields.io/badge/NVIDIA-NIM%20Catalog-76B900?style=for-the-badge&logo=nvidia&logoColor=white)](https://build.nvidia.com)
</div>

---

## 📚 Overview

**AskiFy AI** is a full-stack, production-grade academic research and study assistant. It combines a responsive glassmorphic user interface with high-throughput Retrieval-Augmented Generation (RAG) powered by the **NVIDIA NIM API catalog**.

Whether analyzing foundational textbook chapters or synthesizing complex peer-reviewed doctoral literature, AskiFy AI delivers instant answers, interactive study aids, structured learning roadmaps, and 3D visual knowledge exploration.

---

## ✨ Core Features

### 🗂️ Universal Academic Document RAG
Upload and query single or multi-volume academic documents with chunked processing and real-time indexing:
- **Supported Formats:** PDF (`.pdf`), Word (`.docx`, `.doc`), PowerPoint (`.pptx`, `.ppt`), Excel (`.xlsx`, `.xls`), Plain Text (`.txt`), and Markdown (`.md`).
- **Resilient Chunked Uploader:** Handles large multi-hundred-megabyte files via resilient chunking, SHA-256 verification, pause/resume, and background ingestion.
- **Precision Retrieval:** In-memory vector store with cosine similarity ranking and dynamic document context injection.

### 🧠 NVIDIA NIM AI Engine
- **Direct Cloud Inference:** Seamless integration with NVIDIA's enterprise NIM infrastructure via `https://integrate.api.nvidia.com`.
- **Low-Latency Streaming:** Server-Sent Events (SSE) with persistent HTTP keep-alive connections provide near-instant time-to-first-token (TTFT).
- **Graceful Error Handling:** Transparent detection of quota limits, expired keys, or safety warnings with actionable user guidance.

### 🎓 Interactive Study Hub Suite
Transform uploaded documents into active study assets with one click:
- **Smart Document Viewer:** Formatted multi-page reader with structured sections, extracted headings, and key points.
- **Interactive Flashcards:** Dynamic question-and-answer study cards with flip animations for spaced repetition.
- **Practice Quizzes:** Structured multiple-choice assessments with immediate scoring and educational rationales.
- **Learning Roadmaps:** Step-by-step milestone curricula organized by prerequisite difficulty.

### 🌐 3D Knowledge Space
- Interactive 3D visual canvas powered by **OGL** rendering real-time particle structures and ambient dynamics.

### 🎨 Modern Academic Interface
- **Glassmorphic Design:** Polished dark and light themes with smooth transitions and ergonomic spacing.
- **LaTeX Math Rendering:** Complete typesetting for inline `$...$` and display `$$...$$` mathematical formulas via KaTeX.
- **Code Highlighting & Copy:** Clean code block rendering with language badges and one-click clipboard copying.
- **Editable Chat Sessions:** Edit queries, duplicate responses, view cited sources, and track agent reasoning traces.

---

## 🏗️ Technology Stack

| Layer | Technologies |
|---|---|
| **Runtime** | **Node.js** (v18.0.0 or higher) |
| **Backend API** | **Express.js (v4.21)**, Multer, OfficeParser, Axios |
| **Frontend UI** | **React 19**, **Vite 7**, Framer Motion, Lucide Icons, OGL |
| **AI / LLM Cloud** | **NVIDIA NIM API** (`integrate.api.nvidia.com`) |
| **Personalization** | **@receptron/laya** (Local ONNX inference for learner intent adaptation) |
| **Styling & Theme** | Vanilla CSS Design System, Glassmorphic Tokens, Responsive Flex/Grid |

> **Note:** AskiFy AI is built entirely in **Node.js** and **React**. **No Python runtime, virtual environments, or pip packages are needed.**

---

## 🚀 Getting Started

Follow these steps to set up and run AskiFy AI on your local machine after cloning the repository.

### Prerequisites

Ensure you have the following installed on your computer:
- [Node.js](https://nodejs.org/) (Version **18.x** or higher)
- [Git](https://git-scm.com/)
- An internet connection for NVIDIA NIM API inference

---

### Step 1: Clone the Repository

Open your terminal or command prompt and clone the repository:

```bash
git clone https://github.com/MeetPrajapati4/AskiFy_AI.git
cd AskiFy_AI
```

---

### Step 2: Install Dependencies

Install all root backend dependencies and frontend React packages using the unified workspace script:

```bash
npm run install:all
```

*(Alternatively, run `npm install --legacy-peer-deps` in the root folder, then `cd frontend && npm install --legacy-peer-deps`).*

---

### Step 3: Get Your Free NVIDIA API Key

AskiFy AI uses the **NVIDIA NIM API** to provide fast and accurate academic responses. Every user must supply their own NVIDIA API key.

1. Navigate to the official NVIDIA API Catalog:  
   👉 **[https://build.nvidia.com](https://build.nvidia.com)**
2. Click **Sign In** (or **Create Account**). New accounts receive **1,000 free inference credits**.
3. Select any model (e.g., *Nemotron* or *MiniMax*) or open your profile settings.
4. Click **Get API Key** and generate a new key.
5. Copy your key to your clipboard (it starts with `nvapi-...`).

---

### Step 4: Configure Your Environment File (`.env`)

Create your local `.env` configuration file from the provided `.env.example` template:

**On Linux / macOS / Git Bash:**
```bash
cp .env.example .env
```

**On Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

**On Windows (Command Prompt):**
```cmd
copy .env.example .env
```

Now open `.env` in your text editor (VS Code, Notepad, etc.) and paste your personal NVIDIA API key:

```env
# ==============================================================================
# AskiFy AI — Environment Configuration
# ==============================================================================

# Paste your personal NVIDIA NIM API Key below:
NVIDIA_API_KEY=nvapi-your_actual_nvidia_key_here

# Server Port & Mode (Defaults work automatically)
PORT=7860
NODE_ENV=development
```

> 🔒 **Security Notice:** The `.env` file is strictly ignored by `.gitignore`. Your personal API key is never committed to Git or exposed in public repositories.

---

### Step 5: Start the Application

Start both the backend API server and the frontend client simultaneously with one command:

```bash
npm run dev:all
```

The script will automatically clean up any dangling port bindings and boot up:
- 🟢 **Frontend UI:** `http://localhost:5173`
- 🔵 **Backend API:** `http://localhost:7860`

Open your browser and navigate to:
```
http://localhost:5173
```

---

## 🛠️ Available Scripts

| Command | Description |
|---|---|
| `npm run dev:all` | Kills conflicting port processes and launches both backend (`nodemon`) and frontend (`vite`) in watch mode. |
| `npm run install:all` | Installs dependencies for both the root backend and the React frontend. |
| `npm run build` | Compiles and optimizes the frontend application into the `static_react/` directory for production deployment. |

---

## 📁 Repository Structure

```text
AskiFy-main/
├── .env.example             # Environment configuration template
├── .gitignore               # Ignored secrets, node_modules, and uploads
├── package.json             # Root package definition and dev:all orchestration
├── kill_ports.js            # Port conflict resolution utility (7860, 5173)
├── wait_backend.js          # Health check probe ensuring backend is live before frontend starts
│
├── app_api.js               # Express API server (uploads, chat, study hub, RAG endpoints)
├── config.js                # Server configuration & NVIDIA API key validation
├── ragEngine.js             # NVIDIA NIM API orchestration & response streaming
├── vectorStore.js           # Multi-format document chunking & vector search
├── documentLoader.js        # File parsers (PDF, DOCX, PPTX, XLSX, TXT, MD)
├── sanitizer.js             # Prompt and output sanitization
├── state.js                 # Shared in-memory document state
│
├── frontend/                # React 19 + Vite frontend
│   ├── src/
│   │   ├── components/      # Chat messages, Study Hub, 3D Canvas, Document Viewer
│   │   ├── services/        # Chunked uploader & streaming client
│   │   ├── config/          # UI tool configurations & provider metadata
│   │   ├── App.jsx          # Root application container & view manager
│   │   └── main.jsx         # React application entry point
│   ├── vite.config.js       # Vite configuration with API reverse proxy
│   └── package.json         # Frontend UI dependencies
│
└── data/                    # Local storage directory for uploads and cache
    └── uploads/             # Assembled user documents and chunk cache
```

---

## ❓ Frequently Asked Questions (FAQ)

### 1. Where do I get an NVIDIA API Key?
You can generate a free key at [https://build.nvidia.com](https://build.nvidia.com). Every free account includes 1,000 credits, which is sufficient for thousands of document queries and study sessions.

### 2. What happens if I forget to set `NVIDIA_API_KEY` in `.env`?
When you start the application or make a query, AskiFy AI will display a clear warning in the terminal and a descriptive prompt in the chat window directing you to add your key to `.env`.

### 3. Do I need Python installed?
**No.** The entire project is written in Node.js (backend) and React/Vite (frontend). No Python runtime, virtual environment, or pip packages are required.

### 4. What if port 7860 or 5173 is already in use?
The `npm run dev:all` script runs `kill_ports.js` first, which safely terminates dangling processes on ports 7860 and 5173 before launching.

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).

<div align="center">
  <sub>Built with ❤️ for Students, Educators, and Academic Researchers Worldwide.</sub>
</div>
