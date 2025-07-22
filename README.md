# Obsidian Ollama RAG Plugin

This is an Obsidian Ollama RAG Plugin that brings AI-powered search, question answering, and local chat to your vault. Index your notes, query them semantically, and chat with an LLM, all running locally through Ollama, with no cloud dependencies.

## Features
- **Index all notes for AI**: Prepares your notes for AI-powered search and Q&A.
- **Find notes relating to...**: Find the most relevant notes for a topic or phrase.
- **Ask AI about my notes**: Ask questions and get answers using your notes and a local AI model.
- **AI Agent: Chat and Organize Vault**: Prompt the model to complete desired tasks.

## How to Use
1. **Open the Command Palette** in Obsidian (`Cmd+P` or `Cmd+Shift+P`).
2. **Search for these commands:**
   - `Index all notes for AI`
   - `Find notes relating to...`
   - `Ask AI about my notes`
3. **Run the 'Index all notes for AI' command** to use the other features. For search or Q&A, you'll be prompted for input.

## Terminal Setup (Ollama) 
1. **Install Ollama** (macOS):
   ```sh
   brew install ollama
   ```
2. **Start the Ollama server:** (Run everytime you need to access this plugin)
   ```sh
   ollama serve
   ```
3. **Pull a model (e.g., llama3):**
   ```sh
   ollama pull llama3
   ```

## Troubleshooting
- If you don't see the commands, make sure the plugin is enabled in Obsidian.
- If you add or change notes, re-run `Index all notes for AI` for best results.
- If you have issues with AI responses, check that Ollama is running and the model is pulled.

