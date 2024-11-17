// tg.js

/**
 * Telegram Module
 * 
 * Handles sending and updating messages on Telegram for admin and users.
 */

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');
const { 
    formatAdminMessage, 
    formatUserMessage, 
    prepareBalancesForDisplay, 
    calculatePercentageChange 
} = require('./tga');

class TelegramModule {
    constructor() {
        this.bot = null;
        this.config = null;
        this.adminMessageId = null;
        this.adminChat = null;
        this.userMessages = {};
        this.users = [];
        this.configPath = path.resolve('config.json');
        this.updateInProgress = false;
        this.balances = {};
        this.pnlConfig = null;
        this.MAX_FAILURES = 5; // Increased threshold for consecutive failures

        // To track last message content to prevent redundant edits
        this.lastAdminMessage = null;
        this.lastUserMessages = {}; // { userId: lastMessageContent }

        // To track retry counts for admin and users
        this.retryAdminCount = 0;
        this.retryUserCounts = {}; // { userId: retryCount }

        // Queue to serialize edit operations
        this.editQueue = [];
        this.isProcessingQueue = false;
    }

    /**
     * Initializes the Telegram module with the provided configurations.
     * @param {Object} tgConfig - The Telegram-specific configuration object.
     * @param {Object} pnlConfig - The PNL (Profit and Loss) configuration object.
     */
    async initialize(tgConfig, pnlConfig) {
        this.config = tgConfig;
        this.pnlConfig = pnlConfig || {}; // Accessing top-level pnl

        if (!tgConfig || !tgConfig.enabled) {
            // Telegram module is disabled or missing configuration
            return;
        }

        const { token, adminChat, adminMessageId, userMessages, users } = tgConfig;

        if (!token || !adminChat) {
            console.error('Telegram configuration is missing required fields: token, adminChat.');
            return;
        }

        this.adminChat = adminChat;
        this.adminMessageId = adminMessageId;
        this.users = users || [];
        this.userMessages = userMessages || {};

        // Initialize userMessages for all users if not present
        this.users.forEach(user => {
            if (!this.userMessages[user.id]) {
                this.userMessages[user.id] = { messageId: null, failureCount: 0 };
                this.lastUserMessages[user.id] = null;
                this.retryUserCounts[user.id] = 0;
            }
        });

        this.bot = new TelegramBot(token, { polling: false });

        await this.initializeAdminMessage();
        await this.initializeUserMessages();
        this.startScheduler();
    }

    /**
     * Initializes the admin message by editing an existing message or sending a new one.
     */
    async initializeAdminMessage() {
        if (this.adminMessageId && typeof this.adminMessageId === 'number') {
            try {
                // Attempt to edit the existing admin message
                await this.enqueueEdit(() => this.bot.editMessageText('Initializing bot...', {
                    chat_id: this.adminChat,
                    message_id: this.adminMessageId,
                    parse_mode: 'Markdown',
                }));
                this.lastAdminMessage = 'Initializing bot...';
            } catch (error) {
                // Handle failure to edit the message
                await this.handleEditFailure('admin', null, error);
            }
        } else {
            // Send a new admin message if messageId is not present
            await this.sendAdminMessage();
        }
    }

    /**
     * Sends a new admin message and updates the configuration with the new message ID.
     */
    async sendAdminMessage() {
        try {
            const sentMessage = await this.bot.sendMessage(this.adminChat, 'Initializing bot...', { parse_mode: 'Markdown' });
            this.adminMessageId = sentMessage.message_id;
            this.lastAdminMessage = 'Initializing bot...';
            await this.updateConfig({ adminMessageId: this.adminMessageId });
        } catch (error) {
            console.error('Error sending admin message:', error.message);
        }
    }

    /**
     * Initializes user messages by editing existing messages or sending new ones.
     */
    async initializeUserMessages() {
        for (const user of this.users) {
            const { id } = user;
            const messageInfo = this.userMessages[id] || { messageId: null, failureCount: 0 };

            if (messageInfo.messageId && typeof messageInfo.messageId === 'number') {
                try {
                    // Attempt to edit the existing user message
                    await this.enqueueEdit(() => this.bot.editMessageText('Initializing bot...', {
                        chat_id: id,
                        message_id: messageInfo.messageId,
                        parse_mode: 'Markdown',
                    }));
                    this.lastUserMessages[id] = 'Initializing bot...';
                } catch (error) {
                    // Handle failure to edit the message
                    await this.handleEditFailure('user', id, error);
                }
            } else {
                // Send a new user message if messageId is not present
                await this.sendUserMessage(user);
            }
        }
    }

    /**
     * Sends a new message to a user and updates the configuration with the new message ID.
     * @param {Object} user - The user object containing at least the `id` field.
     */
    async sendUserMessage(user) {
        try {
            const { id } = user;
            const sentMessage = await this.bot.sendMessage(id, 'Initializing bot...', { parse_mode: 'Markdown' });
            this.userMessages[id] = { messageId: sentMessage.message_id, failureCount: 0 };
            this.lastUserMessages[id] = 'Initializing bot...';
            await this.updateConfig({ userMessages: this.userMessages });
        } catch (error) {
            console.error(`Error sending message for user ID ${id}:`, error.message);
        }
    }

    /**
     * Updates the configuration file with the provided updates.
     * @param {Object} updates - The updates to apply to the `tg` section of the config.
     */
    async updateConfig(updates) {
        try {
            const configData = await fs.readFile(this.configPath, 'utf8');
            const config = JSON.parse(configData);
            config.tg = { ...config.tg, ...updates };
            await fs.writeFile(this.configPath, JSON.stringify(config, null, 4), 'utf8');
        } catch (error) {
            console.error('Error updating config:', error.message);
        }
    }

    /**
     * Starts the scheduler to periodically update messages at exact 10-second intervals.
     */
    startScheduler() {
        if (!this.scheduler) {
            this.scheduleNextRun();
        }
    }

    /**
     * Schedules the next run of message updates at the next exact 10-second interval.
     */
    scheduleNextRun() {
        const now = new Date();
        const next = new Date(now);
        next.setMilliseconds(0); // Reset milliseconds
        const seconds = now.getSeconds();
        const nextSeconds = seconds + (10 - (seconds % 10)) % 10; // Calculate next multiple of 10
        next.setSeconds(nextSeconds);

        const delay = next - now;
        setTimeout(async () => {
            await this.updateMessages();
            this.scheduleNextRun(); // Schedule subsequent runs every 10 seconds
        }, delay);
    }

    /**
     * Updates both admin and user messages with the latest balances.
     */
    async updateMessages() {
        if (this.updateInProgress) return; // Prevent overlapping updates
        this.updateInProgress = true;

        try {
            if (this.balances && Object.keys(this.balances).length > 0) {
                this.balances = prepareBalancesForDisplay(this.balances, this.pnlConfig);
                await this.updateAdminMessage();
                await this.updateUserMessages();
            }
        } catch (error) {
            console.error('Error updating messages:', error.message);
        } finally {
            this.updateInProgress = false;
        }
    }

    /**
     * Updates the admin message by editing the existing message or handling failures.
     */
    async updateAdminMessage() {
        const formattedMessage = formatAdminMessage(this.balances);

        // Check if the new message is different from the last one
        if (this.lastAdminMessage === formattedMessage) {
            // No changes detected, skip editing
            return;
        }

        if (!this.adminMessageId) {
            await this.sendAdminMessage();
            return;
        }

        try {
            await this.enqueueEdit(() => this.bot.editMessageText(formattedMessage, {
                chat_id: this.adminChat,
                message_id: this.adminMessageId,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }));
            this.lastAdminMessage = formattedMessage; // Update the last message content
            this.retryAdminCount = 0; // Reset retry count on success
        } catch (error) {
            if (this.isMessageNotFoundError(error)) {
                await this.handleEditFailure('admin', null, error);
            } else if (this.isTooManyRequestsError(error)) {
                const retryAfter = this.getRetryAfter(error);
                if (retryAfter) {
                    if (this.retryAdminCount < this.MAX_FAILURES) {
                        this.retryAdminCount += 1;
                        setTimeout(() => this.updateAdminMessage(), retryAfter * 1000);
                    } else {
                        // Exceeded max retries, handle as failure
                        await this.handleEditFailure('admin', null, error);
                        this.retryAdminCount = 0;
                    }
                } else {
                    // No retry after specified, treat as failure
                    await this.handleEditFailure('admin', null, error);
                }
            } else {
                console.error(`Error editing admin message (ID: ${this.adminMessageId}):`, error.message);
            }
        }
    }

    /**
     * Updates all user messages by editing existing messages or handling failures.
     */
    async updateUserMessages() {
        for (const user of this.users) {
            const { id, share, pool } = user;
            const messageInfo = this.userMessages[id] || { messageId: null, failureCount: 0 };
            const retryCount = this.retryUserCounts[id] || 0;

            if (!messageInfo.messageId) {
                await this.sendUserMessage(user);
                continue;
            }

            const poolBalances = this.balances[pool];
            if (!poolBalances) {
                // No balances found for the specified pool
                continue;
            }

            const userBalance = poolBalances.total * share || 0;
            const percentageChange = calculatePercentageChange(user.balance, userBalance);
            const formattedMessage = formatUserMessage(userBalance, percentageChange);

            // Check if the new message is different from the last one
            if (this.lastUserMessages[id] === formattedMessage) {
                // No changes detected, skip editing
                continue;
            }

            try {
                await this.enqueueEdit(() => this.bot.editMessageText(formattedMessage, {
                    chat_id: id,
                    message_id: messageInfo.messageId,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                }));
                this.lastUserMessages[id] = formattedMessage; // Update the last message content
                this.retryUserCounts[id] = 0; // Reset retry count on success
            } catch (error) {
                if (this.isMessageNotFoundError(error)) {
                    await this.handleEditFailure('user', id, error);
                } else if (this.isTooManyRequestsError(error)) {
                    const retryAfter = this.getRetryAfter(error);
                    if (retryAfter) {
                        if ((this.retryUserCounts[id] || 0) < this.MAX_FAILURES) {
                            this.retryUserCounts[id] = (this.retryUserCounts[id] || 0) + 1;
                            setTimeout(() => this.updateUserMessagesForUser(id), retryAfter * 1000);
                        } else {
                            // Exceeded max retries, handle as failure
                            await this.handleEditFailure('user', id, error);
                            this.retryUserCounts[id] = 0;
                        }
                    } else {
                        // No retry after specified, treat as failure
                        await this.handleEditFailure('user', id, error);
                    }
                } else {
                    console.error(`Error editing message for user ID ${id} (Message ID: ${messageInfo.messageId}):`, error.message);
                }
            }

            this.userMessages[id] = messageInfo;
        }
    }

    /**
     * Helper function to update a specific user's message.
     * @param {number} userId - The user's Telegram ID.
     */
    async updateUserMessagesForUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;

        const { share, pool } = user;
        const messageInfo = this.userMessages[userId] || { messageId: null, failureCount: 0 };

        if (!messageInfo.messageId) {
            await this.sendUserMessage(user);
            return;
        }

        const poolBalances = this.balances[pool];
        if (!poolBalances) {
            // No balances found for the specified pool
            return;
        }

        const userBalance = poolBalances.total * share || 0;
        const percentageChange = calculatePercentageChange(user.balance, userBalance);
        const formattedMessage = formatUserMessage(userBalance, percentageChange);

        // Check if the new message is different from the last one
        if (this.lastUserMessages[userId] === formattedMessage) {
            // No changes detected, skip editing
            return;
        }

        try {
            await this.enqueueEdit(() => this.bot.editMessageText(formattedMessage, {
                chat_id: userId,
                message_id: messageInfo.messageId,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }));
            this.lastUserMessages[userId] = formattedMessage; // Update the last message content
            this.retryUserCounts[userId] = 0; // Reset retry count on success
        } catch (error) {
            if (this.isMessageNotFoundError(error)) {
                await this.handleEditFailure('user', userId, error);
            } else if (this.isTooManyRequestsError(error)) {
                const retryAfter = this.getRetryAfter(error);
                if (retryAfter) {
                    if ((this.retryUserCounts[userId] || 0) < this.MAX_FAILURES) {
                        this.retryUserCounts[userId] = (this.retryUserCounts[userId] || 0) + 1;
                        setTimeout(() => this.updateUserMessagesForUser(userId), retryAfter * 1000);
                    } else {
                        // Exceeded max retries, handle as failure
                        await this.handleEditFailure('user', userId, error);
                        this.retryUserCounts[userId] = 0;
                    }
                } else {
                    // No retry after specified, treat as failure
                    await this.handleEditFailure('user', userId, error);
                }
            } else {
                console.error(`Error editing message for user ID ${userId} (Message ID: ${messageInfo.messageId}):`, error.message);
            }
        }

        this.userMessages[userId] = messageInfo;
    }

    /**
     * Enqueues an edit operation to be processed sequentially.
     * @param {Function} editFunction - The function that performs the edit operation.
     */
    async enqueueEdit(editFunction) {
        return new Promise((resolve, reject) => {
            this.editQueue.push({ editFunction, resolve, reject });
            this.processQueue();
        });
    }

    /**
     * Processes the edit queue sequentially to prevent overlapping requests.
     */
    async processQueue() {
        if (this.isProcessingQueue || this.editQueue.length === 0) return;

        this.isProcessingQueue = true;
        const { editFunction, resolve, reject } = this.editQueue.shift();

        try {
            const result = await editFunction();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.isProcessingQueue = false;
            // Process the next item in the queue
            this.processQueue();
        }
    }

    /**
     * Determines if the error is due to the message not existing.
     * @param {Error} error - The error object.
     * @returns {boolean} True if the error is due to message not found, else false.
     */
    isMessageNotFoundError(error) {
        // Telegram API error code for "message not found" is 400
        // The description usually contains 'message to edit not found'
        return error.response && error.response.error_code === 400 && error.response.description.includes('message to edit not found');
    }

    /**
     * Determines if the error is due to too many requests (rate limiting).
     * @param {Error} error - The error object.
     * @returns {boolean} True if the error is due to rate limiting, else false.
     */
    isTooManyRequestsError(error) {
        // Telegram API error code for "Too Many Requests" is 429
        // The description usually contains 'Too Many Requests'
        return error.response && error.response.error_code === 429 && error.response.description.includes('Too Many Requests');
    }

    /**
     * Extracts the 'retry_after' parameter from the error response.
     * @param {Error} error - The error object.
     * @returns {number|null} The number of seconds to wait before retrying, or null if not found.
     */
    getRetryAfter(error) {
        if (error.response && error.response.parameters && error.response.parameters.retry_after) {
            return error.response.parameters.retry_after;
        }
        // Alternatively, parse from error.response.description if needed
        const regex = /retry after (\d+)/i;
        const match = error.response.description.match(regex);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
        return null;
    }

    /**
     * Handles edit failures by incrementing failure counts and sending new messages if necessary.
     * @param {string} type - 'admin' or 'user'
     * @param {number|null} userId - The user ID if type is 'user'
     * @param {Error} error - The error object.
     */
    async handleEditFailure(type, userId = null, error = null) {
        if (type === 'admin') {
            this.retryAdminCount += 1;

            if (this.retryAdminCount >= this.MAX_FAILURES) {
                await this.sendAdminMessage();
                this.retryAdminCount = 0;
            }
        } else if (type === 'user' && userId !== null) {
            const messageInfo = this.userMessages[userId] || { messageId: null, failureCount: 0 };
            messageInfo.failureCount += 1;

            if (messageInfo.failureCount >= this.MAX_FAILURES) {
                const user = this.users.find(u => u.id === userId);
                if (user) {
                    await this.sendUserMessage(user);
                }
                messageInfo.failureCount = 0;
            }

            this.userMessages[userId] = messageInfo;
        }

        // Log the error if provided
        if (error) {
            console.error(`Error handling edit failure for ${type}${userId ? ` (ID: ${userId})` : ''}:`, error.message);
        }
    }

    /**
     * Updates the internal balances object.
     * @param {Object} balances - The latest balances.
     */
    update(balances) {
        if (!balances || typeof balances !== 'object') {
            console.error('Invalid balances provided for update.');
            return;
        }
        this.balances = { ...balances };
    }
}

module.exports = new TelegramModule();