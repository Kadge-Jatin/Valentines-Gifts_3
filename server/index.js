const express = require('express');
const multer = require('multer');
const { Octokit } = require('@octokit/rest');
const { v4: uuidv4 } = require('uuid');

const upload = multer(); // memory storage
const app = express();

const OWNER = process.env.REPO_OWNER;     // e.g., "Kadge-Jatin"
const REPO = process.env.REPO_NAME;      // e.g., "Valentines-Gifts_3"
const TOKEN = process.env.GITHUB_TOKEN;  // PAT with repo scope

if (!OWNER || !REPO || !TOKEN) {
  console.error('Missing REPO_OWNER, REPO_NAME, or GITHUB_TOKEN env vars.');
  process.exit(1);
}

const octokit = new Octokit({ auth: TOKEN });

// simple health
app.get('/', (req, res) => res.send('GitHub uploader running'));

// Upload endpoint: accepts multiple files in "files" field
app.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded (form field "files")' });

    // Make a short unique id for this upload
    const id = uuidv4().replace(/-/g, '');

    // Determine default branch for raw URL construction
    const repoInfo = await octokit.repos.get({ owner: OWNER, repo: REPO });
    const branch = repoInfo.data.default_branch || 'main';
    const rawBase = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${branch}/`;

    // Commit each file at path uploads/{id}/{originalname}
    const uploaded = [];
    for (const f of files) {
      // sanitize filename a bit (remove leading slashes)
      const name = (f.originalname || 'file').replace(/^\/+/, '');
      const path = `uploads/${id}/${name}`;
      const contentBase64 = f.buffer.toString('base64');

      // Create the file in the repo
      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path,
        message: `Add uploaded file ${path}`,
        content: contentBase64,
        branch
      });

      uploaded.push({
        name,
        path,
        url: rawBase + `uploads/${id}/` + encodeURIComponent(name)
      });
    }

    // Create a share descriptor JSON in shares/{id}.json
    const shareObj = {
      id,
      created_at: new Date().toISOString(),
      files: uploaded
    };
    const sharePath = `shares/${id}.json`;
    const shareContentBase64 = Buffer.from(JSON.stringify(shareObj, null, 2)).toString('base64');

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path: sharePath,
      message: `Add share descriptor ${sharePath}`,
      content: shareContentBase64,
      branch
    });

    // Public share URL (GitHub Pages must be enabled for the repo)
    const pagesURL = `https://${OWNER}.github.io/${REPO}/view.html?share=${id}`;

    return res.json({ id, pagesURL, share: shareObj });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uploader listening on ${PORT}`));
