const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// CORS configuration - allow specific origins
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://yourdomain.com',
  'https://tpcvotingprivate.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

// In-memory storage for polls
// Structure: { pollId: { id, question, options, votes, status, createdAt } }
const polls = {};

// Helper function to generate unique poll ID
function generatePollId() {
  return 'poll_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Helper function to check if poll exists
function getPollOrError(pollId) {
  if (!polls[pollId]) {
    return { error: true, message: 'Poll not found' };
  }
  return { error: false, poll: polls[pollId] };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/polls/create
 * Create a new poll
 * Body: { question: string, options: string[] }
 * Returns: { success: boolean, pollId: string, message: string }
 */
app.post('/api/polls/create', (req, res) => {
  try {
    const { question, options } = req.body;

    // Validation
    if (!question || !question.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Question is required'
      });
    }

    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 options are required'
      });
    }

    const cleanedOptions = options.filter(opt => opt.trim());
    if (cleanedOptions.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 non-empty options are required'
      });
    }

    // Create poll
    const pollId = generatePollId();
    polls[pollId] = {
      id: pollId,
      question: question.trim(),
      options: cleanedOptions,
      votes: cleanedOptions.map(() => 0), // Initialize vote count for each option
      status: 'active', // 'active' or 'closed'
      createdAt: new Date().toISOString(),
      voters: new Set() // Track who has voted (using IP or sessionID)
    };

    res.status(201).json({
      success: true,
      pollId: pollId,
      message: 'Poll created successfully',
      poll: {
        id: pollId,
        question: polls[pollId].question,
        options: polls[pollId].options,
        status: polls[pollId].status
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * GET /api/polls/:pollId
 * Get poll details (without results)
 * Returns: { success: boolean, poll: object }
 */
app.get('/api/polls/:pollId', (req, res) => {
  try {
    const { pollId } = req.params;
    const result = getPollOrError(pollId);

    if (result.error) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    const poll = result.poll;
    res.json({
      success: true,
      poll: {
        id: poll.id,
        question: poll.question,
        options: poll.options,
        status: poll.status,
        createdAt: poll.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * POST /api/polls/:pollId/vote
 * Submit a vote for a poll
 * Body: { optionIndex: number, voterId?: string }
 * Returns: { success: boolean, message: string }
 */
app.post('/api/polls/:pollId/vote', (req, res) => {
  try {
    const { pollId } = req.params;
    const { optionIndex, voterId } = req.body;

    // Validate poll exists
    const result = getPollOrError(pollId);
    if (result.error) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    const poll = result.poll;

    // Check if poll is active
    if (poll.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'This poll is closed. Voting is not allowed.'
      });
    }

    // Validate option index
    if (typeof optionIndex !== 'number' || optionIndex < 0 || optionIndex >= poll.options.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid option index'
      });
    }

    // Check if user has already voted (using voterId or IP)
    const uniqueVoterId = voterId || req.ip;
    if (poll.voters.has(uniqueVoterId)) {
      return res.status(400).json({
        success: false,
        message: 'You have already voted in this poll'
      });
    }

    // Record vote
    poll.votes[optionIndex]++;
    poll.voters.add(uniqueVoterId);

    res.json({
      success: true,
      message: 'Vote recorded successfully',
      pollId: pollId,
      option: poll.options[optionIndex]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * GET /api/polls/:pollId/results
 * Get poll results
 * Returns: { success: boolean, results: { option, votes, percentage }[] }
 */
app.get('/api/polls/:pollId/results', (req, res) => {
  try {
    const { pollId } = req.params;
    const result = getPollOrError(pollId);

    if (result.error) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    const poll = result.poll;
    const totalVotes = poll.votes.reduce((a, b) => a + b, 0);

    const results = poll.options.map((option, index) => ({
      option: option,
      votes: poll.votes[index],
      percentage: totalVotes > 0 ? ((poll.votes[index] / totalVotes) * 100).toFixed(1) : 0
    }));

    res.json({
      success: true,
      pollId: pollId,
      question: poll.question,
      status: poll.status,
      totalVotes: totalVotes,
      results: results,
      createdAt: poll.createdAt
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * PUT /api/polls/:pollId/close
 * Close a poll (stop accepting votes)
 * Returns: { success: boolean, message: string }
 */
app.put('/api/polls/:pollId/close', (req, res) => {
  try {
    const { pollId } = req.params;
    const result = getPollOrError(pollId);

    if (result.error) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    const poll = result.poll;

    // Check if already closed
    if (poll.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'Poll is already closed'
      });
    }

    // Close poll
    poll.status = 'closed';

    res.json({
      success: true,
      message: 'Poll closed successfully',
      pollId: pollId,
      status: poll.status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * GET /api/polls
 * Get all polls (summary)
 * Returns: { success: boolean, polls: object[] }
 */
app.get('/api/polls', (req, res) => {
  try {
    const pollsList = Object.values(polls).map(poll => ({
      id: poll.id,
      question: poll.question,
      status: poll.status,
      totalVotes: poll.votes.reduce((a, b) => a + b, 0),
      createdAt: poll.createdAt
    }));

    res.json({
      success: true,
      count: pollsList.length,
      polls: pollsList
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * DELETE /api/polls/:pollId
 * Delete a poll (admin only, no auth)
 * Returns: { success: boolean, message: string }
 */
app.delete('/api/polls/:pollId', (req, res) => {
  try {
    const { pollId } = req.params;
    const result = getPollOrError(pollId);

    if (result.error) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    delete polls[pollId];

    res.json({
      success: true,
      message: 'Poll deleted successfully',
      pollId: pollId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// ============================================================================
// Health check
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    message: 'Voting API Server Running',
    endpoints: {
      createPoll: 'POST /api/polls/create',
      getPoll: 'GET /api/polls/:pollId',
      vote: 'POST /api/polls/:pollId/vote',
      getResults: 'GET /api/polls/:pollId/results',
      closePoll: 'PUT /api/polls/:pollId/close',
      getAllPolls: 'GET /api/polls',
      deletePoll: 'DELETE /api/polls/:pollId'
    }
  });
});

// ============================================================================
// Start server
// ============================================================================

app.listen(port, () => {
  console.log(`✓ Server running on http://localhost:${port}`);
  console.log(`✓ CORS enabled for: ${allowedOrigins.join(', ')}`);
  console.log(`✓ Visit http://localhost:${port} for API documentation`);
});