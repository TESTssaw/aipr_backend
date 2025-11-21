const express = require("express");
const { Octokit } = require("@octokit/rest");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const PullRequest = require("../models/PullRequest");
const User = require("../models/User");
const { handleGeminiError, getRetryDelay } = require("../utils/geminiErrors");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Gemini AI
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// Specific rate limiter for review endpoint
const reviewLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // limit each user to 3 review requests per 5 minutes
  message: {
    error: 'Too many review requests. Please wait before starting another review.',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper function to create Octokit instance for user
const createOctokit = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.githubToken) {
    throw new Error("GitHub token not found");
  }
  return new Octokit({ auth: user.githubToken });
};

// POST /pr/review - Trigger AI review for a pull request
router.post("/review", async (req, res) => {
  try {
    const token = req.cookies.token;
    const io = req.app.get('io');

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    if (!genAI) {
      return res.status(500).json({ message: "Gemini AI not configured" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { repoName, prNumber } = req.body;

    if (!repoName || !prNumber) {
      return res
        .status(400)
        .json({ message: "repoName and prNumber are required" });
    }

    // Find the PR in database
    const pr = await PullRequest.findOne({
      githubId: decoded.githubId,
      repoName,
      prNumber,
    });

    if (!pr) {
      return res.status(404).json({ message: "Pull request not found" });
    }

    // Check if already reviewing
    if (pr.status === "reviewing") {
      return res.status(400).json({ message: "Review already in progress" });
    }

    // Update status to reviewing
    pr.status = "reviewing";
    await pr.save();

    // Emit real-time update
    io.to(`user-${decoded.userId}`).emit('review:started', {
      repoName,
      prNumber,
      message: 'Review started successfully'
    });

    // Start AI review process asynchronously
    (async () => {
      try {
        const octokit = await createOctokit(decoded.userId);

        // Get repository owner and name from repoName
        const [owner, ...repoParts] = repoName.split("/");
        const repo = repoParts.join("/");

        // Fetch PR diff from GitHub API
        const { data: prData } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });

        // Get the diff
        const { data: diffData } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
          mediaType: {
            format: "diff",
          },
        });

        // Initialize Gemini model
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // Create prompt for code review
        const prompt = `Please review this pull request and provide a comprehensive analysis. 

PR Title: ${prData.title}
PR Description: ${prData.body || "No description provided"}

Diff:
${diffData}

Please provide your review in the following JSON format. Respond ONLY with valid JSON, no additional text:

{
  "summary": "A brief summary of the changes and overall assessment",
  "issues": [
    "Specific issue 1",
    "Specific issue 2",
    "Specific issue 3"
  ],
  "scores": {
    "overall": 7.5,
    "codeQuality": 8.0,
    "performance": 7.0,
    "security": 6.5
  }
}

Focus on:
1. Code quality and best practices
2. Performance implications
3. Security considerations
4. Potential bugs or edge cases
5. Code readability and maintainability
6. Testing considerations

Be constructive and specific in your feedback. Ensure the issues array contains actual issues found, not generic recommendations.`;

        // Generate review with Gemini with retry logic
        let text;
        let attempt = 0;
        const maxAttempts = 3;
        
        while (attempt < maxAttempts) {
          try {
            // Emit progress update
            io.to(`user-${decoded.userId}`).emit('review:progress', {
              repoName,
              prNumber,
              progress: Math.min(20 + (attempt * 20), 80),
              message: `Analyzing code... (Attempt ${attempt + 1}/${maxAttempts})`
            });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            text = response.text();
            break; // Success, exit retry loop
          } catch (geminiError) {
            attempt++;
            const handledError = handleGeminiError(geminiError);
            
            if (attempt >= maxAttempts || !handledError.retryable) {
              // Emit error to client
              io.to(`user-${decoded.userId}`).emit('review:error', {
                repoName,
                prNumber,
                error: {
                  type: handledError.type,
                  message: handledError.message,
                  retryable: handledError.retryable,
                  retryAfter: handledError.retryAfter
                }
              });

              // Update PR status
              pr.status = "not-reviewed";
              await pr.save();
              return;
            }

            // Wait before retry
            const delay = getRetryDelay(attempt);
            io.to(`user-${decoded.userId}`).emit('review:progress', {
              repoName,
              prNumber,
              progress: Math.min(20 + (attempt * 20), 80),
              message: `Retrying in ${Math.ceil(delay / 1000)} seconds... (${handledError.type})`
            });
            
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }

        // Parse the AI response
        let reviewData;
        try {
          console.log("Raw AI response:", text);
          
          // Try multiple approaches to extract JSON
          let jsonText = null;
          
          // Method 1: Look for JSON between ```json and ```
          const jsonCodeBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonCodeBlock) {
            jsonText = jsonCodeBlock[1].trim();
          }
          
          // Method 2: Look for JSON between { and }
          if (!jsonText) {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              jsonText = jsonMatch[0];
            }
          }
          
          // Method 3: Try to parse the entire text as JSON
          if (!jsonText) {
            jsonText = text.trim();
          }
          
          if (jsonText) {
            // Clean up common JSON issues
            jsonText = jsonText
              .replace(/,\s*}/g, '}')  // Remove trailing commas
              .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
              .replace(/\\n/g, '\\n')   // Fix escaped newlines
              .replace(/\\"/g, '\\"');  // Fix escaped quotes
            
            reviewData = JSON.parse(jsonText);
            console.log("Successfully parsed AI response:", reviewData);
          } else {
            throw new Error("No JSON found in response");
          }
        } catch (parseError) {
          console.error("Failed to parse AI response:", parseError);
          console.error("Raw AI response:", text);
          
          // Try to extract useful information from the raw text
          const lines = text.split('\n').filter(line => line.trim());
          const extractedIssues = [];
          
          // Look for common issue patterns in the text
          lines.forEach(line => {
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes('issue') || lowerLine.includes('problem') || 
                lowerLine.includes('concern') || lowerLine.includes('recommend') ||
                lowerLine.includes('suggest') || lowerLine.includes('improve')) {
              extractedIssues.push(line.trim());
            }
          });
          
          // Fallback to a basic review structure
          reviewData = {
            summary: text.substring(0, 500) + (text.length > 500 ? "..." : ""),
            issues: extractedIssues.length > 0 ? extractedIssues : ["AI response parsing failed - please review manually"],
            scores: {
              overall: 5.0,
              codeQuality: 5.0,
              performance: 5.0,
              security: 5.0,
            },
          };
        }

        // Ensure all required fields exist
        const review = {
          summary:
            reviewData.summary ||
            "Review completed but summary could not be generated.",
          issues: Array.isArray(reviewData.issues)
            ? reviewData.issues.filter(issue => typeof issue === 'string' && issue.trim())
            : ["No specific issues identified"],
          scores: {
            overall: Number(reviewData.scores?.overall) || 7.0,
            codeQuality: Number(reviewData.scores?.codeQuality) || 7.0,
            performance: Number(reviewData.scores?.performance) || 7.0,
            security: Number(reviewData.scores?.security) || 7.0,
          },
          reviewedAt: new Date(),
          reviewedBy: "Gemini AI",
        };

        // Emit final progress
        io.to(`user-${decoded.userId}`).emit('review:progress', {
          repoName,
          prNumber,
          progress: 100,
          message: 'Finalizing review...'
        });

        // Update PR with review results
        pr.review = review;
        pr.status = "reviewed";
        await pr.save();

        // Emit completion event
        io.to(`user-${decoded.userId}`).emit('review:completed', {
          repoName,
          prNumber,
          review: review,
          message: 'Review completed successfully!'
        });

        console.log(`Review completed for PR ${prNumber} in ${repoName}`);
      } catch (error) {
        console.error("AI review error:", error);
        
        const handledError = handleGeminiError(error);
        
        // Emit error to client
        io.to(`user-${decoded.userId}`).emit('review:error', {
          repoName,
          prNumber,
          error: {
            type: handledError.type,
            message: handledError.message,
            retryable: handledError.retryable,
            retryAfter: handledError.retryAfter
          }
        });

        pr.status = "not-reviewed";
        await pr.save();
      }
    })();

    res.json({
      message: "Review started",
      reportId: pr._id.toString(),
    });
  } catch (error) {
    console.error("PR review error:", error);
    res.status(500).json({ message: "Failed to start review" });
  }
});

// GET /pr/:repoName/:prNumber - Get specific PR details with review
router.get("/:repoName/:prNumber", async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const { repoName, prNumber } = req.params;

          const formattedRepoName = repoName.replace(/-/g, '/');


    const pr = await PullRequest.findOne({
      githubId: decoded.githubId,
      repoName: formattedRepoName ,
      prNumber: parseInt(prNumber),
    });

    if (!pr) {
      return res.status(404).json({ message: "Pull request not found" });
    }

    res.json(pr);
  } catch (error) {
    console.error("Get PR error:", error);
    res.status(500).json({ message: "Failed to fetch pull request" });
  }
});

module.exports = router;
