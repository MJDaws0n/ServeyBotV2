
// Browser automation client using Puppeteer
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPrompt } = require('./prompt');
const https = require("https");


// Load environment variables
dotenv.config({ quiet: true });

const BROWSER_URL = process.env.BROWSER_URL || 'https://example.com';
const SESSION_COOKIE = process.env.SESSION_COOKIE || 'example_session_cookie_value';
const SESSION_IDENTITY = process.env.SESSION_IDENTITY || 'session';
const API_KEY = process.env.API_KEY || 'changeme';
const AI_MODEL = process.env.AI_MODEL || 'gpt-5-nano';
const AI_LOG_FILE = process.env.AI_LOG_FILE || 'ai.log';
const LOG_FILE = process.env.LOG_FILE || 'app.log';
const NAME = process.env.NAME || 'John Doe';
const GENDER = process.env.GENDER || 'Male';
const AGE = process.env.AGE || '25';
const ADDRESS = process.env.ADDRESS || '123 Main St, Anytown, USA';

class AiLogger {
    /**
     * Log a message to the log file with timestamp.
     * @param {string} message - Message to log
     * @return {void}
     */
    static log(message) {
        const timestamp = new Date().toISOString();
        fs.appendFile(AI_LOG_FILE, `[${timestamp}] ${message}\n`, err => {
            if (err) console.error('Failed to log:', err);
        });
    }

    /**
     * Log an error message to the log file.
     * @param {string} message - Error message
     * @return {void}
     */
    static error(message) {
        this.log('ERROR: ' + message);
    }
}
class Logger {
    /**
     * Log a message to the log file with timestamp.
     * @param {string} message - Message to log
     * @return {void}
     */
    static log(message) {
        const timestamp = new Date().toISOString();
        fs.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`, err => {
            if (err) console.error('Failed to log:', err);
        });
    }

    /**
     * Log an error message to the log file.
     * @param {string} message - Error message
     * @return {void}
     */
    static error(message) {
        this.log('ERROR: ' + message);
	}
}


/**
 * BrowserClient handles browser automation and communication with the TCP server.
 */
class BrowserClient {
	/**
	 * Create a new BrowserClient.
	 * @param {string} url - The URL to open in the browser
	 * @param {string} sessionCookie - Session cookie value
     * @param {string} sessionCookieIdentity - Session cookie identity
	 * @param {string} apikey - API key for authentication
	 * @param {string} model - AI model to use
	 */
	constructor(url, sessionCookie, sessionCookieIdentity, apikey, model, name, gender, age, address) {
		this.url = url;
		this.sessionCookie = sessionCookie;
        this.sessionCookieIdentity = sessionCookieIdentity;
		this.apikey = apikey;
		this.model = model;
		this.browser = null;
		this.page = null;
		this._activePageListener = null;
        this.instanceNotes = [];
		this.pause = false;
		this.name = name;
		this.gender = gender;
		this.age = age;
		this.address = address;
		this.imageBase64 = null;
	}

	/**
	 * Start the browser, open the page, set cookie, and reload.
	 * @return {Promise<void>}
	 */
	async start() {
		Logger.log('Starting browser...');
		this.browser = await puppeteer.launch({
			headless: false,
			args: ['--window-size=600,700'],
			defaultViewport: {
				width: 600,
				height: 600
			}
		});
		this.page = await this.browser.newPage();
		// Listen for new tabs/pages and switch active page
		this._activePageListener = async target => {
			if (target.type() === 'page') {
				const newPage = await target.page();
				if (newPage) {
					Logger.log('Switching to new active tab.');
					this.page = newPage;
				}
			}
		};
		this.browser.on('targetcreated', this._activePageListener);

        // Go to url
		await this.page.goto(this.url, { waitUntil: 'networkidle2' });

        // Set cookie
		await this.page.setCookie({ name: this.sessionCookieIdentity, value: this.sessionCookie, domain: new URL(this.url).hostname });

        // Go to url again
		await this.page.goto(this.url, { waitUntil: 'networkidle2' });
	}

	/**
	 * Take a screenshot of the current page and save to file.png.
	 * @return {Promise<void>}
	 */
	async takeScreenshot() {
		await this.page.screenshot({ path: 'file.png' });
		this.imageBase64 = fs.readFileSync('file.png', { encoding: 'base64' });
	}

	/**
	 * Set up message handlers and trigger initial command if client is connected.
	 * @return {Promise<void>}
	 */
	async run() {
		if(!this.pause){
			await this.takeScreenshot();
			await this.openAI();
		}
	}

	/**
	 * Send an API request to OpenAI.
	 * @return {Promise<void>}
	 */
	async openAI(){
		const data = JSON.stringify({
			model: this.model,
			input: [
				{
					role: "user",
					content: [
						{
							type: "input_text",
							text: createPrompt(this.instanceNotes, this.name, this.gender, this.age, this.address)
						},
						{
							type: "input_image",
							image_url: 'data:image/png;base64,' + this.imageBase64
						}
					]
				}
			],
			max_output_tokens: 6000
		});

		const options = {
			hostname: "api.openai.com",
			path: "/v1/responses",
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${this.apikey}`
			}
		};

		return new Promise((resolve, reject) => {
			const req = https.request(options, res => {
				let body = "";
				res.on("data", chunk => body += chunk);
				res.on("end", () => {
					try {
						console.log(JSON.parse(body));
						if(JSON.parse(body)['output']){
							this.aiResponse(JSON.parse(JSON.parse(body)['output'][1]['content'][0]['text']));
						} else{
							// Just a fail safe idk what went wrong
							this.aiResponse({ instance: 'No clickable object detected', x: 0, y: 0 });
						}
					} catch (err) {
						reject(err);
					}
				});
			});

			req.on("error", reject);
			req.write(data);
			req.end();
		});
	}

	/**
	 * Handle AI response message from server.
	 * @return {Promise<void>}
	 */
	async aiResponse(message) {
		AiLogger.log(`New instance`);
		AiLogger.log(`AI response received: ${JSON.stringify(message)}`);

        // Update instance notes
        if(message.notes){
            AiLogger.log(`AI notes: ${message.notes}`);
        }
        if(message.instance) {
			this.instanceNotes.push(message.instance);
            AiLogger.log(`Instance notes: ${message.instance}`);
		}
        if(message.x && message.y && message.x !== 0 && message.y !== 0) {
            await this.clickAt(message.x, parseInt(message.y)); // AI is always 74 pixels off on the height due to image scaling, it for some reason can't take it into account.
        }
        if(message.input && message.input.trim().length > 0) {
			await new Promise(resolve => setTimeout(resolve, 1000)); // Wait so that the click can be processed first
			await this.type(message.input); // Don't trim as maybe it's purposeful idk
        }
        if(message.scrolly && message.scrolly > 0) {
            await this.scrollDown(message.scrolly);
        }
        if(message.scrolly && message.scrolly < 0) {
            await this.scrollUp(-message.scrolly);
        }
        if(message.scrollx && message.scrollx < 0) {
            await this.scrollLeft(-message.scrollx);
        }
        if(message.scrollx && message.scrollx > 0) {
            await this.scrollRight(message.scrollx);
        }
        if(message.dragx && message.dragy && message.x && message.y) {
            await this.drag(message.x, message.y, message.dragx, message.dragy);
        }

		AiLogger.log(`Instance Terminated`);
		// Wait one second then re-run
		await new Promise(resolve => setTimeout(resolve, 1000));
		await this.run();
	}

	/**
	 * Click at specific screen coordinates using Puppeteer.
	 * @param {number} x - X coordinate
	 * @param {number} y - Y coordinate
	 * @return {Promise<void>}
	 */
	async clickAt(x, y) {
		if (!this.page) {
			Logger.error('No active page to click on.');
			return;
		}
		try {
			await this.page.mouse.click(x, y);
			Logger.log(`Clicked at (${x}, ${y}) on the page.`);
		} catch (err) {
			Logger.error(`Failed to click at (${x}, ${y}): ${err}`);
		}
	}

	/**
	 * Type out the input text with random delays per character, simulating human typing speed.
	 * Average speed: 250 chars/min, range: 100-300 chars/min.
	 * @param {string} text - Text to type
	 * @return {Promise<void>}
	 */
    async type(text) {
        if (!this.page) {
            Logger.error('No active page to type on.');
            return;
        }
        try {
            for (const char of text) {
                const charsPerMin = 100 + Math.floor(Math.random() * 201); // 100-300 cpm
                const delay = 60000 / charsPerMin;
                await this.page.keyboard.press(char);
                await new Promise(r => setTimeout(r, delay));
            }
            Logger.log(`Typed text: "${text}"`);
        } catch (err) {
            Logger.error(`Failed to type text: ${err}`);
        }
    }

	/**
	 * Scroll the page down by a given number of pixels.
	 * @param {number} amount - Number of pixels to scroll down
	 * @return {Promise<void>}
	 */
	async scrollDown(amount) {
		if (!this.page) {
			Logger.error('No active page to scroll down.');
			return;
		}
		try {
			await this.page.evaluate(y => window.scrollBy(0, y), amount);
		} catch (err) {
			Logger.error(`Failed to scroll down: ${err}`);
		}
	}

	/**
	 * Scroll the page up by a given number of pixels.
	 * @param {number} amount - Number of pixels to scroll up
	 * @return {Promise<void>}
	 */
	async scrollUp(amount) {
		if (!this.page) {
			Logger.error('No active page to scroll up.');
			return;
		}
		try {
			await this.page.evaluate(y => window.scrollBy(0, -y), amount);
		} catch (err) {
			Logger.error(`Failed to scroll up: ${err}`);
		}
	}

	/**
	 * Scroll the page left by a given number of pixels.
	 * @param {number} amount - Number of pixels to scroll left
	 * @return {Promise<void>}
	 */
	async scrollLeft(amount) {
		if (!this.page) {
			Logger.error('No active page to scroll left.');
			return;
		}
		try {
			await this.page.evaluate(x => window.scrollBy(-x, 0), amount);
		} catch (err) {
			Logger.error(`Failed to scroll left: ${err}`);
		}
	}

	/**
	 * Scroll the page right by a given number of pixels.
	 * @param {number} amount - Number of pixels to scroll right
	 * @return {Promise<void>}
	 */
	async scrollRight(amount) {
		if (!this.page) {
			Logger.error('No active page to scroll right.');
			return;
		}
		try {
			await this.page.evaluate(x => window.scrollBy(x, 0), amount);
		} catch (err) {
			Logger.error(`Failed to scroll right: ${err}`);
		}
	}


	/**
	 * Simulate mouse drag (click and hold) from start to end coordinates using Puppeteer.
	 * Works for sliders, drag-and-drop, etc.
	 * @param {number} startX - Start X
	 * @param {number} startY - Start Y
	 * @param {number} endX - End X
	 * @param {number} endY - End Y
	 * @return {Promise<void>}
	 */
	async slide(startX, startY, endX, endY) {
		if (!this.page) {
			Logger.error('No active page to perform slide.');
			return;
		}
		try {
			await this.page.mouse.move(startX, startY);
			await this.page.mouse.down();
            await new Promise(resolve => setTimeout(resolve, 500));
			await this.page.mouse.move(endX, endY, { steps: 40 });
			await this.page.mouse.up();
		} catch (err) {
			Logger.error(`Failed to perform slide from (${startX}, ${startY}) to (${endX}, ${endY}): ${err}`);
		}
	}
}

// Start browser automation client
(async () => {
	const client = new BrowserClient(BROWSER_URL, SESSION_COOKIE, SESSION_IDENTITY, API_KEY, AI_MODEL, NAME, GENDER, AGE, ADDRESS);
	await client.start();
	await client.run();
})();
