
// Core modules
const net = require('net');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');


// Load environment variables
dotenv.config({ quiet: true });
/**
 * Log file path, configurable via environment variable LOG_FILE
 * @type {string}
 */
const LOG_FILE = process.env.LOG_FILE || 'server.log';


/**
 * Logger utility for writing logs to file and console.
 */
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
 * Messenger class for handling connection, message, and disconnect events.
 * Users should assign callbacks using the provided methods.
 */
class Messenger {
	/**
	 * Called when a client disconnects.
	 * @param {net.Socket} socket
	 */
	disconnect = (socket) => {};
	/**
	 * Called when a message is received from a client.
	 * @param {Object} message
	 * @param {net.Socket} socket
	 */
	message = (message, socket) => {};
	/**
	 * Called when a client connects.
	 * @param {net.Socket} socket
	 */
	connect = (socket) => {};

	/**
	 * Set the callback for client connection.
	 * @param {(socket: net.Socket) => void} callback
	 */
	onConnect(callback) { this.connect = callback; }
	/**
	 * Set the callback for incoming messages.
	 * @param {(message: Object, socket: net.Socket) => void} callback
	 */
	onMessage(callback) { this.message = callback; }
	/**
	 * Set the callback for client disconnect.
	 * @param {(socket: net.Socket) => void} callback
	 */
	onDisconnect(callback) { this.disconnect = callback; }
}


/**
 * Handles sending messages to clients, optionally with images.
 */
class MessageHandler {
	/**
	 * Send a message to a client socket, optionally with an image.
	 * @param {net.Socket} socket - The client socket
	 * @param {string} text - The message text
	 * @param {string|null} imagePath - Path to image file (optional)
	 * @return {void}
	 */
	static send(socket, text, imagePath = null) {
		let imageData = null;
		if (imagePath) {
			try {
				if (fs.existsSync(imagePath)) {
					const imgBuffer = fs.readFileSync(imagePath);
					imageData = imgBuffer.toString('base64');
				} else {
					Logger.error(`Image not found: ${imagePath}`);
				}
			} catch (err) {
				Logger.error('Failed to read image: ' + err);
			}
		}
		const payload = {
			text,
			image: imageData,
			timestamp: new Date().toISOString()
		};
		try {
			socket.write(JSON.stringify(payload) + '\n');
			Logger.log('Sent message to client.');
		} catch (err) {
			Logger.error('Failed to send message: ' + err);
		}
	}
}


/**
 * TCPServer class for managing TCP connections and message handling.
 */
class TCPServer {
	/**
	 * Create a new TCPServer instance.
	 * @param {number} port - Port to listen on
	 * @param {string} apiKey - API key for client authentication
	 */
	constructor(port, apiKey) {
		this.port = port;
		this.apiKey = apiKey;
		this.messenger = new Messenger();
		this.server = net.createServer();
		this.clientSocket = null;
		this.setupServer();
	}

	/**
	 * Set up server event handlers for connection, data, and errors.
	 * @return {void}
	 */
	setupServer() {
		this.server.on('connection', socket => {
			Logger.log('Client connected.');
			this.messenger.connect(socket);
			this.clientSocket = socket;

			// Handle incoming messages
			socket.setEncoding('utf8');
			let buffer = '';
			socket.on('data', data => {
				buffer += data;
				let boundary;
				while ((boundary = buffer.indexOf('\n')) !== -1) {
					const messageStr = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 1);
					this.handleIncoming(messageStr, socket);
				}
				// Prevent buffer overflow
				if (buffer.length > 1024 * 1024) {
					Logger.error('Buffer overflow, resetting buffer.');
					buffer = '';
				}
			});
			socket.on('close', () => {
				Logger.log('Client disconnected.');
				this.messenger.disconnect();
				this.clientSocket = null;
			});
			socket.on('error', err => {
				Logger.error('Socket error: ' + err);
			});
		});
		this.server.on('error', err => {
			Logger.error('Server error: ' + err);
		});
	}

	/**
	 * Start the TCP server and begin listening for connections.
	 * @return {void}
	 */
	start() {
		this.server.listen(this.port, () => {
			Logger.log(`TCP server started on port ${this.port}.`);
		});
	}

	/**
	 * Handle incoming messages from clients.
	 * @param {string} messageStr - Raw message string
	 * @param {net.Socket} socket - Client socket
	 * @return {void}
	 */
	handleIncoming(messageStr, socket) {
		let message;
		try {
			message = JSON.parse(messageStr);
		} catch (err) {
			Logger.error('Failed to parse JSON: ' + err);
			return;
		}
		// Validate API key
		if (!message.api_key || message.api_key !== this.apiKey) {
			Logger.log('Rejected message with invalid API key.');
			socket.write(JSON.stringify({ error: 'Invalid API key.' }) + '\n');
			return;
		}
		delete message.api_key;
		Logger.log('Passing message to Messenger: ' + JSON.stringify(message));

		// Pass message to Messenger handler
		this.messenger.message(message, socket);
	}

	/**
	 * Send a message to the connected client.
	 * @param {string} text - Message text
	 * @param {string|null} imagePath - Path to image file (optional)
	 * @return {void}
	 */
	sendMessage(text, imagePath = null) {
		if (this.clientSocket) {
			MessageHandler.send(this.clientSocket, text, imagePath);
		} else {
			Logger.log('No client to send message to.');
		}
	}
}


// Export classes
exports.TCPServer = TCPServer;
exports.Logger = Logger;