const express = require('express');
const { Octokit } = require('@octokit/rest');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PullRequest = require('../models/PullRequest');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

// Helper function to get GitHub access token for user
const getGitHubToken = async (userId) => {
  const user = await User.findById(userId);
  return user.githubToken;
};

// Helper function to create Octokit instance for user
const createOctokit = async (userId) => {
  const token = await getGitHubToken(userId);
  if (!token) {
    throw new Error('GitHub token not found');
  }
  return new Octokit({ auth: token });
};

// GET /github/pull-requests - Fetch all pull requests for user's repositories
router.get('/pull-requests', async (req, res) => {
  try {
    const token = req.cookies.token;
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Return PRs from our database
    const pullRequests = await PullRequest.find({ githubId: user.githubId })
      .sort({ createdAt: -1 });

    // Transform to match the expected response format
    const formattedPRs = pullRequests.map(pr => ({
      repoName: pr.repoName,
      prNumber: pr.prNumber,
      title: pr.title,
      author: pr.author,
      headSha: pr.headSha,
      createdAt: pr.createdAt,
      status: pr.status
    }));

    res.json(formattedPRs);

  } catch (error) {
    console.error('Fetch pull requests error:', error);
    res.status(500).json({ message: 'Failed to fetch pull requests' });
  }
});

// GET /github/sync-pull-requests - Sync pull requests from GitHub
router.get('/sync-pull-requests', async (req, res) => {
  try {
    const token = req.cookies.token;
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const octokit = await createOctokit(decoded.userId);
    
    // Get all repositories for the authenticated user
    const repos = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        type: 'owner',
        per_page: 100,
        page
      });
      
      repos.push(...data);
      hasMore = data.length === 100;
      page++;
    }

    let totalPRs = 0;

    // Fetch pull requests from each repository
    for (const repo of repos) {
      try {
        const { data: prs } = await octokit.rest.pulls.list({
          owner: repo.owner.login,
          repo: repo.name,
          state: 'open',
          per_page: 100
        });

        for (const pr of prs) {


          const prData = {
            githubId: user.githubId,
            repoName: repo.full_name,
            prNumber: pr.number,
            title: pr.title,
            author: pr.user.login,
            headSha: pr.head.sha,
            createdAt: pr.created_at,
            status: 'not-reviewed'
          };

          await PullRequest.findOneAndUpdate(
            {
              githubId: user.githubId,
              repoName: repo.full_name,
              prNumber: pr.number
            },
            prData,
            { upsert: true, new: true }
          );
          
          totalPRs++;
        }
      } catch (repoError) {
        console.error(`Error fetching PRs for repo ${repo.full_name}:`, repoError.message);
        // Continue with other repos even if one fails
      }
    }

    res.json({ 
      message: 'Pull requests synced successfully', 
      count: totalPRs,
      reposProcessed: repos.length
    });

  } catch (error) {
    console.error('Sync pull requests error:', error);
    res.status(500).json({ message: 'Failed to sync pull requests' });
  }
});

// GET /github/dashboard - Get dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    const token = req.cookies.token;
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Get all PRs for the user
    const pullRequests = await PullRequest.find({ githubId: user.githubId })
      .sort({ createdAt: -1 });

    // Calculate statistics
    const totalPRs = pullRequests.length;
    const reviewedPRs = pullRequests.filter(pr => pr.status === 'reviewed').length;
    const reviewingPRs = pullRequests.filter(pr => pr.status === 'reviewing').length;
    const notReviewedPRs = pullRequests.filter(pr => pr.status === 'not-reviewed').length;
    
    // Get unique repositories
    const uniqueRepos = [...new Set(pullRequests.map(pr => pr.repoName))].length;

    // Calculate average scores for reviewed PRs
    const reviewedPRsWithScores = pullRequests.filter(pr => 
      pr.status === 'reviewed' && pr.review?.scores?.overall
    );
    
    let avgScore = 0;
    let avgCodeQuality = 0;
    let avgPerformance = 0;
    let avgSecurity = 0;
    let avgMaintainability = 0;

    if (reviewedPRsWithScores.length > 0) {
      avgScore = reviewedPRsWithScores.reduce((sum, pr) => sum + pr.review.scores.overall, 0) / reviewedPRsWithScores.length;
      avgCodeQuality = reviewedPRsWithScores.reduce((sum, pr) => sum + pr.review.scores.codeQuality, 0) / reviewedPRsWithScores.length;
      avgPerformance = reviewedPRsWithScores.reduce((sum, pr) => sum + pr.review.scores.performance, 0) / reviewedPRsWithScores.length;
      avgSecurity = reviewedPRsWithScores.reduce((sum, pr) => sum + pr.review.scores.security, 0) / reviewedPRsWithScores.length;
      avgMaintainability = reviewedPRsWithScores.reduce((sum, pr) => sum + pr.review.scores.maintainability, 0) / reviewedPRsWithScores.length;
    }

    // Get recent activity (last 10 PRs)
    const recentActivity = pullRequests.slice(0, 10).map(pr => ({
      repoName: pr.repoName,
      prNumber: pr.prNumber,
      title: pr.title,
      author: pr.author,
      status: pr.status,
      createdAt: pr.createdAt,
      score: pr.review?.scores?.overall || null
    }));

    // Get repository breakdown
    const repoBreakdown = {};
    pullRequests.forEach(pr => {
      if (!repoBreakdown[pr.repoName]) {
        repoBreakdown[pr.repoName] = {
          total: 0,
          reviewed: 0,
          reviewing: 0,
          notReviewed: 0,
          avgScore: 0,
          scores: []
        };
      }
      repoBreakdown[pr.repoName].total++;
      repoBreakdown[pr.repoName][pr.status === 'reviewed' ? 'reviewed' : 
                                   pr.status === 'reviewing' ? 'reviewing' : 'notReviewed']++;
      
      if (pr.status === 'reviewed' && pr.review?.scores?.overall) {
        repoBreakdown[pr.repoName].scores.push(pr.review.scores.overall);
      }
    });

    // Calculate average scores per repository
    Object.keys(repoBreakdown).forEach(repo => {
      const scores = repoBreakdown[repo].scores;
      if (scores.length > 0) {
        repoBreakdown[repo].avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      }
      delete repoBreakdown[repo].scores; // Remove raw scores array
    });

    // Calculate trends (compare with last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentPRs = pullRequests.filter(pr => new Date(pr.createdAt) >= thirtyDaysAgo);
    const olderPRs = pullRequests.filter(pr => new Date(pr.createdAt) < thirtyDaysAgo);
    
    const recentReviewed = recentPRs.filter(pr => pr.status === 'reviewed').length;
    const olderReviewed = olderPRs.filter(pr => pr.status === 'reviewed').length;
    
    const reviewRateChange = olderReviewed > 0 
      ? ((recentReviewed - olderReviewed) / olderReviewed * 100).toFixed(1)
      : recentReviewed > 0 ? '+100' : '0';

    res.json({
      stats: {
        totalPRs,
        reviewedPRs,
        reviewingPRs,
        notReviewedPRs,
        uniqueRepos,
        reviewRateChange: reviewRateChange + '%'
      },
      scores: {
        avgScore: Math.round(avgScore),
        avgCodeQuality: Math.round(avgCodeQuality),
        avgPerformance: Math.round(avgPerformance),
        avgSecurity: Math.round(avgSecurity),
        avgMaintainability: Math.round(avgMaintainability)
      },
      recentActivity,
      repoBreakdown,
      trends: {
        recentPRsCount: recentPRs.length,
        olderPRsCount: olderPRs.length,
        reviewRateChange: reviewRateChange + '%'
      }
    });

  } catch (error) {
    console.error('Dashboard data error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data' });
  }
});

module.exports = router;