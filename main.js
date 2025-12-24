// index.js (main browser client + AI orchestration)

const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const dotenv = require('dotenv');
const { createPrompt, createOpenRouterPrompt } = require('./prompt');  // Your AI prompt builder

dotenv.config({ quiet: true });

// Config from .env
const {
    BROWSER_URL,
    SESSION_COOKIE,
    SESSION_IDENTITY,
    OPENAI_KEY,
    OPENAI_MODEL = 'gpt-5-nano',
    OPENROUTER_KEY,
    OPENROUTER_MODEL = 'qwen/qwen2.5-vl-72b-instruct',
    AI_LOG_FILE = 'ai.log',
    LOG_FILE = 'app.log',
    NAME,
    GENDER,
    AGE,
    ADDRESS,
} = process.env;

// Simple logger
class Logger {
    static log(msg) {
        const time = new Date().toISOString();
        const line = `[${time}] ${msg}\n`;
        fs.appendFileSync(LOG_FILE, line);
        console.log(line.trim());
    }
    static error(msg) {
        this.log(`ERROR: ${msg}`);
    }
}
class AiLogger {
    static log(msg) {
        const time = new Date().toISOString();
        const line = `[${time}] ${msg}\n`;
        fs.appendFileSync(AI_LOG_FILE, line);
    }
}

// Utility delay
const delay = ms => new Promise(r => setTimeout(r, ms));

class BrowserClient {
    constructor() {
        this.browser = null;
        this.page = null;
        this.instanceNotes = [];
        this.pause = false;
        this.lastScreenshot = null;
        this.last2Screenshot = null;
        this.last3Screenshot = null;
        this.last4Screenshot = null;
    }

    async start() {
        Logger.log('Launching browser...');
        this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: { width: 1280, height: 800 },
            args: ['--window-size=1280,800'],
        });

        // Open the initial page
        this.page = await this.browser.newPage();

        // Set cookie on initial page
        const urlObj = new URL(BROWSER_URL);
        await this.page.setCookie({
            name: SESSION_IDENTITY,
            value: SESSION_COOKIE,
            domain: urlObj.hostname,
        });

        Logger.log(`Opening page: ${BROWSER_URL}`);
        await this.page.goto(BROWSER_URL, { waitUntil: 'networkidle2' });

        // Listen for targetchanged events to detect active tab change
        this.browser.on('targetchanged', async (target) => {
            if (target.type() !== 'page') return;

            let newPage;
            try {
                newPage = await target.page();
            } catch {
                return; // Page is gone or not accessible
            }
            if (!newPage || newPage.isClosed()) return;

            try {
                const isVisible = await newPage.evaluate(() => document.hasFocus());
                if (isVisible) {
                    Logger.log(`Active tab changed, updating this.page reference.`);
                    this.page = newPage;
                }
            } catch {
                // Page probably closed after getting the reference
            }
        });

        await this.page.evaluateOnNewDocument(() => {
            // The exact same IIFE code goes here:
            (function () {
                const textInputTypes = new Set([
                    'text', 'number', 'email', 'search', 'tel', 'url', 'password'
                ]);
                const clearedElements = new WeakSet();

                function clearIfNeeded(el) {
                    if (clearedElements.has(el)) return;
                    if (el.isContentEditable) {
                        el.innerHTML = '';
                    } else if (el.tagName === 'TEXTAREA') {
                        el.value = '';
                    } else if (el.tagName === 'INPUT' && textInputTypes.has(el.type)) {
                        el.value = '';
                    } else {
                        return;
                    }
                    clearedElements.add(el);
                }

                function onFocus(event) {
                    clearIfNeeded(event.target);
                }

                function onBlur(event) {
                    clearedElements.delete(event.target);
                }

                document.addEventListener('focus', onFocus, true);
                document.addEventListener('blur', onBlur, true);
            })();
        });
    }

    // Get page data for AI: HTML, text, screenshot base64
    async getPageData() {
        const html = await this.page.content();
        const text = await this.page.evaluate(() => document.body.innerText);
        const screenshotBuffer = await this.page.screenshot({ encoding: 'base64', fullPage: false });
        return { html, text, screenshotBase64: screenshotBuffer };
    }

    // Call GPT (OpenAI) for understanding the page and generating instructions
    async callGpt() {
        const p = await this.getPageData();
        const data = JSON.stringify(
            {
                model: OPENAI_MODEL,
                input: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: createPrompt(this.instanceNotes, NAME, GENDER, AGE, ADDRESS, p.html, p.text)
                            },
                            {
                                type: "input_image",
                                image_url: `data:image/png;base64,${this.lastScreenshot.toString('base64')}`
                            },
                            {
                                type: "input_image",
                                image_url: `data:image/png;base64,${this.last2Screenshot ? this.last2Screenshot.toString('base64') : this.lastScreenshot.toString('base64')}`
                            }
                        ]
                    }
                ],
                max_output_tokens: 5000
            }
        );
        return this.sendAIRequest('api.openai.com', '/v1/responses', OPENAI_KEY, data);
    }

    // Call OpenRouter for interaction
    async callOpenRouter(instruction) {
        const p = await this.getPageData();
        const data = JSON.stringify({
			model: OPENROUTER_MODEL,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: createOpenRouterPrompt(instruction)
						},
						{
							type: "image_url",
							image_url: {
								url: `data:image/png;base64,${this.lastScreenshot.toString('base64')}`
							}
						}
					]
				}
			],
			max_output_tokens: 6000
		});
        return this.sendAIRequest('openrouter.ai', '/api/v1/chat/completions', OPENROUTER_KEY, data);
    }

    // Generic POST request to OpenAI or OpenRouter
    async sendAIRequest(hostname, path, key, data) {
        const options = {
            hostname,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
        };
        return new Promise((resolve, reject) => {
            const req = https.request(options, res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        resolve(json);
                    } catch (err) {
                        reject(err);
                    }
                });
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    // Execute AI instructions on the browser page
    async executeInstructions(instruction) {
        if (!instruction) return;

        try {
            // Click
            if (instruction.x && instruction.y && instruction.x !== 0 && instruction.y !== 0 && !instruction.dragx && !instruction.dragy) {
                if (!this.page) {
                    Logger.error('No active page to click on.');
                } else {
                    try {
                        await this.page.mouse.click(instruction.x, parseInt(instruction.y));
                        Logger.log(`Clicked at (${instruction.x}, ${instruction.y}) on the page.`);
                    } catch (err) {
                        Logger.error(`Failed to click at (${instruction.x}, ${instruction.y}): ${err}`);
                    }
                }
            }

            // Type
            if (instruction.input && instruction.input.trim().length > 0) {
                await new Promise(r => setTimeout(r, 1000)); // wait for click to settle
                if (!this.page) {
                    Logger.error('No active page to type on.');
                } else {
                    try {
                        await this.page.type('', instruction.input, { delay: 0 });
                        Logger.log(`Typed text: "${instruction.input}"`);
                    } catch (err) {
                        Logger.error(`Failed to type text: ${err}`);
                    }
                }
            }

            // Scroll Y
            if (instruction.scrolly && instruction.scrolly !== '') {
                if (!this.page) {
                    Logger.error('No active page to scroll vertically.');
                } else {
                    try {
                        if (instruction.scrolly > 0) {
                            await this.page.evaluate(y => window.scrollBy(0, y), instruction.scrolly);
                        } else if (instruction.scrolly < 0) {
                            await this.page.evaluate(y => window.scrollBy(0, y), instruction.scrolly);
                        }
                    } catch (err) {
                        Logger.error(`Failed to scroll vertically: ${err}`);
                    }
                }
            }

            // Scroll X
            if (instruction.scrollx && instruction.scrollx !== '') {
                if (!this.page) {
                    Logger.error('No active page to scroll horizontally.');
                } else {
                    try {
                        await this.page.evaluate(x => window.scrollBy(x, 0), instruction.scrollx);
                    } catch (err) {
                        Logger.error(`Failed to scroll horizontally: ${err}`);
                    }
                }
            }

            // Drag/Slide
            if (instruction.dragx && instruction.dragy && instruction.x && instruction.y &&
                instruction.dragx !== 0 && instruction.dragy !== 0 &&
                instruction.dragx !== '' && instruction.dragy !== '') {
                if (!this.page) {
                    Logger.error('No active page to perform slide.');
                } else {
                    try {
                        await this.page.mouse.move(instruction.x, instruction.y);
                        await this.page.mouse.down();
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await this.page.mouse.move(instruction.dragx, instruction.dragy, { steps: 40 });
                        await this.page.mouse.up();
                    } catch (err) {
                        Logger.error(`Failed to perform slide from (${instruction.x}, ${instruction.y}) to (${instruction.dragx}, ${instruction.dragy}): ${err}`);
                    }
                }
            }

        } catch (err) {
            Logger.error(`Error executing instructions: ${err.message}`);
        }
    }

    // Main run loop
    async run() {
        if (this.pause) return;

        this.last4Screenshot = this.last3Screenshot;
        this.last3Screenshot = this.last2Screenshot;
        this.last2Screenshot = this.lastScreenshot;
        this.lastScreenshot = await this.page.screenshot();

        try {
            // Call GPT
            AiLogger.log('Sending prompt to GPT...');
            const gptResponse = await this.callGpt();
            AiLogger.log(`GPT response: ${JSON.stringify(gptResponse)}`);

            // Parse GPT response - expect JSON instructions
            let instructions;
            try {
                instructions = JSON.parse(gptResponse['output'][1]['content'][0]['text']);
            } catch {
                Logger.error('Failed to get GPT response.');
                instructions = null;

                // Create new instance
                await this.run();
                return;
            }

            // Save notes if any
            if (instructions?.notes) {
                this.instanceNotes.push(instructions.notes);
            }

            // Send instructions to OpenRouter
            if (instructions?.content) {
                AiLogger.log('Sending prompt to OpenRouter...');
                const response = await this.callOpenRouter(instructions.content);
                AiLogger.log(`OpenRouter response: ${JSON.stringify(response)}`);

                let execution;
                try {
                    console.log(response);
                    execution = JSON.parse(response['choices'][0]['message']['content']);
                } catch {
                    Logger.error('Failed to get OpenRouter response.');
                    execution = null;
                }

                // Execute instructions on the page
                if (execution) {
                    await this.executeInstructions(execution);
                }

                AiLogger.log('Instance terminated.');
                await delay(3000);

                // Repeat loop
                await this.run();
            }

            if(this.last4Screenshot === this.lastScreenshot) {
                Logger.log('Last 4 screenshots are identical. Reinitializing...');
                const { spawn } = require('child_process');
                const child = spawn(process.argv[0], process.argv.slice(1), {
                    detached: true,
                    stdio: 'inherit'
                });
                child.unref();
                process.exit(0);
            }

        } catch (err) {
            Logger.error(`Run loop error: ${err}`);
            await delay(5000);
            await this.run();
        }
    }
}

(async () => {
    const client = new BrowserClient();
    await client.start();
    await client.run();
})();