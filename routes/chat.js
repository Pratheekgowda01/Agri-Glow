const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const { Message, Conversation } = require('../models/Chat');
const { auth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/chat-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/chat-combined.log' })
  ]
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/chat');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'));
    }
  }
});

// Get conversations list
router.get('/conversations', auth, async (req, res) => {
  try {
    const userId = req.userId;
    const conversations = await Conversation.find({ participants: userId })
      .populate('participants', 'name email avatar role')
      .populate('lastMessage')
      .sort('-updatedAt');

    res.json(conversations);
  } catch (error) {
    logger.error('Failed to fetch conversations:', error);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

// Get conversation messages
router.get('/conversations/:conversationId/messages', [
  auth,
  param('conversationId').isMongoId()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const messages = await Message.find({ conversationId })
      .populate('sender', 'name email avatar role')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Mark messages as read
    const unreadMessages = messages.filter(
      msg => !msg.readBy.some(read => read.user.equals(req.userId))
    );

    if (unreadMessages.length > 0) {
      await Promise.all(unreadMessages.map(msg => msg.markAsRead(req.userId)));
      await conversation.clearUnread(req.userId);
    }

    res.json(messages);
  } catch (error) {
    logger.error('Failed to fetch messages:', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// Start new conversation
router.post('/conversations', [
  auth,
  body('participantIds').isArray().withMessage('participantIds must be an array'),
  body('participantIds.*').isMongoId().withMessage('Invalid participant ID'),
  body('type').optional().isIn(['direct', 'group']).withMessage('Invalid conversation type'),
  body('title').optional().isString().trim().isLength({ max: 100 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { participantIds, type = 'direct', title, metadata = {} } = req.body;
    const userId = req.userId;

    // Include current user in participants
    const allParticipants = [...new Set([userId, ...participantIds])];

    // For direct messages, check if conversation already exists
    if (type === 'direct' && allParticipants.length === 2) {
      const existingConversation = await Conversation.findOne({
        type: 'direct',
        participants: { $all: allParticipants }
      });

      if (existingConversation) {
        return res.json(existingConversation);
      }
    }

    const conversation = await Conversation.create({
      participants: allParticipants,
      type,
      title: title || null,
      metadata
    });

    await conversation.populate('participants', 'name email avatar role');
    res.status(201).json(conversation);
  } catch (error) {
    logger.error('Failed to create conversation:', error);
    res.status(500).json({ message: 'Failed to create conversation' });
  }
});

// Send message
router.post('/conversations/:conversationId/messages', [
  auth,
  param('conversationId').isMongoId(),
  body('content').isString().trim().notEmpty(),
  body('messageType').optional().isIn(['text', 'image', 'system'])
], upload.array('attachments', 5), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { conversationId } = req.params;
    const { content, messageType = 'text' } = req.body;
    const attachments = (req.files || []).map(file => ({
      url: `/uploads/chat/${file.filename}`,
      contentType: file.mimetype
    }));

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const message = await Message.create({
      conversationId,
      sender: req.userId,
      content,
      messageType,
      attachments
    });

    await message.populate('sender', 'name email avatar role');
    res.status(201).json(message);
  } catch (error) {
    logger.error('Failed to send message:', error);
    res.status(500).json({ message: 'Failed to send message' });
  }
});

// Update conversation
router.patch('/conversations/:conversationId', [
  auth,
  param('conversationId').isMongoId(),
  body('title').optional().isString().trim().isLength({ max: 100 }),
  body('isActive').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { conversationId } = req.params;
    const updates = {};

    if ('title' in req.body) updates.title = req.body.title;
    if ('isActive' in req.body) updates.isActive = req.body.isActive;

    const conversation = await Conversation.findOneAndUpdate(
      { _id: conversationId, participants: req.userId },
      updates,
      { new: true }
    ).populate('participants', 'name email avatar role');

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (error) {
    logger.error('Failed to update conversation:', error);
    res.status(500).json({ message: 'Failed to update conversation' });
  }
});

// Delete message
router.delete('/messages/:messageId', [
  auth,
  param('messageId').isMongoId()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { messageId } = req.params;
    const message = await Message.findOne({ _id: messageId, sender: req.userId });

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    await message.deleteOne();
    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete message:', error);
    res.status(500).json({ message: 'Failed to delete message' });
  }
});

module.exports = router;