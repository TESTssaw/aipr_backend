const fs = require('fs');

let content = fs.readFileSync('routes/pr.js', 'utf8');

// Add debugging logs after JWT verification
content = content.replace(
  /const decoded = jwt\.verify\(token, JWT_SECRET\);/,
  `const decoded = jwt.verify(token, JWT_SECRET);
  console.log('🔍 JWT Decoded:', { userId: decoded.userId, githubId: decoded.githubId });`
);

// Add debugging logs before PR query in review route
content = content.replace(
  /\/\/ Find the PR in database\s*\n\s*const pr = await PullRequest\.findOne/,
  `// Find the PR in database
  console.log('🔍 Review Query:', { githubId: decoded.githubId, repoName, prNumber });
  const pr = await PullRequest.findOne`
);

// Add debugging logs before PR query in get route
content = content.replace(
  /const pr = await PullRequest\.findOne\(\{ \s*githubId: decoded\.githubId,/,
  `console.log('🔍 Get PR Query:', { githubId: decoded.githubId, repoName, prNumber: parseInt(prNumber) });
  const pr = await PullRequest.findOne({ 
    githubId: decoded.githubId,`
);

// Add input validation
content = content.replace(
  /if \(!repoName \|\| !prNumber\) \{/,
  `// Validate repoName format
  if (!repoName || !repoName.includes('/')) {
    return res.status(400).json({ message: 'Invalid repoName format. Expected: "owner/repo"' });
  }
  
  // Validate prNumber
  const prNumberNum = parseInt(prNumber);
  if (isNaN(prNumberNum) || prNumberNum <= 0) {
    return res.status(400).json({ message: 'Invalid prNumber. Must be a positive integer' });
  }

  if (!repoName || !prNumber) {`
);

fs.writeFileSync('routes/pr.js', content);
console.log('✅ Enhanced PR routes with debugging and validation');
