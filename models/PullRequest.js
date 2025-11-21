const mongoose = require('mongoose');

const pullRequestSchema = new mongoose.Schema({
  githubId: {
    type: String,
    required: true,
  },
  repoName: {
    type: String,
    required: true
  },
  prNumber: {
    type: Number,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  author: {
    type: String,
    required: true
  },
  headSha: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['not-reviewed', 'reviewing', 'reviewed'],
    default: 'not-reviewed'
  },
  // Enhanced file analysis
  fileAnalysis: [{
    filename: String,
    path: String,
    changes: {
      additions: Number,
      deletions: Number,
      modifications: Number
    },
    complexity: {
      score: Number,
      level: String // 'low', 'medium', 'high', 'very-high'
    },
    issues: [{
      type: String, // 'error', 'warning', 'info', 'suggestion'
      severity: String, // 'critical', 'major', 'minor', 'info'
      line: Number,
      message: String,
      rule: String,
      category: String // 'security', 'performance', 'maintainability', 'readability'
    }],
    codeSnippets: [{
      type: String, // 'before', 'after', 'diff'
      code: String,
      language: String,
      startLine: Number,
      endLine: Number
    }]
  }],
  // Enhanced review data
  review: {
    summary: String,
    issues: [String],
    scores: {
      overall: Number,
      codeQuality: Number,
      performance: Number,
      security: Number,
      maintainability: Number,
      readability: Number
    },
    detailedAnalysis: {
      strengths: [String],
      weaknesses: [String],
      recommendations: [String],
      bestPractices: {
        followed: [String],
        violated: [String]
      }
    },
    metrics: {
      fileCount: Number,
      linesAdded: Number,
      linesRemoved: Number,
      linesModified: Number,
      complexityScore: Number,
      testCoverage: Number,
      duplicateCode: Number
    },
    reviewedAt: Date,
    reviewedBy: String,
    reviewDuration: Number // Time in minutes
  },
  // Historical data for trends
  historicalScores: [{
    prNumber: Number,
    reviewedAt: Date,
    scores: {
      overall: Number,
      codeQuality: Number,
      performance: Number,
      security: Number
    }
  }],
  // Metadata
  metadata: {
    reviewProgress: {
      stage: String, // 'analyzing', 'reviewing', 'generating-report', 'completed'
      percentage: Number,
      currentStep: String,
      estimatedTimeRemaining: Number
    },
    exportHistory: [{
      format: String, // 'pdf', 'json', 'csv'
      exportedAt: Date,
      exportedBy: String,
      fileSize: Number
    }],
    shareLinks: [{
      id: String,
      createdAt: Date,
      expiresAt: Date,
      accessCount: Number,
      permissions: [String] // 'view', 'comment', 'download'
    }]
  }
}, {
  timestamps: true
});

// Compound index to ensure uniqueness per user, repo, and PR
pullRequestSchema.index({ githubId: 1, repoName: 1, prNumber: 1 }, { unique: true });

// Index for historical queries
pullRequestSchema.index({ githubId: 1, 'review.reviewedAt': -1 });

// Index for file analysis queries
pullRequestSchema.index({ 'fileAnalysis.filename': 1 });

module.exports = mongoose.model('PullRequest', pullRequestSchema);