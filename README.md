# Obsidian Ollama RAG Plugin

This is an Obsidian Ollama RAG Plugin that brings AI-powered search, question answering, and local chat to your vault. Index your notes, query them semantically, and chat with an LLM — all running locally via LangChain + Ollama, with no cloud dependencies.

## Features
- **Index all notes for AI**: Chunks notes and builds an in-memory vector index for semantic search (LangChain MemoryVectorStore).
- **Find notes relating to...**: Retrieve the most relevant note chunks for a topic or phrase using embeddings.
- **Ask AI about my notes**: Retrieve top context from your notes and answer using a local LLM.
- **AI Agent: Chat and Organize Vault**: Prompt the model to complete desired tasks.

## How to Use
1. **Open the Command Palette** in Obsidian (`Cmd+P` or `Cmd+Shift+P`).
2. **Search for these commands:**
   - `Index all notes for AI`
   - `Find notes relating to...`
   - `Ask AI about my notes`
3. **Run the 'Index all notes for AI' command** to enable search and Q&A. Re-run after large edits or new notes.

## Terminal Setup (Ollama) 
1. **Install Ollama** (macOS):
   ```sh
   brew install ollama
   ```
2. **Start the Ollama server:** (Run everytime you need to access this plugin)
   ```sh
   ollama serve
   ```
3. **Pull required models:**
   ```sh
    ollama pull nomic-embed-text
    ollama pull llama3
   ```
   Both are required (embeddings + chat LLM).

## Troubleshooting
- If you don't see the commands, make sure the plugin is enabled in Obsidian.
- If you add or change notes, re-run `Index all notes for AI` for best results.
- If you have issues with AI responses, check that Ollama is running and the model is pulled.
- The index is in-memory. After restarting Obsidian, run `Index all notes for AI` again.

