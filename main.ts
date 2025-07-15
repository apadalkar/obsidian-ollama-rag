import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

function cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dot / (normA * normB);
}

async function getNoteEmbedding(text: string): Promise<number[]> {
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
        new Notice('Text for embedding is empty or too short.');
        throw new Error('Text for embedding is empty or too short.');
    }
    try {
        const res = await fetch('http://127.0.0.1:11434/api/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nomic-embed-text',
                prompt: text
            })
        });
        const data: any = await res.json();
        if (!data || !Array.isArray(data.embedding)) {
            console.error('Ollama embedding response:', data);
            new Notice('Ollama did not return a valid embedding. See console for details.');
            throw new Error('Invalid embedding response from Ollama');
        }
        return data.embedding;
    } catch (err: any) {
        console.error('Embedding error:', err);
        new Notice('Failed to get embedding from Ollama: ' + (err?.message || err));
        throw err;
    }
}

async function getAICompletion(prompt: string): Promise<string> {
    try {
        console.log('Prompt sent to Ollama:', prompt);
        const res = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3',
                prompt: prompt
            })
        });

        if (!res.body) {
            throw new Error('No response body from Ollama');
        }

        // Ollama return NDJSON responses
        const reader = res.body.getReader();
        let decoder = new TextDecoder();
        let result = '';
        let done = false;

        while (!done) {
            const { value, done: doneReading } = await reader.read();
            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                // NDJSON: split by newlines, parse each line
                chunk.split('\n').forEach(line => {
                    if (line.trim()) {
                        try {
                            const data = JSON.parse(line);
                            if (data.response) result += data.response;
                        } catch (e) {
                            console.error('Failed to parse NDJSON chunk:', line, e);
                        }
                    }
                });
            }
            done = doneReading;
        }

        console.log('Ollama completion result:', result);
        return result;
    } catch (err: any) {
        console.error('Completion error:', err);
        new Notice('Failed to get completion from Ollama: ' + (err?.message || err));
        throw err;
    }
}

let embeddingIndex: { path: string, content: string, embedding: number[] }[] = [];

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;

    async onload() {
        await this.loadSettings();

        this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
            new Notice('This is a notice!');
        });
        const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
            new Notice('This is a notice!');
        });
        ribbonIconEl.addClass('my-plugin-ribbon-class');

        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.setText('Status Bar Text');

        this.addCommand({
            id: 'index-all-notes-for-ai',
            name: 'Index all notes for AI',
            callback: async () => {
                new Notice('Indexing all notes for AI...');
                embeddingIndex = [];
                const files = this.app.vault.getMarkdownFiles();
                for (const file of files) {
                    if (file.name.startsWith('Related Notes - ') || file.name.startsWith('AI Answer - ')) {
                        continue;
                    }
                    const content = await this.app.vault.read(file);
                    if (!content || content.length < 50) {
                        continue;
                    }
                    try {
                        const embedding = await getNoteEmbedding(content);
                        if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every(x => typeof x === 'number')) {
                            continue;
                        }
                        embeddingIndex.push({ path: file.path, content, embedding });
                    } catch (e) {
                        new Notice(`Embedding failed for ${file.path}`);
                    }
                }
                new Notice('Indexing complete!');
            }
        });

        this.addCommand({
            id: 'find-notes-relating-to',
            name: 'Find notes relating to:',
            callback: async () => {
                if (embeddingIndex.length === 0) {
                    new Notice('Please run "Index all notes for AI" first.');
                    return;
                }
                const query = await this.promptUser('Enter your query (e.g., high school):');
                if (!query) return;
                let queryEmbedding: number[];
                try {
                    queryEmbedding = await getNoteEmbedding(query);
                } catch (err) {
                    return;
                }
                const scored = embeddingIndex.map(n => ({
                    ...n,
                    score: cosineSimilarity(queryEmbedding, n.embedding)
                }));
                scored.sort((a, b) => b.score - a.score);
                const top = scored.slice(0, 10);
                let md = `# Top Related Notes for: ${query}\n\n`;
                top.forEach((n, i) => {
                    const fileName = n.path.replace(/\.md$/, '');
                    md += `## ${i+1}. [[${fileName}]] (Score: ${n.score.toFixed(2)})\n`;
                    md += `> ${n.content.slice(0, 200).replace(/\n/g, ' ')}...\n\n`;
                });
                try {
                    const file = await this.app.vault.create(
                        `Related Notes - ${query} - ${Date.now()}.md`,
                        md
                    );
                    new Notice('Related notes written to new file.');
                    await this.app.workspace.getLeaf(true).openFile(file);
                } catch (err) {
                    console.error('File creation error:', err);
                    new Notice('Failed to create related notes file. See console for details.');
                }
            }
        });

        this.addCommand({
            id: 'ask-ai-about-notes',
            name: 'Ask AI about my notes',
            callback: async () => {
                if (embeddingIndex.length === 0) {
                    new Notice('Please run "Index all notes for AI" first.');
                    return;
                }
                const question = await this.promptUser('Ask a question about your notes:');
                if (!question) return;
                let questionEmbedding: number[];
                try {
                    questionEmbedding = await getNoteEmbedding(question);
                } catch (err) {
                    return;
                }
                const scored = embeddingIndex.map(n => ({
                    ...n,
                    score: cosineSimilarity(questionEmbedding, n.embedding)
                }));
                scored.sort((a, b) => b.score - a.score);
                const top = scored.slice(0, 3);
                const context = top.map(n => `Note: ${n.path}\n${n.content}`).join('\n---\n');
                const prompt = `You are an assistant with access to my notes. Use the following notes to answer the question.\n\n${context}\n\nQuestion: ${question}\nAnswer:`;
                let answer: string;
                try {
                    answer = await getAICompletion(prompt);
                } catch (err) {
                    return;
                }
                let md = `# AI Answer to: ${question}\n\n`;
                md += `## Answer\n${answer}\n\n`;
                md += `## Top Relevant Notes\n`;
                top.forEach((n, i) => {
                    const fileName = n.path.replace(/\.md$/, '');
                    md += `### ${i+1}. [[${fileName}]] (Score: ${n.score.toFixed(2)})\n`;
                    md += `> ${n.content.slice(0, 200).replace(/\n/g, ' ')}...\n\n`
                });
                try {
                    const file = await this.app.vault.create(
                        `AI Answer - ${question} - ${Date.now()}.md`,
                        md
                    );
                    new Notice('AI answer written to new file.');
                } catch (err) {
                    console.error('File creation error:', err);
                    new Notice('Failed to create AI answer file. See console for details.');
                }
            }
        });
        
        this.addCommand({
            id: 'ai-agent-chat-organize-vault',
            name: 'AI Agent: Chat and Organize Vault',
            callback: () => {
                new AIAgentChatModal(this.app, this).open();
            }
        });

        this.addSettingTab(new SampleSettingTab(this.app, this));

        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            console.log('click', evt);
        });

        this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
    }

    onunload() {}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async promptUser(prompt: string): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = new InputModal(this.app, prompt, resolve);
            modal.open();
        });
    }
}

class InputModal extends Modal {
    prompt: string;
    onSubmit: (result: string | null) => void;
    constructor(app: App, prompt: string, onSubmit: (result: string | null) => void) {
        super(app);
        this.prompt = prompt;
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        //center text for prompt
        const promptDiv = contentEl.createEl('div', { cls: 'ai-modal-prompt' });
        promptDiv.createEl('h2', { text: this.prompt });

        const textarea = contentEl.createEl('textarea', { cls: 'ai-modal-textarea', placeholder: 'Type your request...' });
        textarea.rows = 3;
        textarea.style.width = '100%';
        textarea.focus();

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.onSubmit(textarea.value);
                this.close();
            }
        });
    }
    onClose() {
        this.onSubmit(null);
        this.contentEl.empty();
    }
}

class SampleSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Ollama RAG AI Plugin Usage' });
        containerEl.createEl('p', { text: 'This plugin lets you use a local AI model (Ollama) to search and ask questions about your notes using Retrieval Augmented Generation (RAG).' });
        containerEl.createEl('h3', { text: 'How to Use' });
        containerEl.createEl('ul', {});
        const ul = containerEl.querySelector('ul');
        if (ul) {
            [
                'Open the Command Palette (Cmd+P or Cmd+Shift+P).',
                'Run: "Index all notes for AI" (do this first after adding or changing notes).',
                'Run: "Find notes relating to..." or "Ask AI about my notes".',
                'Results will be written to a new markdown file in your vault.'
            ].forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                ul.appendChild(li);
            });
        }
        containerEl.createEl('h3', { text: 'Terminal Setup (Ollama)' });
        containerEl.createEl('pre', { text: 'brew install ollama\nollama serve\nollama pull nomic-embed-text\nollama pull llama3' });
        containerEl.createEl('h3', { text: 'Troubleshooting' });
        containerEl.createEl('ul', {});
        const ul2 = containerEl.querySelectorAll('ul')[1];
        if (ul2) {
            [
                'If you don\'t see the commands, make sure the plugin is enabled in Obsidian.',
                'If you add or change notes, re-run "Index all notes for AI" for best results.',
                'If you have issues with AI responses, check that Ollama is running and the model is pulled.'
            ].forEach(text => {
                const li = document.createElement('li');
                li.textContent = text;
                ul2.appendChild(li);
            });
        }
    }
}

class AIAgentChatModal extends Modal {
    plugin: Plugin;
    chatHistory: { role: 'user' | 'assistant', content: string }[] = [];
    container: HTMLElement;

    constructor(app: App, plugin: Plugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        this.container = this.contentEl;
        this.container.empty();
        this.renderChat();
    }

    renderChat() {
        this.container.empty();
        this.container.createEl('h2', { text: 'AI Agent Chat' });
        this.chatHistory.forEach(msg => {
            const div = this.container.createDiv({ cls: msg.role });
            div.createEl('b', { text: msg.role === 'user' ? 'You: ' : 'AI: ' });
            div.appendText(msg.content);
        });

        const input = this.container.createEl('input', { type: 'text', placeholder: 'Type your request...' });
        input.focus();
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
                const userMsg = input.value.trim();
                this.chatHistory.push({ role: 'user', content: userMsg });
                this.renderChat();
                input.value = '';
                await this.handleUserMessage(userMsg);
            }
        });
    }

async handleUserMessage(userMsg: string) {
        const systemPrompt = `
You are an assistant for Obsidian. When the user asks for a file or folder operation, respond ONLY with a JSON array of actions to perform. Each action should have a type (create_file, create_folder, delete_file, delete_folder, update_file), a path, and (for files) content. If the user just wants to chat, respond with a message only (no JSON). Example:

User: Create a folder for the album 'Abbey Road' and a file listing all its songs.
AI:
[
  {"type": "create_folder", "path": "Music/Abbey Road"},
  {"type": "create_file", "path": "Music/Abbey Road/Tracklist.md", "content": "# Abbey Road Tracklist\\n- Come Together\\n- Something"}
]

User: Delete the file Music/Abbey Road/Tracklist.md
AI:
[
  {"type": "delete_file", "path": "Music/Abbey Road/Tracklist.md"}
]

User: Hello!
AI:
Hello! How can I help you organize your notes today?

User: ${userMsg}
AI:
`;
// Send prompt to Ollama
        let aiResponse = '';
        try {
            aiResponse = await getAICompletion(systemPrompt);
        } catch (err) {
            this.chatHistory.push({ role: 'assistant', content: 'Error: Could not get a response from the AI.' });
            this.renderChat();
            return;
        }

        // Try to parse JSON from the response
        let actions: any[] = [];
        let message = '';
        try {
            const jsonStart = aiResponse.indexOf('[');
            const jsonEnd = aiResponse.lastIndexOf(']');
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const jsonString = aiResponse.slice(jsonStart, jsonEnd + 1);
                actions = JSON.parse(jsonString);
            } else {
                message = aiResponse.trim();
            }
        } catch (e) {
            message = aiResponse.trim();
        }

        // If actions found, execute them
        if (actions.length > 0) {
            let summary = '';
            for (const action of actions) {
                try {
                    if (action.type === 'create_folder') {
                        await this.plugin.app.vault.createFolder(action.path);
                        summary += `Created folder: ${action.path}\n`;
                    } else if (action.type === 'create_file') {
                        await this.plugin.app.vault.create(action.path, action.content || '');
                        summary += `Created file: ${action.path}\n`;
                    } else if (action.type === 'delete_file') {
                        const file = this.plugin.app.vault.getAbstractFileByPath(action.path);
                        if (file && file instanceof TFile) {
                            await this.plugin.app.vault.delete(file);
                            summary += `Deleted file: ${action.path}\n`;
                        }
                    } else if (action.type === 'delete_folder') {
                        const folder = this.plugin.app.vault.getAbstractFileByPath(action.path);
                        if (folder && folder instanceof TFolder) {
                            await this.plugin.app.vault.delete(folder, true);
                            summary += `Deleted folder: ${action.path}\n`;
                        }
                    } else if (action.type === 'update_file') {
                        const file = this.plugin.app.vault.getAbstractFileByPath(action.path);
                        if (file && file instanceof TFile) {
                            await this.plugin.app.vault.modify(file, action.content || '');
                            summary += `Updated file: ${action.path}\n`;
                        }
                    }
                } catch (err) {
                    summary += `Error with action on ${action.path}: ${err}\n`;
                }
            }
            this.chatHistory.push({ role: 'assistant', content: summary || 'No actions performed.' });
        } else if (message) {
            this.chatHistory.push({ role: 'assistant', content: message });
        } else {
            this.chatHistory.push({ role: 'assistant', content: 'No valid actions or message returned.' });
        }
        this.renderChat();
    }
}