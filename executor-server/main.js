
// Browser automation client using Puppeteer
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { TCPServer, Logger } = require('./server');
const { createPrompt } = require('./prompt');


// Load environment variables
dotenv.config({ quiet: true });

const BROWSER_URL = process.env.BROWSER_URL || 'https://example.com';
const SESSION_COOKIE = process.env.SESSION_COOKIE || 'example_session_cookie_value';
const SESSION_IDENTITY = process.env.SESSION_IDENTITY || 'session';
const PORT = process.env.PORT || 9000;
const API_KEY = process.env.API_KEY || 'changeme';
const AI_LOG_FILE = process.env.AI_LOG_FILE || 'ai.log';

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


/**
 * BrowserClient handles browser automation and communication with the TCP server.
 */
class BrowserClient {
	/**
	 * Create a new BrowserClient.
	 * @param {string} url - The URL to open in the browser
	 * @param {string} sessionCookie - Session cookie value
     * @param {string} sessionCookieIdentity - Session cookie identity
	 */
	constructor(url, sessionCookie, sessionCookieIdentity) {
		this.url = url;
		this.sessionCookie = sessionCookie;
        this.sessionCookieIdentity = sessionCookieIdentity;
		this.browser = null;
		this.page = null;
		this._activePageListener = null;
        this.instanceNotes = [];
	}

	/**
	 * Start the browser, open the page, set cookie, and reload.
	 * @return {Promise<void>}
	 */
	async start() {
		Logger.log('Starting browser...');
		this.browser = await puppeteer.launch({ headless: false });
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

        // Wait 3 seconds
		await new Promise(resolve => setTimeout(resolve, 3000));
	}

	/**
	 * Take a screenshot of the current page and save to file.png.
	 * @return {Promise<void>}
	 */
	async takeScreenshot() {
		await this.page.screenshot({ path: 'file.png' });
	}

	/**
	 * Send a message and screenshot to the TCP server client.
	 * @param {TCPServer} server - The TCP server instance
	 * @return {Promise<void>}
	 */
	async sendToServer(server) {
		if (server.clientSocket && !server.clientSocket.destroyed) {
			server.sendMessage(createPrompt(this.instanceNotes), path.join(__dirname, 'file.png'));
			Logger.log('Request sent to AI client.');
		} else {
			Logger.log('No client connected. Message not sent.');
		}
	}

	/**
	 * Set up message handlers and trigger initial command if client is connected.
	 * @param {TCPServer} server - The TCP server instance
	 * @return {Promise<void>}
	 */
	async run(server) {
		server.messenger.onMessage(async (message, socket) => {
			await this.aiResponse(message, socket, server);
		});
		if (server.clientSocket && !server.clientSocket.destroyed) {
			await this.aiCommand(server);
		} else {
			server.messenger.onConnect(async () => {
				await this.aiCommand(server);
			});
		}
	}

	/**
	 * Take screenshot and send to server.
	 * @param {TCPServer} server - The TCP server instance
	 * @return {Promise<void>}
	 */
	async aiCommand(server) {
		await this.takeScreenshot();
		await this.sendToServer(server);
	}

	/**
	 * Handle AI response message from server.
	 * @param {Object} message - Message from server
	 * @param {net.Socket} socket - Client socket
	 * @param {TCPServer} server - The TCP server instance
	 * @return {Promise<void>}
	 */
	async aiResponse(message, socket, server) {
		Logger.log(`AI response received: ${message}`);
        AiLogger.log(`New instance`);

        // Update instance notes
        if(message.notes){
            AiLogger.log(`AI notes: ${message.notes}`);
        }
        if(message.instance) {
			this.instanceNotes.push(message.instance);
            AiLogger.log(`Instance notes: ${message.instance}`);
		}
        if(message.x && message.y && message.x !== 0 && message.y !== 0) {
            await this.clickAt(message.x, message.y);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if(message.input && message.input.trim().length > 0) {
            await this.type(message.input); // Don't trim as maybe it's purposeful idk
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if(message.scrolly && message.scrolly > 0) {
            await this.scrollDown(message.scrolly);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if(message.scrolly && message.scrolly < 0) {
            await this.scrollUp(-message.scrolly);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if(message.scrollx && message.scrollx < 0) {
            await this.scrollLeft(-message.scrollx);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if(message.scrollx && message.scrollx > 0) {
            await this.scrollRight(message.scrollx);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if(message.dragx && message.dragy && message.x && message.y) {
            await this.drag(message.x, message.y, message.dragx, message.dragy);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

		// For now just wait and repeat
		await new Promise(resolve => setTimeout(resolve, 1000));
		await this.aiCommand(server);
	}

	/**
	 * Click at coordinates (stub).
	 * @param {number} x - X coordinate
	 * @param {number} y - Y coordinate
	 * @return {Promise<void>}
	 */
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
	 * Scroll down by amount (stub).
	 * @param {number} amount - Amount to scroll
	 * @return {Promise<void>}
	 */

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
	 * Scroll up by amount (stub).
	 * @param {number} amount - Amount to scroll
	 * @return {Promise<void>}
	 */

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


// Create and start TCP server
const server = new TCPServer(PORT, API_KEY);
server.start();

// Start browser automation client
(async () => {
	const client = new BrowserClient(BROWSER_URL, SESSION_COOKIE, SESSION_IDENTITY);
	await client.start();
	await client.run(server);
})();
