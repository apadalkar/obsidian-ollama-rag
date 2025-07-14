import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

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
            throw new Error('Invalid embedding response from Ollama');
        }
        return data.embedding;
    } catch (err) {
        console.error('Embedding error:', err);
        new Notice('Failed to get embedding from Ollama. See console for details.');
        throw err;
    }
}

async function getAICompletion(prompt: string): Promise<string> {
    try {
        const res = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3',
                prompt: prompt
            })
        });
        const data: any = await res.json();
        if (!data || typeof data.response !== 'string') {
            throw new Error('Invalid completion response from Ollama');
        }
        return data.response;
    } catch (err) {
        console.error('Completion error:', err);
        new Notice('Failed to get completion from Ollama. See console for details.');
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
            name: 'Find notes relating to...',
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
                    md += `### ${i+1}. ${n.path} (Score: ${n.score.toFixed(2)})\n`;
                    md += `> ${n.content.slice(0, 200).replace(/\n/g, ' ')}...\n\n`;
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
        contentEl.createEl('h2', { text: this.prompt });
        const input = contentEl.createEl('input', { type: 'text' });
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.onSubmit(input.value);
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
