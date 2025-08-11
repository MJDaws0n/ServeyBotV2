/**
 * TCP client for talking to the AI
 * Allows communication between the AI and the server
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ quiet: true });

const ADDRESS = process.env.ADDRESS || 'localhost:9000';
const API_KEY = process.env.API_KEY || 'changeme';
const LOG_FILE = process.env.CLIENT_LOG_FILE || 'client.log';
const IMAGE_DIR = process.env.IMAGE_DIR || 'images';

/**
 * Logger class for writing logs to a file
 */
class Logger {
    /**
     * Log a message to the log file
     * @param {string} message
     */
    static log(message) {
        const timestamp = new Date().toISOString();
        fs.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`, err => {
            if (err) console.error('Log fail:', err);
        });
    }
    /**
     * Log an error to the log file
     * @param {string} message
     */
    static error(message) {
        this.log('ERROR: ' + message);
    }
}

/**
 * TCPClient class for handling connection and messaging
 */
class TCPClient {
    /**
     * @param {string} address - The server address (host:port or proxy)
     * @param {string} apiKey - The API key for authentication
     */
    constructor(address, apiKey) {
        this.address = address;
        this.apiKey = apiKey;
        this.socket = null;
        this.buffer = '';
        this.reconnectDelay = 2000; // 2 seconds between attempts
        this.maxReconnectDelay = 10000; // max 10 seconds
        this.reconnectAttempts = 0;
        this.shouldReconnect = true;
    }

    /**
     * Connect to the server
     * @param {function} onConnect - Callback when connected
     */
    connect(onConnect) {
        // Split address into host and port (if possible)
        let host = this.address;
        let port = 9000;
        if (this.address.includes(':')) {
            const parts = this.address.split(':');
            host = parts[0];
            port = parseInt(parts[1], 10);
        }
        Logger.log('Attempting to connect to server...');
        this.socket = net.createConnection({ host, port }, () => {
            Logger.log('Connected to server.');
            this.reconnectAttempts = 0;
            this.reconnectDelay = 2000;
            if (onConnect) onConnect();
        });
        this.socket.setEncoding('utf8');
        this.socket.on('data', data => {
            this.buffer += data;
            let boundary;
            while ((boundary = this.buffer.indexOf('\n')) !== -1) {
                const messageStr = this.buffer.slice(0, boundary);
                this.buffer = this.buffer.slice(boundary + 1);
                this.handleMessage(messageStr);
            }
        });
        this.socket.on('close', () => {
            Logger.log('Connection closed.');
            if (this.shouldReconnect) {
                this.scheduleReconnect(onConnect);
            }
        });
        this.socket.on('error', err => {
            Logger.error('Socket error: ' + err);
            if (this.shouldReconnect) {
                this.scheduleReconnect(onConnect);
            }
        });
    }

    /**
     * Schedule a reconnect attempt with exponential backoff
     * @param {function} onConnect
     */
    scheduleReconnect(onConnect) {
        this.reconnectAttempts++;
        // Exponential backoff, but capped
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        Logger.log(`Reconnecting in ${this.reconnectDelay / 1000} seconds... (attempt ${this.reconnectAttempts})`);
        setTimeout(() => {
            this.connect(onConnect);
        }, this.reconnectDelay);
    }


    /**
     * Handle incoming message from server
     * @param {string} messageStr - The message string
     */
    handleMessage(messageStr) {
        let message;
        try {
            message = JSON.parse(messageStr);
        } catch (err) {
            Logger.error('Failed to parse server message: ' + err);
            return;
        }
        Logger.log('Received message from server');
        if (message.image) {
            this.saveImage(message.image);
        }
        // Call the AI handler and send its response back to the server
        this.handleAI(message.text, IMAGE_DIR);
    }

    /**
     * Save the received image to the images directory
     * @param {string} base64Image - The base64-encoded image
     */
    saveImage(base64Image) {
        if (!fs.existsSync(IMAGE_DIR)) {
            fs.mkdirSync(IMAGE_DIR);
        }
        // Save as received.png for now, you can change this to something cooler
        const imagePath = path.join(IMAGE_DIR, 'received.png');
        try {
            fs.writeFileSync(imagePath, Buffer.from(base64Image, 'base64'));
            Logger.log('Saved image to ' + imagePath);
        } catch (err) {
            Logger.error('Failed to save image: ' + err);
        }
    }

    /**
     * Main AI handler function. Takes text and imageDir and talks to the ai to get an output
     * @param {string} text
     * @param {string} imageDir
     */
    handleAI(text, imageDir) {
        // This is where your AI logic goes. For now, just log and send a dummy response.
        Logger.log('AI handler called with text: ' + text + ' and imageDir: ' + imageDir);
        // Example: send a dummy response back to the server
        const response = {
            api_key: this.apiKey,
            text: 'Imagine this is the ai response from the input: ' + text
        };
        try {
            this.socket.write(JSON.stringify(response) + '\n');
            Logger.log('Sent AI response to server: ' + JSON.stringify(response));
        } catch (err) {
            Logger.error('Failed to send AI response: ' + err);
        }
    }
}

// Start the client and connect to the server
const client = new TCPClient(ADDRESS, API_KEY);
client.connect(() => {
    Logger.log('Client connected and ready to handle AI messages.');
});
